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

async function open(opts: { nudges?: unknown[]; open?: string; local?: Record<string, unknown> } = {}) {
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
			return new Response(JSON.stringify(url.endsWith("/schedule") ? { nudges: opts.nudges ?? [nudge()], blocks: [] } : {}), { status: 200 });
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

describe("the notification itself (lo-fi: \"Why now\" on the lock screen)", () => {
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

	it("says why now under the question; a notification with no reason is left as it was", async () => {
		const cases = [
			{ name: "a question with a reason", n: nudge(), want: { title: "GT just finished. One question:", body: "Nash equilibrium: question 1?\nWhy now: lecture ended, you're free till 15:00" } },
			{ name: "no reason", n: nudge({ why: undefined }), want: { title: "GT just finished. One question:", body: "Nash equilibrium: question 1?" } },
		];
		for (const c of cases) assert.deepEqual(await push([c.n]), [c.want], c.name);
	});
});
