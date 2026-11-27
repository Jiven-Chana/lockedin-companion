/**
 * The phone app after a lecture (v2.1 part A; lo-fi task 1, V-46), run as
 * the plain script it is in a simulated phone: "Question 1 of 5", the result
 * in the lo-fi's words, "4 more on your laptop" / "Keep going here" / "Done
 * for now", the round continuing on the phone, and what is saved for later.
 * Plus the notification, which carries its "why now" (the service worker).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import vm from "node:vm";
import { parseHTML } from "linkedom";

const WEB = path.join(import.meta.dirname, "..", "relay", "web");
const PAIR = { pairId: "a".repeat(32), token: "b".repeat(32) };
const ANDROID = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36";

const q = (n: number, lectureId = "gt-nash", unit = "Nash equilibrium", module = "GT") => ({ id: `${lectureId}-q${n}`, lectureId, stem: `${unit}: question ${n}?`, options: ["Right", "Wrong A", "Wrong B"], correct: 0, explanation: `Because of ${n}.`, slides: [10 + n], unit, module });
const nudge = (over: Record<string, unknown> = {}) => ({
	id: "N-1:gt-lecture", kind: "N-1", title: "GT just finished. One question:", body: q(1).stem, why: "lecture ended, you're free till 15:00", lectureId: "gt-nash", module: "GT", opens: "question",
	question: q(1), round: [q(2), q(3), q(4), q(5)], more: 4, fireAt: "2026-11-24T13:05:00.000Z", sentAt: "2026-11-24T13:05:10.000Z", expiresAt: "2099-01-01T00:00:00.000Z", ...over,
});

async function open(opts: { nudges?: unknown[]; blocks?: unknown[]; week?: unknown; open?: string; local?: Record<string, unknown> } = {}) {
	const { document, Event: DomEvent } = parseHTML(fs.readFileSync(path.join(WEB, "index.html"), "utf-8"));
	const local = new Map<string, string>(Object.entries({ pushOn: true, ...(opts.local ?? {}) }).map(([k, v]) => [k, JSON.stringify(v)]));
	const kv = new Map<string, string>([["/kv/pair", JSON.stringify(PAIR)]]);
	const events: { type: string; nudgeId?: string; payload: Record<string, unknown> }[] = [];
	const location = { hash: "", search: opts.open ? `?n=${encodeURIComponent(opts.open)}` : "", pathname: "/p", replace() {} };
	const context = vm.createContext({
		document, location,
		history: { replaceState: () => { location.search = ""; } },
		window: { matchMedia: () => ({ matches: true }), addEventListener: () => {} },
		navigator: { userAgent: ANDROID, standalone: false },
		localStorage: { getItem: (k: string) => local.get(k) ?? null, setItem: (k: string, v: string) => void local.set(k, v) },
		caches: { open: async () => ({ match: async (k: string) => (kv.has(k) ? new Response(kv.get(k)!) : undefined), put: async (k: string, r: Response) => void kv.set(k, await r.text()), delete: async (k: string) => kv.delete(k) }) },
		fetch: async (url: string, init: { method?: string; body?: string } = {}) => {
			if (url.endsWith("/events") && init.method === "POST") events.push(...JSON.parse(init.body!));
			return new Response(JSON.stringify(url.endsWith("/schedule") ? { nudges: opts.nudges ?? [nudge()], blocks: opts.blocks ?? [], ...(opts.week ? { week: opts.week } : {}) } : {}), { status: 200 });
		},
		Notification: { permission: "granted", requestPermission: async () => "granted" },
		crypto, Response, URLSearchParams, Date, JSON, console, setTimeout, atob, alert: () => {}, confirm: () => true,
	});
	vm.runInContext(fs.readFileSync(path.join(WEB, "app.js"), "utf-8"), context);
	const settle = () => new Promise((r) => setTimeout(r, 30));
	await settle();
	const app = document.getElementById("app")!;
	const buttons = () => [...app.querySelectorAll("button")].map((b) => (b.textContent ?? "").trim());
	return {
		app, events, buttons,
		text: () => (app.textContent ?? "").replace(/\s+/g, " ").trim(),
		saved: () => JSON.parse(local.get("saved") ?? "null") as { total: number; done: number; label: string; questions: { id: string }[] } | null,
		/** A button inside the week row whose text has `row` (v2.2: every block row has its own Move and Remove). */
		tapIn: async (row: string, label: string) => {
			const li = [...app.querySelectorAll("li")].find((x) => (x.textContent ?? "").replace(/\s+/g, " ").includes(row));
			assert.ok(li, `no row with "${row}"`);
			const b = [...li.querySelectorAll("button")].find((x) => (x.textContent ?? "").trim() === label);
			assert.ok(b, `no button "${label}" in the row "${row}"`);
			b.dispatchEvent(new DomEvent("click"));
			await settle();
		},
		tap: async (label: string) => {
			const b = [...app.querySelectorAll("button")].find((x) => (x.textContent ?? "").trim() === label);
			assert.ok(b, `no button "${label}" among: ${buttons().join(" | ")}`);
			b.dispatchEvent(new DomEvent("click"));
			await settle();
		},
	};
}
const of = <E extends { type: string }>(events: E[], type: string): E[] => events.filter((e) => e.type === type);

describe("the question after a lecture (lo-fi task 1)", () => {
	it("says which unit, \"Question 1 of 5\", and why now", async () => {
		const p = await open({ open: "N-1:gt-lecture" });
		assert.match(p.text(), /LockedIn GT · Nash equilibrium/);
		assert.match(p.text(), /Question 1 of 5/);
		assert.match(p.text(), /Nash equilibrium: question 1\?/);
		assert.match(p.text(), /Why now: lecture ended, you're free till 15:00/);
		assert.deepEqual(p.buttons().slice(0, 3), ["Right", "Wrong A", "Wrong B"]);
	});

	it("the result is in the lo-fi's words, with the slide it came from, then three ways on", async () => {
		const cases = [
			{ tap: "Right", says: /✓ Right\. Because of 1\./, correct: true },
			{ tap: "Wrong B", says: /Not quite: Right\. Because of 1\./, correct: false },
		];
		for (const c of cases) {
			const p = await open({ open: "N-1:gt-lecture" });
			await p.tap(c.tap);
			assert.match(p.text(), c.says);
			assert.match(p.text(), /Nash equilibrium · slide 11/);
			assert.deepEqual(p.buttons(), ["4 more on your laptop", "Keep going here", "Done for now"]);
			assert.equal(p.app.querySelector("button.primary")?.textContent, "4 more on your laptop");
			const [a] = of(p.events, "answered");
			assert.deepEqual(a?.payload, { questionId: "gt-nash-q1", lectureId: "gt-nash", choice: c.tap === "Right" ? 0 : 2, correct: c.correct });
		}
	});

	it("\"4 more on your laptop\" hands over the round and every answer so far", async () => {
		const p = await open({ open: "N-1:gt-lecture" });
		await p.tap("Right");
		await p.tap("4 more on your laptop");
		assert.match(p.text(), /It's waiting on your laptop\./);
		const [h] = of(p.events, "handover");
		assert.equal(h?.nudgeId, "N-1:gt-lecture");
		assert.deepEqual((h?.payload.round as { questionId: string }[]).map((r) => r.questionId), [1, 2, 3, 4, 5].map((n) => `gt-nash-q${n}`));
		assert.deepEqual(h?.payload.answers, [{ questionId: "gt-nash-q1", lectureId: "gt-nash", choice: 0, correct: true }]);
		// A laptop from before v2.1 still reads the first answer where it always was.
		assert.deepEqual([h?.payload.lectureId, h?.payload.questionId, h?.payload.choice, h?.payload.correct], ["gt-nash", "gt-nash-q1", 0, true]);
		assert.equal(p.saved(), null);
	});

	it("\"Done for now\" says what is saved, in the lo-fi's words, and tells the laptop", async () => {
		const p = await open({ open: "N-1:gt-lecture" });
		await p.tap("Right");
		await p.tap("Done for now");
		assert.match(p.text(), /Saved\. The other 4 questions wait for your next free gap\. Nothing is overdue\./);
		const [d] = of(p.events, "done_for_now");
		assert.deepEqual((d?.payload.saved as { questionId: string; lectureId: string }[]), [2, 3, 4, 5].map((n) => ({ lectureId: "gt-nash", questionId: `gt-nash-q${n}` })));
		assert.deepEqual([p.saved()?.total, p.saved()?.done, p.saved()?.questions.length], [5, 1, 4]);
	});

	it("a question with nothing after it offers no laptop and no \"keep going\"", async () => {
		const p = await open({ nudges: [nudge({ round: [], more: 0 })], open: "N-1:gt-lecture" });
		assert.match(p.text(), /Question 1 of 1/);
		await p.tap("Right");
		assert.deepEqual(p.buttons(), ["Done"]);
	});

	it("a notification from a laptop before v2.1 (no round) still hands off as it did", async () => {
		const p = await open({ nudges: [nudge({ round: undefined })], open: "N-1:gt-lecture" });
		await p.tap("Right");
		assert.deepEqual(p.buttons(), ["4 more on your laptop", "Done for now"]);
		await p.tap("4 more on your laptop");
		assert.deepEqual(of(p.events, "handover")[0]?.payload, { lectureId: "gt-nash", questionId: "gt-nash-q1", choice: 0, correct: true });
	});
});

describe("\"Keep going here\" (V-46; the lo-fi's \"Another one\" / \"Save the rest for later\")", () => {
	async function going() {
		const p = await open({ open: "N-1:gt-lecture" });
		await p.tap("Right");
		await p.tap("Keep going here");
		return p;
	}

	it("the next question comes up on the phone, counted against the round", async () => {
		const p = await going();
		assert.match(p.text(), /1 of 5 done/);
		assert.match(p.text(), /Nash equilibrium: question 2\?/);
		await p.tap("Wrong A");
		assert.match(p.text(), /Not quite: Right\. Because of 2\./);
		assert.match(p.text(), /2 of 5 done\. Up to you\./);
		assert.deepEqual(p.buttons(), ["Another one", "Save the rest for later"]);
		assert.equal(p.app.querySelector("button.primary")?.textContent, "Another one");
	});

	it("\"Save the rest for later\" saves exactly what is left", async () => {
		const p = await going();
		await p.tap("Right");
		await p.tap("Save the rest for later");
		assert.match(p.text(), /Saved\. The other 3 questions wait for your next free gap\. Nothing is overdue\./);
		assert.deepEqual((of(p.events, "done_for_now")[0]?.payload.saved as { questionId: string }[]).map((r) => r.questionId), ["gt-nash-q3", "gt-nash-q4", "gt-nash-q5"]);
		assert.deepEqual([p.saved()?.total, p.saved()?.done], [5, 2]);
	});

	it("all five on the phone ends on \"That's all 5\", with nothing saved", async () => {
		const p = await going();
		for (const n of [2, 3, 4]) {
			await p.tap("Right");
			assert.match(p.text(), new RegExp(`${n} of 5 done\\. Up to you\\.`));
			await p.tap("Another one");
		}
		await p.tap("Right");
		assert.deepEqual(p.buttons(), ["That's all 5"]);
		assert.equal(of(p.events, "answered").length, 5);
		await p.tap("That's all 5");
		assert.equal(p.saved(), null);
		assert.equal(of(p.events, "done_for_now").length, 0);
	});

	it("one question left reads \"The other question waits\"", async () => {
		const p = await going();
		for (const _ of [2, 3]) { await p.tap("Right"); await p.tap("Another one"); }
		await p.tap("Right");
		await p.tap("Save the rest for later");
		assert.match(p.text(), /Saved\. The other question waits for your next free gap\. Nothing is overdue\./);
	});
});

describe("what was saved (Jiven, 25 Nov: a card, and next after the next notification's own question)", () => {
	const saved = { total: 5, done: 1, label: "HCI · Mental models", questions: [2, 3].map((n) => q(n, "hci-models", "Mental models", "HCI")) };

	it("the home screen has one card for it, and \"Carry on\" picks the round up where it stopped", async () => {
		const p = await open({ nudges: [], local: { saved } });
		assert.match(p.text(), /2 questions saved/);
		assert.match(p.text(), /HCI · Mental models/);
		await p.tap("Carry on");
		assert.match(p.text(), /1 of 5 done/);
		assert.match(p.text(), /Mental models: question 2\?/);
		await p.tap("Right");
		assert.deepEqual(of(p.events, "answered")[0]?.payload, { questionId: "hci-models-q2", lectureId: "hci-models", choice: 0, correct: true });
		assert.equal(p.saved()?.questions.length, 1, "an answered question is no longer saved, even if the phone is closed now");
		await p.tap("Another one");
		await p.tap("Right");
		assert.deepEqual(p.buttons(), ["That's all 5"]);
	});

	it("with nothing saved there is no card", async () => {
		const p = await open({ nudges: [] });
		assert.doesNotMatch(p.text(), /saved/i);
	});

	it("the next notification keeps its own question first; the saved ones follow it, even if the laptop has not heard yet", async () => {
		const p = await open({ open: "N-1:gt-lecture", local: { saved } });
		assert.match(p.text(), /Nash equilibrium: question 1\?/);
		assert.match(p.text(), /Question 1 of 5/);
		await p.tap("Right");
		await p.tap("Keep going here");
		assert.match(p.text(), /Mental models: question 2\?/);
		await p.tap("Right");
		assert.match(p.text(), /Mental models · slide 12/);
		await p.tap("Save the rest for later");
		// Five in the round: the GT question, the two saved, then the first two of the notification's own.
		assert.deepEqual((of(p.events, "done_for_now")[0]?.payload.saved as { questionId: string }[]).map((r) => r.questionId), ["hci-models-q3", "gt-nash-q2", "gt-nash-q3"]);
	});

	it("when the laptop already put the saved ones in the round, they are not asked twice", async () => {
		const round = [q(2, "hci-models", "Mental models", "HCI"), q(3, "hci-models", "Mental models", "HCI"), q(2), q(3)];
		const p = await open({ nudges: [nudge({ round })], open: "N-1:gt-lecture", local: { saved } });
		await p.tap("Right");
		await p.tap("4 more on your laptop");
		assert.deepEqual((of(p.events, "handover")[0]?.payload.round as { questionId: string }[]).map((r) => r.questionId), ["gt-nash-q1", "hci-models-q2", "hci-models-q3", "gt-nash-q2", "gt-nash-q3"]);
		assert.equal(p.saved(), null, "the laptop has them now");
	});
});

describe("the notification itself (v2.2: the lead line and the question, nothing else)", () => {
	async function push(nudges: unknown[]) {
		const shown: { title: string; body: string }[] = [];
		const kv = new Map<string, string>([["/kv/pair", JSON.stringify(PAIR)]]);
		const handlers = new Map<string, (e: { waitUntil: (p: Promise<unknown>) => void }) => void>();
		const context = vm.createContext({
			self: {
				addEventListener: (type: string, fn: (e: { waitUntil: (p: Promise<unknown>) => void }) => void) => void handlers.set(type, fn),
				registration: { showNotification: async (title: string, o: { body: string }) => void shown.push({ title, body: o.body }) },
				clients: { claim: async () => {}, matchAll: async () => [], openWindow: async () => {} },
				skipWaiting: async () => {},
			},
			caches: { open: async () => ({ match: async (k: string) => (kv.has(k) ? new Response(kv.get(k)!) : undefined), put: async (k: string, r: Response) => void kv.set(k, await r.text()), delete: async () => true, addAll: async () => {} }), keys: async () => [], delete: async () => true, match: async () => undefined },
			fetch: async () => new Response(JSON.stringify({ nudges }), { status: 200 }),
			Response, Date, JSON, console, URL, encodeURIComponent,
		});
		vm.runInContext(fs.readFileSync(path.join(WEB, "sw.js"), "utf-8"), context);
		let done: Promise<unknown> = Promise.resolve();
		handlers.get("push")!({ waitUntil: (p) => { done = p; } });
		await done;
		return shown;
	}

	it("is the lead line and the question; the reason stays on the question screen", async () => {
		const cases = [
			{ name: "a question with a reason", n: nudge(), want: { title: "GT just finished. One question:", body: "Nash equilibrium: question 1?" } },
			{ name: "no reason", n: nudge({ why: undefined }), want: { title: "GT just finished. One question:", body: "Nash equilibrium: question 1?" } },
		];
		for (const c of cases) assert.deepEqual(await push([c.n]), [c.want], c.name);
	});
});

describe("the study block on the phone (v2.1 part B; lo-fi task 2, version B, without focus)", () => {
	// A block that started ten minutes ago today, on this phone's clock.
	const started = new Date(Date.now() - 10 * 60_000);
	const pad = (n: number) => String(n).padStart(2, "0");
	const date = `${started.getFullYear()}-${pad(started.getMonth() + 1)}-${pad(started.getDate())}`;
	const start = `${pad(started.getHours())}:${pad(started.getMinutes())}`;
	const tomorrow = new Date(started.getTime() + 86_400_000);
	const tomorrowKey = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`;
	const block = (over: Record<string, unknown> = {}) => ({
		id: "blk1", date, start, minutes: 50, status: "accepted", focus: { title: "Lecture 7", module: "HCI" },
		goal: "5 questions, about 10 min", firstStep: "open slide 12, answer one question", onLaptop: "open Lecture 7 at slide 12 on your laptop and answer one question.", why: null,
		moves: [{ kind: "today", date, start: "16:00", label: "Today 16:00" }, { kind: "evening", date, start: "18:00", label: "This evening 18:00" }, { kind: "tomorrow", date: tomorrowKey, start: "08:00", label: "Tomorrow 08:00" }, { kind: "next", date, start: "15:00", label: "next free gap" }],
		...over,
	});
	const blockNudge = { id: `block:blk1:${date}`, kind: "block", blockId: "blk1", title: "Thu 14:00 · your study block", body: "Lecture 7. First step: slide 12, one question.", opens: "session", fireAt: started.toISOString(), sentAt: started.toISOString(), expiresAt: "2099-01-01T00:00:00.000Z" };
	const opened = (b = block(), local: Record<string, unknown> = {}) => open({ nudges: [blockNudge], blocks: [b], open: blockNudge.id, local });
	const PLACES = ["Library", "Desk", "Bed", "Café", "On the move"];
	// v2.2 part C: a block that is near arrives with its unit's questions, for "On the move".
	const rq = (n: number) => ({ id: `l7-q${n}`, lectureId: "hci-l7", stem: `Lecture 7: question ${n}?`, options: ["Right", "Wrong A", "Wrong B"], correct: 0, explanation: `Because ${n}.`, slides: [12], unit: "Lecture 7", module: "HCI" });
	const withRound = (n = 5) => block({ round: Array.from({ length: n }, (_, i) => rq(i + 1)) });

	it("the notification opens the block: its goal, its first step, and two ways on", async () => {
		const p = await opened();
		assert.match(p.text(), /^Study block /);
		assert.match(p.text(), new RegExp(`${start}-\\d\\d:\\d\\d`));
		assert.match(p.text(), /Goal: 5 questions, about 10 min/);
		assert.match(p.text(), /First step: open slide 12, answer one question/);
		assert.deepEqual(p.buttons(), [...PLACES, "Take the first step", "Not now"]);
		assert.equal(p.app.querySelector("button.primary")?.textContent, "Take the first step");
	});

	it("\"Take the first step\" starts it: the time left, the step on the laptop, and the phone put down", async () => {
		const p = await opened();
		await p.tap("Take the first step");
		assert.match(p.text(), /(39|40) min left/);
		assert.match(p.text(), /First step: open Lecture 7 at slide 12 on your laptop and answer one question\./);
		assert.match(p.text(), /Put your phone face down\./);
		assert.deepEqual(p.buttons(), ["Open on my laptop", "End block"]);
		assert.deepEqual(of(p.events, "focus_start")[0]?.payload, { blockId: "blk1" });
		await p.tap("Open on my laptop");
		assert.deepEqual(of(p.events, "handover")[0]?.payload, { blockId: "blk1" });
		assert.match(p.text(), /It's waiting on your laptop\./);
	});

	it("\"End block\" says nothing is lost", async () => {
		const p = await opened();
		await p.tap("Take the first step");
		await p.tap("End block");
		assert.match(p.text(), /Block ended\. Nothing is lost: the session waits on your laptop\./);
		assert.deepEqual(of(p.events, "focus_end")[0]?.payload, { blockId: "blk1" });
	});

	it("\"Not now\" offers the times the laptop found, and moving says when the next nudge comes", async () => {
		const p = await opened();
		await p.tap("Not now");
		assert.match(p.text(), /When suits you better\? The rest of the block moves there\. Nothing is marked missed\./);
		assert.deepEqual(p.buttons(), ["Today 16:00", "This evening 18:00", "Tomorrow 08:00", "Pick for me: next free gap"]);
		await p.tap("Tomorrow 08:00");
		assert.match(p.text(), /Moved to Tomorrow 08:00\. LockedIn will notify you then, and not before\./);
		const [m] = of(p.events, "plan_move");
		assert.deepEqual([m?.payload.blockId, m?.payload.date, m?.payload.start], ["blk1", tomorrowKey, "08:00"]);
		assert.equal(m?.payload.fireAt, new Date(`${tomorrowKey}T08:00:00`).toISOString(), "the relay is told the moment, on this phone's clock");
		assert.match(String(m?.payload.title), /^\w{3} 08:00 · your study block$/);
	});

	it("\"Pick for me\" takes the next free gap", async () => {
		const p = await opened();
		await p.tap("Not now");
		await p.tap("Pick for me: next free gap");
		assert.match(p.text(), /Moved to next free gap\./);
		assert.deepEqual([of(p.events, "plan_move")[0]?.payload.date, of(p.events, "plan_move")[0]?.payload.start], [date, "15:00"]);
	});

	it("with nowhere to move it, \"Not now\" says so and changes nothing", async () => {
		const p = await opened(block({ moves: [] }));
		await p.tap("Not now");
		assert.match(p.text(), /No free gap is left this week\./);
		assert.equal(of(p.events, "plan_move").length, 0);
	});

	it("asks where you are as an option (v2.2): the start buttons work with nothing picked, and nothing is sent", async () => {
		const p = await opened();
		assert.match(p.text(), /Where are you\? \(optional\)/);
		assert.match(p.text(), /You tell us\. We never track your location\./);
		await p.tap("Take the first step");
		assert.match(p.text(), /Put your phone face down\./);
		assert.equal(of(p.events, "block_where").length, 0);
	});

	it("Library and Desk go straight on; the place is told to the laptop's log, and the desk has its own tip", async () => {
		const p = await opened();
		await p.tap("Desk");
		assert.deepEqual(of(p.events, "block_where").map((e) => e.payload), [{ blockId: "blk1", place: "Desk" }]);
		assert.equal(p.app.querySelector("button[aria-pressed=true]")?.textContent, "Desk");
		assert.deepEqual(p.buttons(), [...PLACES, "Take the first step", "Not now"]);
		await p.tap("Take the first step");
		assert.match(p.text(), /At your desk\. Phone face down, out of reach if you can\./);
		assert.doesNotMatch(p.text(), /Put your phone face down\./);
	});

	const askFirst: { place: string; tip: RegExp; running: RegExp }[] = [
		{ place: "Bed", tip: /Sitting up, phone out of reach, makes starting easier\./, running: /Phone across the room, if you can\./ },
		{ place: "Café", tip: /Headphones help if it's busy\./, running: /Headphones on, phone face down\./ },
	];
	for (const c of askFirst) {
		it(`${c.place} asks "study now, or later?" before anything else`, async () => {
			const p = await opened();
			await p.tap(c.place);
			assert.match(p.text(), /Do you want to study now, or later\?/);
			assert.deepEqual(p.buttons(), [...PLACES, "Study now", "Later"]);
			await p.tap("Study now");
			assert.match(p.text(), c.tip);
			assert.deepEqual(p.buttons(), [...PLACES, "Take the first step", "Not now"]);
			await p.tap("Take the first step");
			assert.match(p.text(), c.running);
		});
	}

	it("\"Later\" from bed goes straight to moving the block", async () => {
		const p = await opened();
		await p.tap("Bed");
		await p.tap("Later");
		assert.match(p.text(), /When suits you better\? The rest of the block moves there\. Nothing is marked missed\./);
	});

	it("tapping the picked place again un-picks it", async () => {
		const p = await opened();
		await p.tap("Bed");
		await p.tap("Bed");
		assert.equal(p.app.querySelector("button[aria-pressed=true]"), null);
		assert.deepEqual(p.buttons(), [...PLACES, "Take the first step", "Not now"]);
		assert.equal(of(p.events, "block_where").length, 1, "un-picking sends nothing");
	});

	it("On the move: one question now, then another one or the rest later", async () => {
		const p = await opened(withRound());
		await p.tap("On the move");
		assert.match(p.text(), /Not a good moment for a full block\. One question now, and the rest when you sit down\?/);
		assert.deepEqual(p.buttons(), [...PLACES, "Answer one question now", "Just move the block"]);
		assert.equal(p.app.querySelector("button.primary")?.textContent, "Answer one question now");
		await p.tap("Answer one question now");
		assert.match(p.text(), /^On the move 0 of 5 done ?Lecture 7: question 1\?/);
		await p.tap("Right");
		assert.match(p.text(), /✓ Right\. Because 1\./);
		assert.match(p.text(), /1 of 5 done\. Up to you\./);
		assert.deepEqual(p.buttons(), ["Another one", "Save the rest for later"]);
		assert.deepEqual(of(p.events, "answered")[0]?.payload, { blockId: "blk1", onTheMove: true, lectureId: "hci-l7", questionId: "l7-q1", choice: 0, correct: true });
		await p.tap("Another one");
		assert.match(p.text(), /^On the move 1 of 5 done ?Lecture 7: question 2\?/);
		await p.tap("Wrong A");
		assert.match(p.text(), /Not quite: Right\./);
		await p.tap("Save the rest for later");
		assert.match(p.text(), /When suits you better\? 2 of 5 done\. The rest of the block moves there\. Nothing is marked missed\./);
		await p.tap("Tomorrow 08:00");
		assert.match(p.text(), /Moved to Tomorrow 08:00\. You've already done 2 of 5\. LockedIn will notify you then, and not before\./);
		assert.equal(of(p.events, "focus_start").length, 0, "the block is not started: the rest of it moved");
	});

	it("all five on the move finishes the block", async () => {
		const p = await opened(withRound());
		await p.tap("On the move");
		await p.tap("Answer one question now");
		for (let i = 1; i <= 5; i++) {
			await p.tap("Right");
			if (i < 5) await p.tap("Another one");
		}
		assert.deepEqual(p.buttons(), ["That's all 5"]);
		await p.tap("That's all 5");
		assert.match(p.text(), /All 5 done, on the move\. Nothing left for this block\. Anything you got wrong comes back in a later review\./);
		assert.doesNotMatch(p.text(), /missed/);
		assert.deepEqual(of(p.events, "focus_start").map((e) => e.payload), [{ blockId: "blk1" }]);
		assert.equal(of(p.events, "answered").length, 5);
	});

	it("a block opened again after some answers carries on where it stopped", async () => {
		const p = await opened(withRound(), { onMove: { blk1: ["l7-q1", "l7-q2"] } });
		await p.tap("On the move");
		await p.tap("Answer one question now");
		assert.match(p.text(), /^On the move 2 of 5 done ?Lecture 7: question 3\?/);
	});

	it("\"Just move the block\" opens the move screen; a short bank counts what is really there", async () => {
		const p = await opened(withRound(2));
		await p.tap("On the move");
		await p.tap("Just move the block");
		assert.match(p.text(), /When suits you better\? The rest of the block moves there\./);
		const q = await opened(withRound(2));
		await q.tap("On the move");
		await q.tap("Answer one question now");
		assert.match(q.text(), /^On the move 0 of 2 done/);
	});

	it("a block with no questions to ask offers only to move it", async () => {
		const p = await opened();
		await p.tap("On the move");
		assert.match(p.text(), /Not a good moment for a full block\./);
		assert.doesNotMatch(p.text(), /One question now/);
		assert.deepEqual(p.buttons(), [...PLACES, "Just move the block"]);
	});

	it("a block from a laptop before v2.1 (no goal or first step) still opens, on the laptop as before", async () => {
		const p = await opened({ id: "blk1", date, start, minutes: 50, status: "accepted", focus: { title: "Lecture 7", module: "HCI" } } as never);
		assert.match(p.text(), /Lecture 7\. First step: slide 12, one question\./);
		assert.ok(p.buttons().includes("Done for now"));
	});
});

describe("your week on the phone (v2.1 part C; lo-fi task 3)", () => {
	// Dates from tomorrow on, on this phone's clock, so nothing here is in the past.
	const pad = (n: number) => String(n).padStart(2, "0");
	const day = (plus: number) => { const d = new Date(Date.now() + plus * 86_400_000); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
	const short = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short" });
	const [d1, d2, d3] = [day(1), day(2), day(3)];
	const blocks = () => [
		{ id: "blk-a", date: d1, start: "14:00", minutes: 50, status: "accepted", focus: { title: "Nash equilibrium", module: "GT" }, goal: "5 questions, about 10 min", firstStep: null, onLaptop: null, why: "because you have energy in the afternoon", moves: [] },
		{ id: "blk-b", date: d2, start: "10:00", minutes: 50, status: "proposed", focus: null, goal: "5 questions, about 10 min", firstStep: null, onLaptop: null, why: null, moves: [] },
	];
	const week = (over: Record<string, unknown> = {}) => ({ lectures: [{ date: d1, start: "11:00", title: "HCI lecture" }], free: [{ date: d2, start: "16:00" }, { date: d3, start: "09:00" }], nudgesPerDay: 1, blockMinutes: 50, ...over });
	const home = (over: { blocks?: unknown[]; week?: unknown } = {}) => open({ nudges: [], blocks: over.blocks ?? blocks(), week: over.week ?? week() });

	it("lists lectures and blocks in order, says how many blocks, and why a block is where it is", async () => {
		const p = await home();
		assert.match(p.text(), /Your week/);
		assert.match(p.text(), /2 suggested blocks in your free gaps\. Move or remove any of them\./);
		assert.match(p.text(), new RegExp(`${short(d1)} HCI lecture 11:00`));
		assert.match(p.text(), new RegExp(`${short(d1)} Study 14:00 · Nash equilibrium`));
		assert.match(p.text(), /because you have energy in the afternoon/);
		assert.ok(p.text().indexOf("HCI lecture 11:00") < p.text().indexOf("Study 14:00"), "in time order");
		for (const label of ["Add a block", "Settings", "Looks good"]) assert.ok(p.buttons().includes(label), label);
		assert.doesNotMatch(p.text(), /null|undefined/, "nothing missing is written out");
	});

	it("counts in the lo-fi's words", async () => {
		assert.match((await home({ blocks: [blocks()[0]] })).text(), /One suggested block in your free gaps\. Move or remove it\./);
		assert.match((await home({ blocks: [] })).text(), /No study blocks this week\. That's fine too\./);
	});

	it("every block shows \"Move\" and \"Remove\" without being opened (v2.2, LF-10); moving offers the free times and leaves a \"moved\" tag", async () => {
		const p = await home();
		assert.deepEqual([p.buttons().filter((b) => b === "Move").length, p.buttons().filter((b) => b === "Remove").length], [2, 2]);
		await p.tapIn("Study 14:00 · Nash equilibrium", "Move");
		assert.match(p.text(), /Move to a free gap:/);
		assert.ok(p.buttons().includes(`${short(d2)} 16:00`) && p.buttons().includes(`${short(d3)} 09:00`) && p.buttons().includes("Cancel"));
		await p.tap(`${short(d3)} 09:00`);
		const [m] = of(p.events, "plan_move");
		assert.deepEqual([m?.payload.blockId, m?.payload.date, m?.payload.start, m?.payload.fireAt], ["blk-a", d3, "09:00", new Date(`${d3}T09:00:00`).toISOString()]);
		assert.match(p.text(), new RegExp(`${short(d3)} Study 09:00 · Nash equilibrium moved`));
		// The time it took is not offered again.
		await p.tapIn(`${short(d2)} Study 10:00`, "Move");
		assert.ok(!p.buttons().includes(`${short(d3)} 09:00`));
		await p.tap("Cancel");
		assert.equal(of(p.events, "plan_move").length, 1);
	});

	it("\"Remove\" can be undone, once", async () => {
		const p = await home();
		await p.tapIn("Study 14:00 · Nash equilibrium", "Remove");
		assert.deepEqual(of(p.events, "plan_remove")[0]?.payload, { blockId: "blk-a" });
		assert.match(p.text(), new RegExp(`Removed ${short(d1)} block ·`));
		assert.match(p.text(), /One suggested block/);
		await p.tap("Undo");
		assert.deepEqual(of(p.events, "plan_tick")[0]?.payload, { blockId: "blk-a", restore: true });
		assert.match(p.text(), /2 suggested blocks/);
		assert.ok(!p.buttons().includes("Undo"));
	});

	it("\"Add a block\" takes the first free time", async () => {
		const p = await home();
		await p.tap("Add a block");
		const [a] = of(p.events, "plan_add");
		assert.deepEqual([a?.payload.date, a?.payload.start, a?.payload.minutes, a?.payload.fireAt], [d2, "16:00", 50, new Date(`${d2}T16:00:00`).toISOString()]);
		assert.match(String(a?.payload.blockId), /^phone-[0-9a-f]{12}$/);
		assert.match(p.text(), new RegExp(`${short(d2)} Study 16:00 moved`));
		assert.match(p.text(), /3 suggested blocks/);
	});

	it("\"Looks good\" keeps the suggestions and says the week is set", async () => {
		const p = await home();
		await p.tap("Looks good");
		assert.deepEqual(of(p.events, "plan_tick").map((e) => e.payload), [{ blockId: "blk-b" }]);
		assert.match(p.text(), /Your week is set\. 2 study blocks\./);
		assert.match(p.text(), /LockedIn will notify you when each one starts\. You can change them any time\./);
		const off = await home({ week: week({ nudgesPerDay: 0 }) });
		await off.tap("Looks good");
		assert.match(off.text(), /Notifications are off, so LockedIn won't buzz\. Your blocks are still here\. You can change them any time\./);
		const one = await home({ blocks: [blocks()[0]] });
		await one.tap("Looks good");
		assert.match(one.text(), /Your week is set\. One study block\./);
	});

	it("Settings is reached from the week: nudges per day, and what LockedIn uses", async () => {
		const p = await home();
		await p.tap("Settings");
		assert.match(p.text(), /Notifications per day/);
		assert.match(p.text(), /One a day, and it's the first question\./);
		assert.match(p.text(), /What LockedIn uses Timetable: yes Lecture slides: yes Location: never\./);
		await p.tap("0");
		assert.deepEqual(of(p.events, "prefs")[0]?.payload, { nudgesPerDay: 0 });
		assert.match(p.text(), /LockedIn won't buzz\. Your blocks stay in your week\./);
		await p.tap("2");
		assert.match(p.text(), /Up to two a day\. Never repeated\./);
		assert.ok(p.buttons().includes("Unpair this phone"), "what Settings held before is still there");
		await p.tap("Done");
		assert.match(p.text(), /Your week/);
	});

	it("a laptop or relay from before v2.1 (no week) shows the blocks as it did", async () => {
		const p = await open({ nudges: [], blocks: blocks() });
		assert.match(p.text(), /This week/);
		assert.ok(p.buttons().includes("✓ Keep"));
	});
});
