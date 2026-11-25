/**
 * The phone, end to end in one process (v0.1 F-112, J2′, J9): the laptop's
 * CompanionService talks to the real relay code (relay/src/relay.ts on
 * node:sqlite) through its RelayClient, and the test plays the phone's
 * side through the relay API. Plus the pure sync rules (sync.ts).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { applyPlanEdits, eventsToReplay, nextVersion, PHONE_TEST_COPY, scheduleFingerprint, type StudyBlock } from "../src/core/companion/index.ts";
import type { Db, Stmt } from "../relay/src/db.ts";
import { handle, type RelayEnv } from "../relay/src/relay.ts";
import { ManualClock } from "../src/server/companion/clock.ts";
import { CompanionContent } from "../src/server/companion/content.ts";
import { ScriptedEngine } from "../src/server/companion/engines/scripted.ts";
import { CompanionService } from "../src/server/companion/service.ts";
import { CompanionStore } from "../src/server/companion/store.ts";

const CONTENT = path.join(import.meta.dirname, "..", "companion", "content");
const RELAY = "https://relay.test";

function sqliteDb(): Db {
	const db = new DatabaseSync(":memory:");
	db.exec(fs.readFileSync(path.join(import.meta.dirname, "..", "relay", "schema.sql"), "utf-8"));
	const stmt = (sql: string, values: unknown[] = []): Stmt => ({
		bind: (...v) => stmt(sql, v),
		first: async <T,>() => (db.prepare(sql).get(...(values as never[])) as T | undefined) ?? null,
		all: async <T,>() => ({ results: db.prepare(sql).all(...(values as never[])) as T[] }),
		run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...(values as never[])).changes) } }),
	});
	return { prepare: (sql) => stmt(sql), batch: async (stmts) => Promise.all(stmts.map((s) => s.run())) };
}

async function setup(opts: { relayDown?: boolean; packs?: boolean } = {}) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "companion-phone-"));
	const store = new CompanionStore(dir);
	const content = new CompanionContent(store, CONTENT);
	const clock = new ManualClock(new Date(2026, 10, 17, 12, 58)); // Tue: HCI 11-13 in the sample week
	const scripted = new ScriptedEngine((id) => content.scriptedSet(id));
	const relayEnv: RelayEnv = { DB: sqliteDb() };
	const relayFetch: typeof fetch = async (input, init) => {
		if (opts.relayDown) throw new Error("relay unreachable");
		// The relay shares the laptop's (demo) clock here; in real use both are real time.
		return handle(new Request(String(input), init as RequestInit), relayEnv, clock.now());
	};
	let n = 0;
	const svc = new CompanionService({
		store, content, clock,
		clockControl: { set: (t) => clock.set(t), reset: () => undefined },
		engines: { scripted, learnharness: scripted },
		defaultEngine: "scripted",
		relay: { url: RELAY, fetch: relayFetch },
		// Study packs exist once the AI is wired (question banks are read from them).
		...(opts.packs ? { generate: (async () => { throw new Error("not called"); }) as never } : {}),
		newId: (p) => `${p}${++n}`,
	});
	svc.demoScenario({ name: "tayo" });
	// The phone's side: the relay API with the token from the QR link.
	const phone = async (method: string, p: string, token: string, body?: unknown) => {
		const res = await relayFetch(`${RELAY}${p}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
		return res.status === 204 ? null : res.json();
	};
	/** A student's own unit with a study pack's question bank (no timetable slot of its own). */
	const addUnit = (id: string, module: string, title: string, questions = 3) => {
		store.saveLectures([...store.allLectures(), { id, module, title, week: 0, order: 99, kind: "lecture", hasMaterials: true, source: { file: "notes.pdf", pages: [1, 4] } }]);
		fs.mkdirSync(store.materialsDir(id), { recursive: true });
		fs.writeFileSync(path.join(store.materialsDir(id), "slides.md"), `# ${title}\n\n## Slide 1 — ${title}\n\nText.\n`);
		fs.writeFileSync(path.join(store.materialsDir(id), "bank.json"), JSON.stringify(Array.from({ length: questions }, (_, i) => ({ id: `${id}-q${i + 1}`, stem: `${title}: question ${i + 1}?`, options: ["Right", "Wrong A", "Wrong B"], correct: 0, explanation: "Because (Slide 1).", slides: [1], node: "idea", difficulty: 1 }))));
	};
	return { svc, store, clock, phone, addUnit, events: () => store.events().map((e) => e.type) };
}

const fromLink = (url: string) => {
	const m = /\/p#([0-9a-f]{32})\.([0-9a-f]{32})$/.exec(url)!;
	return { pairId: m[1]!, token: m[2]! };
};

describe("pairing (J9)", () => {
	it("pairs, shows a QR for the link, uploads the week, and the phone can read it", async () => {
		const { svc, phone, events } = await setup();
		const p = await svc.requirePhone().pair();
		assert.match(p.url, /^https:\/\/relay\.test\/p#[0-9a-f]{32}\.[0-9a-f]{32}$/);
		assert.match(p.qrSvg, /^<svg/);
		const { pairId, token } = fromLink(p.url);
		const s = (await phone("GET", `/v1/pairs/${pairId}/schedule`, token)) as { nudges: { kind: string; title: string; question?: unknown; more?: number }[] };
		assert.ok(s.nudges.length > 0, "the week's nudges are on the relay");
		const n1 = s.nudges.find((x) => x.kind === "N-1");
		assert.equal(n1?.more, 4, "\"4 more on your laptop\" comes from the post-lecture budget");
		assert.ok(events().includes("phone_paired") && events().includes("schedule_uploaded"));
		assert.equal(svc.today().phonePaired, true);
	});

	it("the pairing comes with a 6-digit code and the short address, and a phone that types the code is paired (v1.0.3)", async () => {
		const { svc, phone, clock } = await setup();
		const p = await svc.requirePhone().pair();
		assert.match(p.code ?? "", /^\d{6}$/);
		assert.equal(p.address, "relay.test/p", "what to type when the camera won't scan: no token in it");
		assert.equal((await svc.requirePhone().pair()).code, p.code, "showing the panel again shows the same code while it lasts");
		// The phone types it into the installed app.
		const claimed = (await phone("POST", "/v1/claim", "", { code: p.code })) as { pairId: string; token: string };
		assert.equal(claimed.pairId, fromLink(p.url).pairId);
		const s = (await phone("GET", `/v1/pairs/${claimed.pairId}/schedule`, claimed.token)) as { nudges: unknown[] };
		assert.ok(s.nudges.length > 0, "the phone that typed the code reads the week");
		assert.ok((await svc.requirePhone().status()).phoneSeenAt, "and the laptop sees it arrive");
		// The code is used up: the panel gets a new one.
		clock.advanceMinutes(1);
		assert.notEqual((await svc.requirePhone().pair()).code, p.code);
	});

	it("unpair deletes the relay's data; so does Delete all my data", async () => {
		const { svc, phone } = await setup();
		const { pairId, token } = fromLink((await svc.requirePhone().pair()).url);
		await svc.requirePhone().unpair();
		assert.equal(((await phone("GET", `/v1/pairs/${pairId}/schedule`, token)) as { error?: string }).error, "unauthorised");
		assert.equal(svc.today().phonePaired, false);
		const again = fromLink((await svc.requirePhone().pair()).url);
		await svc.deleteAll();
		assert.equal(((await phone("GET", `/v1/pairs/${again.pairId}/schedule`, again.token)) as { error?: string }).error, "unauthorised");
	});
});

describe("the hand-off (J2′)", () => {
	async function answeredOnPhone(correct: boolean) {
		const s = await setup();
		const { pairId, token } = fromLink((await s.svc.requirePhone().pair()).url);
		// The N-1 the laptop planned for Tuesday's HCI lecture (no pack here, so the v1 nudge: answer a scripted question).
		const lectureId = "hci-w3-personas";
		const set = (await import("../src/server/companion/content.ts")).CompanionContent.prototype.scriptedSet.call(new CompanionContent(s.store, CONTENT), lectureId)!;
		const q = set.questions[0]!;
		const choice = correct ? q.correct[0]! : (q.correct[0]! + 1) % q.options.length;
		const base = { nudgeId: `N-1:${lectureId}`, lectureId, questionId: q.id, choice, correct };
		await s.phone("POST", `/v1/pairs/${pairId}/events`, token, [
			{ id: "evt-answer-0001", at: new Date(2026, 10, 17, 13, 6).toISOString(), type: "answered", payload: base },
			{ id: "evt-handover-01", at: new Date(2026, 10, 17, 13, 7).toISOString(), type: "handover", payload: base },
		]);
		const r = await s.svc.requirePhone().sync({ force: true });
		return { ...s, r, q, lectureId };
	}

	it("the laptop session opens at question 2 with question 1's answer recorded, and a toast says so", async () => {
		const { svc, store, r, q } = await answeredOnPhone(true);
		assert.equal(r.replayed, 2);
		const toast = store.nudges().find((n) => n.key.startsWith("handoff:"));
		assert.equal(toast?.text, "Question 1 answered on your phone ✓ 4 more ready.");
		const session = store.session(toast!.sessionId!)!;
		assert.equal(session.spec.seedAnswer?.questionId, q.id);
		await svc.whenReady(session.id);
		const v = await svc.view(session.id);
		assert.equal(v.answered, 1, "the budget counts the phone answer");
		assert.equal(v.feedback?.questionId, q.id, "question 1's answer is shown");
		assert.notEqual(v.question?.id, q.id, "the next question is a different one");
	});

	it("the laptop's own copy of that nudge is dropped: never a duplicate", async () => {
		const { store } = await answeredOnPhone(true);
		const laptopN1 = [...store.nudges()].reverse().find((n) => n.key === "N-1:hci-w3-personas");
		assert.equal(laptopN1?.outcome, "opened");
	});

	it("every phone event is logged under its own type with source phone", async () => {
		const { store } = await answeredOnPhone(true);
		const phoneEvents = store.events().filter((e) => e.data.source === "phone").map((e) => e.type);
		assert.deepEqual(phoneEvents, ["answered", "handover"]);
	});

	it("replaying the same events twice changes nothing", async () => {
		const { svc, store } = await answeredOnPhone(true);
		const before = [store.nudges().length, store.sessions().length, store.events().length];
		const link = svc.requirePhone();
		const again = link.replay([{ id: "evt-handover-01", at: new Date(2026, 10, 17, 13, 7).toISOString(), type: "handover", payload: { lectureId: "hci-w3-personas" } }]);
		assert.equal(again, 0);
		assert.deepEqual([store.nudges().length, store.sessions().length, store.events().length], before);
	});
});

describe("plan edits and the check-in from the phone", () => {
	it("a tick accepts a proposal; an edit to a block removed on the laptop is ignored and logged", async () => {
		const { svc, store, events } = await setup();
		svc.saveRoutine({ routine: { energy: ["afternoon"], commitments: [], places: [], weeklyTargetMinutes: 150 }, source: "form" });
		const [a, b] = store.blocks().filter((x) => x.status === "proposed");
		svc.updateBlock(b!.id, { status: "removed" });
		const link = svc.requirePhone();
		const later = new Date(Date.now() + 60_000).toISOString();
		link.replay([
			{ id: "evt-tick-00001", at: later, type: "plan_tick", payload: { blockId: a!.id } },
			{ id: "evt-tick-00002", at: later, type: "plan_tick", payload: { blockId: b!.id } },
		]);
		assert.equal(store.blocks().find((x) => x.id === a!.id)?.status, "accepted");
		assert.equal(store.blocks().find((x) => x.id === b!.id)?.status, "removed");
		assert.ok(events().includes("relay_error"), "the ignored edit is logged");
	});
});

describe("the study block on the phone (v2.1 part B; lo-fi task 2)", () => {
	type B = { id: string; date: string; start: string; minutes: number; status: string; goal?: string; firstStep?: string | null; onLaptop?: string | null; why?: string | null; moves?: { kind: string; date: string; start: string; label: string }[] };
	type N = { id: string; kind: string; title: string; body: string; blockId?: string; fireAt: string };
	/** Tuesday 17 Nov, 12:58. One accepted block today at 14:00 on a unit with a study pack. */
	async function withBlock(opts: { newRelay?: boolean } = {}) {
		const s = await setup({ packs: true });
		s.addUnit("gt-nash", "GT", "Nash equilibrium", 6);
		const block: StudyBlock = { id: "blk-thu", date: "2026-11-17", start: "14:00", minutes: 50, status: "accepted", source: "student", lectureId: "gt-nash", module: "GT", firstTaskQuestionId: "gt-nash-q1" };
		s.store.saveBlocks([block]);
		const { pairId, token } = fromLink((await s.svc.requirePhone().pair()).url);
		if (opts.newRelay === false) s.store.saveRuntime({ relayNudgeChars: undefined });
		const read = async () => (await s.phone("GET", `/v1/pairs/${pairId}/schedule`, token)) as { blocks: B[]; nudges: N[] };
		return { ...s, block, read };
	}

	it("the block's notification is the lo-fi's: its day and time, the unit and the first step", async () => {
		const { svc } = await withBlock();
		const n = svc.requirePhone().buildSchedule().nudges.find((x) => x.kind === "block")!;
		assert.deepEqual([n.title, n.body, n.blockId], ["Tue 14:00 · your study block", "Nash equilibrium. First step: slide 1, one question.", "blk-thu"]);
	});

	it("each block arrives with its goal, its first step, why it is there and where it can move to", async () => {
		const { svc, read } = await withBlock();
		await svc.requirePhone().sync({ force: true });
		const b = (await read()).blocks.find((x) => x.id === "blk-thu")!;
		assert.equal(b.goal, "5 questions, about 10 min");
		assert.equal(b.firstStep, "open slide 1, answer one question");
		assert.equal(b.onLaptop, "open Nash equilibrium at slide 1 on your laptop and answer one question.");
		// 12:58 on a day with the HCI lecture until 13:00: the times are the planner's own (a quarter past, after the lecture's ten minutes).
		assert.deepEqual(b.moves?.map((m) => m.label), ["Today 15:15", "This evening 18:15", "Tomorrow 08:00", "next free gap"]);
		assert.ok(b.moves!.every((m) => /^\d{4}-\d{2}-\d{2}$/.test(m.date) && /^\d{2}:\d{2}$/.test(m.start)));
	});

	it("a relay from before v2.1 gets the blocks as they were, so its size limit is never hit", async () => {
		const { svc } = await withBlock({ newRelay: false });
		const b = svc.requirePhone().buildSchedule().blocks.find((x) => x.id === "blk-thu")! as B;
		assert.deepEqual(Object.keys(b).sort(), ["date", "focus", "id", "minutes", "start", "status"]);
	});

	it("\"Take the first step\" on the phone starts the block; \"Open on my laptop\" opens its session there with the lo-fi's line", async () => {
		const { svc, store, events } = await withBlock();
		const link = svc.requirePhone();
		const at = new Date(2026, 10, 17, 14, 1).toISOString();
		svc.demoClock({ set: new Date(2026, 10, 17, 14, 0).toISOString() });
		link.replay([{ id: "evt-block-0001", at, type: "focus_start", payload: { blockId: "blk-thu" } }]);
		assert.equal(store.blocks()[0]!.status, "started");
		assert.ok(events().includes("block_started"));
		link.replay([{ id: "evt-block-0002", at, type: "handover", payload: { blockId: "blk-thu" } }]);
		const toast = store.nudges().find((n) => n.key === "handoff:evt-block-0002")!;
		assert.equal(toast.text, "Your study block is open. Nash equilibrium from slide 1. 5 questions, about 10 min.");
		assert.ok(toast.sessionId && store.session(toast.sessionId), "its session is ready on the laptop");
		// The same event again changes nothing.
		link.replay([{ id: "evt-block-0002", at, type: "handover", payload: { blockId: "blk-thu" } }]);
		assert.equal(store.nudges().filter((n) => n.key.startsWith("handoff:")).length, 1);
	});

	it("a move made on the phone moves the block on the laptop, and its notification with it", async () => {
		const { svc, store } = await withBlock();
		const link = svc.requirePhone();
		link.replay([{ id: "evt-block-0003", at: new Date(Date.now() + 60_000).toISOString(), type: "plan_move", payload: { blockId: "blk-thu", date: "2026-11-18", start: "08:00" } }]);
		assert.deepEqual([store.blocks()[0]!.date, store.blocks()[0]!.start], ["2026-11-18", "08:00"]);
		const n = link.buildSchedule().nudges.find((x) => x.kind === "block")!;
		assert.equal(n.title, "Wed 08:00 · your study block");
	});
});

describe("the week on the phone (v2.1 part C; lo-fi task 3)", () => {
	type W = { lectures: { date: string; start: string; title: string }[]; free: { date: string; start: string }[]; nudgesPerDay: number; blockMinutes: number };
	async function withWeek() {
		const s = await setup({ packs: true });
		s.store.saveBlocks([{ id: "blk-a", date: "2026-11-18", start: "14:00", minutes: 50, status: "accepted", source: "student" }, { id: "blk-b", date: "2026-11-19", start: "10:00", minutes: 50, status: "proposed", source: "planner" }]);
		const { pairId, token } = fromLink((await s.svc.requirePhone().pair()).url);
		const read = async () => (await s.phone("GET", `/v1/pairs/${pairId}/schedule`, token)) as { week?: W };
		const later = () => new Date(Date.now() + 60_000).toISOString();
		return { ...s, read, later };
	}

	it("the phone is sent the week's lectures, a free time for each day ahead, and the nudges setting", async () => {
		const { svc, read } = await withWeek();
		await svc.requirePhone().sync({ force: true });
		const w = (await read()).week!;
		assert.equal(w.nudgesPerDay, 1);
		assert.equal(w.blockMinutes, 50);
		assert.ok(w.lectures.length > 0 && w.lectures.every((l) => /^\d{4}-\d{2}-\d{2}$/.test(l.date) && /^\d{2}:\d{2}$/.test(l.start) && l.title));
		assert.ok(w.free.length > 0 && w.free.length <= 7);
		assert.equal(new Set(w.free.map((f) => f.date)).size, w.free.length, "one a day");
		assert.ok(!w.free.some((f) => (f.date === "2026-11-18" && f.start === "14:00") || (f.date === "2026-11-19" && f.start === "10:00")), "never on top of a block");
	});

	it("a relay from before v2.1 is not sent it", async () => {
		const { svc, store } = await withWeek();
		store.saveRuntime({ relayNudgeChars: undefined });
		assert.equal(svc.requirePhone().buildSchedule().week, undefined);
	});

	it("\"Remove\" then \"Undo\" on the phone leaves the block as it was; a block the laptop removed stays removed", async () => {
		const { svc, store, later } = await withWeek();
		const link = svc.requirePhone();
		link.replay([{ id: "evt-week-0001", at: later(), type: "plan_remove", payload: { blockId: "blk-a" } }]);
		assert.equal(store.blocks().find((b) => b.id === "blk-a")?.status, "removed");
		link.replay([{ id: "evt-week-0002", at: later(), type: "plan_tick", payload: { blockId: "blk-a", restore: true } }]);
		assert.equal(store.blocks().find((b) => b.id === "blk-a")?.status, "accepted");
		svc.updateBlock("blk-b", { status: "removed" });
		link.replay([{ id: "evt-week-0003", at: new Date(Date.now() - 60_000).toISOString(), type: "plan_tick", payload: { blockId: "blk-b", restore: true } }]);
		assert.equal(store.blocks().find((b) => b.id === "blk-b")?.status, "removed");
	});

	it("\"Add a block\" on the phone makes the block on the laptop, once, and only where one can go", async () => {
		const { svc, store, events, later } = await withWeek();
		const link = svc.requirePhone();
		const add = (id: string, date: string, start: string) => ({ id: `evt-add-${id}`, at: later(), type: "plan_add", payload: { blockId: id, date, start, minutes: 50 } });
		link.replay([add("phone-new00001", "2026-11-20", "15:00")]);
		link.replay([add("phone-new00001", "2026-11-20", "15:00")]);
		const made = store.blocks().filter((b) => b.id === "phone-new00001");
		assert.deepEqual(made.map((b) => [b.date, b.start, b.minutes, b.status, b.source]), [["2026-11-20", "15:00", 50, "accepted", "phone"]]);
		// On top of the block at Wed 14:00: not made, and the log says why.
		link.replay([add("phone-new00002", "2026-11-18", "14:20")]);
		assert.equal(store.blocks().some((b) => b.id === "phone-new00002"), false);
		assert.ok(events().includes("relay_error"));
		// An id or a time that isn't one.
		link.replay([add("x y", "2026-11-21", "09:00"), add("phone-new00003", "soon", "09:00")]);
		assert.equal(store.blocks().length, 3);
	});

	it("nudges per day set on the phone is the student's setting on the laptop too", async () => {
		const { svc, store, later } = await withWeek();
		const link = svc.requirePhone();
		link.replay([{ id: "evt-prefs-001", at: later(), type: "prefs", payload: { nudgesPerDay: 0 } }]);
		assert.equal(store.profile()?.prefs.nudgesPerDay, 0);
		assert.equal(link.buildSchedule().week?.nudgesPerDay, 0);
		link.replay([{ id: "evt-prefs-002", at: later(), type: "prefs", payload: { nudgesPerDay: 9 } }]);
		assert.equal(store.profile()?.prefs.nudgesPerDay, 0, "only 0, 1 or 2");
	});
});

describe("the relay is down", () => {
	it("the laptop keeps working and logs it", async () => {
		const { svc, events } = await setup({ relayDown: true });
		await assert.rejects(svc.requirePhone().pair());
		await svc.tick(0);
		assert.ok(svc.today().onboarded);
		assert.equal(svc.today().phonePaired, false);
		void events;
	});
});

describe("Send a test question to my phone (v1.0.4)", () => {
	async function paired() {
		const s = await setup({ packs: true });
		s.addUnit("gt-nash", "GT", "Nash equilibrium");
		const { pairId, token } = fromLink((await s.svc.requirePhone().pair()).url);
		const read = async () => (await s.phone("GET", `/v1/pairs/${pairId}/schedule`, token)) as { nudges: { id: string; kind: string; title: string; body: string; fireAt: string; opens: string; more?: number; lectureId?: string; question?: { id: string; stem: string; options: string[] } }[] };
		const send = async (type: string, nudgeId: string, payload: Record<string, unknown>) => s.phone("POST", `/v1/pairs/${pairId}/events`, token, [{ id: crypto.randomUUID(), at: new Date().toISOString(), type, nudgeId, payload }]);
		return { ...s, read, send };
	}

	it("puts one real question from the student's own pack on the phone, now", async () => {
		const { svc, read, events } = await paired();
		const before = Date.now();
		const r = await svc.requirePhone().sendTest();
		assert.deepEqual([r.title, r.body, r.arrivesWithinSeconds], [PHONE_TEST_COPY.title, "Nash equilibrium: question 1?", 60]);
		const n = (await read()).nudges.find((x) => x.id === r.nudgeId)!;
		assert.ok(n, "on the relay");
		assert.match(n.id, /^test:/);
		assert.ok(Math.abs(Date.parse(n.fireAt) - before) < 5_000, "fires at real time");
		// "2 more on your laptop": the unit's pack has three questions, and the count is what is really there (v2.1).
		assert.deepEqual([n.opens, n.lectureId, n.question?.id, n.more], ["question", "gt-nash", "gt-nash-q1", 2]);
		assert.equal(events().filter((e) => e === "phone_test_sent").length, 1);
	});

	it("each test is a different question while the pack has more", async () => {
		const { svc } = await paired();
		const stems = [(await svc.requirePhone().sendTest()).body, (await svc.requirePhone().sendTest()).body];
		assert.notEqual(stems[0], stems[1]);
	});

	it("a test doesn't use up the day's notification, and answering it hands off like any question", async () => {
		const { svc, store, send, read, events } = await paired();
		const r = await svc.requirePhone().sendTest();
		const q = (await read()).nudges.find((x) => x.id === r.nudgeId)!.question!;
		await send("opened", r.nudgeId, { kind: "N-1" });
		await send("answered", r.nudgeId, { questionId: q.id, lectureId: "gt-nash", choice: 0, correct: true });
		await send("handover", r.nudgeId, { questionId: q.id, lectureId: "gt-nash", choice: 0, correct: true });
		await svc.requirePhone().sync({ force: true });
		assert.equal(store.nudges().filter((n) => n.key.startsWith("test:")).length, 0, "no nudge is recorded as fired for a test");
		const handoff = store.sessions().find((x) => x.spec.lectureId === "gt-nash");
		assert.equal(handoff?.spec.seedAnswer?.questionId, q.id, "the laptop continues from the phone's answer");
		assert.ok(events().includes("handover"));
	});

	it("with no study pack yet, says what is missing instead of sending nothing", async () => {
		const s = await setup({ packs: true });
		await s.svc.requirePhone().pair();
		await assert.rejects(s.svc.requirePhone().sendTest(), (e: unknown) => e instanceof Error && e.message === PHONE_TEST_COPY.nothing);
		const unpaired = await setup({ packs: true });
		await assert.rejects(unpaired.svc.requirePhone().sendTest(), /Pair a phone first/);
	});
});

describe("the round on the phone (v2.1 part A; V-46)", () => {
	type Q = { id: string; lectureId: string; stem: string; unit?: string; module?: string; slides: number[] };
	type N = { id: string; kind: string; title: string; body: string; why?: string; more?: number; unit?: string; module?: string; question?: Q; round?: Q[] };
	async function paired(gt = 6) {
		const s = await setup({ packs: true });
		s.addUnit("gt-nash", "GT", "Nash equilibrium", gt);
		const { pairId, token } = fromLink((await s.svc.requirePhone().pair()).url);
		const read = async () => (await s.phone("GET", `/v1/pairs/${pairId}/schedule`, token)) as { nudges: N[] };
		let e = 0;
		const send = async (type: string, nudgeId: string, payload: Record<string, unknown>) => s.phone("POST", `/v1/pairs/${pairId}/events`, token, [{ id: `evt-round-${String(++e).padStart(4, "0")}`, at: new Date(2026, 10, 17, 13, 6, e).toISOString(), type, nudgeId, payload }]);
		const test = async () => {
			const r = await s.svc.requirePhone().sendTest();
			return (await read()).nudges.find((x) => x.id === r.nudgeId)!;
		};
		const ref = (id: string) => ({ lectureId: "gt-nash", questionId: id });
		return { ...s, read, send, test, ref };
	}

	it("a question arrives with the rest of its round, and says which unit each one is from", async () => {
		const { test } = await paired();
		const n = await test();
		assert.equal(n.question?.id, "gt-nash-q1");
		assert.deepEqual(n.round?.map((q) => q.id), ["gt-nash-q2", "gt-nash-q3", "gt-nash-q4", "gt-nash-q5"]);
		assert.equal(n.more, 4);
		assert.deepEqual([n.question?.unit, n.question?.module], ["Nash equilibrium", "GT"]);
		assert.ok(n.round!.every((q) => q.unit === "Nash equilibrium" && q.module === "GT"));
	});

	it("a short bank gives a short round, and \"more on your laptop\" counts what is really there", async () => {
		const { test } = await paired(3);
		const n = await test();
		assert.deepEqual(n.round?.map((q) => q.id), ["gt-nash-q2", "gt-nash-q3"]);
		assert.equal(n.more, 2);
	});

	it("\"Done for now\" saves the rest; they come straight after the next notification's own question", async () => {
		const { svc, store, test, send, ref, events } = await paired();
		const first = await test();
		await send("answered", first.id, { questionId: "gt-nash-q1", lectureId: "gt-nash", choice: 0, correct: true });
		await send("done_for_now", first.id, { saved: ["gt-nash-q2", "gt-nash-q3", "gt-nash-q4", "gt-nash-q5"].map(ref) });
		await svc.requirePhone().sync({ force: true });
		assert.deepEqual(store.runtime().phoneSaved?.map((r) => r.questionId), ["gt-nash-q2", "gt-nash-q3", "gt-nash-q4", "gt-nash-q5"]);
		// The next question is q2 itself (the first not sent yet): the saved ones follow it, then a new one fills the round.
		const next = await test();
		assert.equal(next.question?.id, "gt-nash-q2");
		assert.deepEqual(next.round?.map((q) => q.id), ["gt-nash-q3", "gt-nash-q4", "gt-nash-q5", "gt-nash-q1"]);
		assert.ok(events().includes("done_for_now"));
	});

	it("only the next notification leads with what was saved; an answer on the phone takes a question off the list", async () => {
		const { svc, store, test, send, ref } = await paired();
		const first = await test();
		await send("done_for_now", first.id, { saved: [ref("gt-nash-q5"), ref("gt-nash-q4")] });
		await svc.requirePhone().sync({ force: true });
		await send("answered", first.id, { questionId: "gt-nash-q5", lectureId: "gt-nash", choice: 1, correct: false });
		await svc.requirePhone().sync({ force: true });
		assert.deepEqual(store.runtime().phoneSaved?.map((r) => r.questionId), ["gt-nash-q4"]);
		assert.equal(store.misses().some((m) => m.questionId === "gt-nash-q5"), true, "a wrong answer on the phone is still a gap");
		// Rubbish in the saved list is ignored, not stored.
		await send("done_for_now", first.id, { saved: [{ lectureId: 3 }, "x", ref("gt-nash-q4")] });
		await svc.requirePhone().sync({ force: true });
		assert.deepEqual(store.runtime().phoneSaved?.map((r) => r.questionId), ["gt-nash-q4"]);
	});

	it("after three answers on the phone, the laptop opens the same round at question 4", async () => {
		const { svc, store, test, send, ref } = await paired();
		const n = await test();
		const round = [n.question!, ...n.round!].map((q) => ref(q.id));
		const answers = [{ questionId: "gt-nash-q1", lectureId: "gt-nash", choice: 0, correct: true }, { questionId: "gt-nash-q2", lectureId: "gt-nash", choice: 2, correct: false }, { questionId: "gt-nash-q3", lectureId: "gt-nash", choice: 0, correct: true }];
		for (const a of answers) await send("answered", n.id, a);
		await send("done_for_now", n.id, { saved: [ref("gt-nash-q4"), ref("gt-nash-q5")] });
		await send("handover", n.id, { lectureId: "gt-nash", round, answers });
		await svc.requirePhone().sync({ force: true });
		const toast = store.nudges().find((x) => x.key.startsWith("handoff:"))!;
		assert.equal(toast.text, "3 questions answered on your phone. 2 more ready.");
		const session = store.session(toast.sessionId!)!;
		assert.equal(session.spec.study, "practise");
		assert.deepEqual(session.spec.practise?.picks.map((p) => p.questionId), round.map((r) => r.questionId));
		assert.equal(session.spec.seedAnswers?.length, 3);
		await svc.whenReady(session.id);
		const v = await svc.view(session.id);
		assert.equal(v.answered, 3);
		assert.equal(v.budget, 5);
		assert.equal(v.question?.id, "gt-nash-q4");
		assert.deepEqual(store.runtime().phoneSaved ?? [], [], "what the laptop took over is no longer saved on the phone");
	});

	it("one answer still reads \"Question 1 answered on your phone\"", async () => {
		const { svc, store, test, send, ref } = await paired();
		const n = await test();
		const round = [n.question!, ...n.round!].map((q) => ref(q.id));
		await send("handover", n.id, { lectureId: "gt-nash", round, answers: [{ questionId: "gt-nash-q1", lectureId: "gt-nash", choice: 0, correct: true }] });
		await svc.requirePhone().sync({ force: true });
		assert.equal(store.nudges().find((x) => x.key.startsWith("handoff:"))?.text, "Question 1 answered on your phone ✓ 4 more ready.");
	});

	it("a relay from before v2.1 gets notifications it can accept; a newer one says its limit and gets the whole round", async () => {
		const { svc, store, test } = await paired();
		await test();
		assert.equal(store.runtime().relayNudgeChars, 12_000, "the relay's own limit is remembered from its answer");
		const plain = svc.requirePhone().buildSchedule();
		assert.ok(plain.nudges.every((n) => JSON.stringify(n).length <= 12_000));
		store.saveRuntime({ relayNudgeChars: 700 });
		const cut = svc.requirePhone().buildSchedule().nudges.find((n) => n.question)!;
		assert.ok(JSON.stringify(cut).length <= 700 || (cut.round as unknown[]).length === 0);
		assert.ok(((cut.round as unknown[]) ?? []).length < 4);
	});
});

describe("the facilitator's \"send a question to the phone now\" (T4 in a lab)", () => {
	it("puts the next lecture question on the relay at real time, and it survives the next upload", async () => {
		const { svc, phone, events } = await setup();
		await assert.rejects(svc.requirePhone().sendNow(), /Pair a phone first/);
		const { pairId, token } = fromLink((await svc.requirePhone().pair()).url);
		const before = Date.now();
		const r = await svc.requirePhone().sendNow();
		assert.match(r.nudgeId, /^N-1:.+:now-\d+$/);
		const read = async () => (await phone("GET", `/v1/pairs/${pairId}/schedule`, token)) as { nudges: { id: string; fireAt: string; more?: number }[] };
		const now = (await read()).nudges.find((n) => n.id === r.nudgeId);
		assert.ok(now, "on the relay");
		assert.ok(Math.abs(Date.parse(now!.fireAt) - before) < 5_000, "fires at real time, not the demo clock");
		assert.equal(now!.more, 4);
		await svc.requirePhone().sync({ force: true });
		assert.ok((await read()).nudges.some((n) => n.id === r.nudgeId), "a later upload keeps it until it expires");
		assert.ok(events().includes("phone_send_now"));
	});
});

describe("the facilitator's phone (a lab without a phone)", () => {
	it("plays an answer and a hand-off on the laptop", async () => {
		const { svc, store } = await setup();
		const r = svc.demoPhone({ action: "handover", correct: false });
		assert.equal(r.replayed, 2);
		assert.ok(store.nudges().some((n) => n.key.startsWith("handoff:")));
	});
});

describe("sync rules (pure)", () => {
	it("versions only go up, even if the clock goes back", () => {
		assert.equal(nextVersion(5, 1000), 1000);
		assert.equal(nextVersion(2000, 1000), 2001);
	});
	it("events replay once each, in the phone's order", () => {
		const ev = (id: string, at: string) => ({ id, at, type: "opened", payload: {} });
		const r = eventsToReplay([ev("b", "2026-11-17T13:02:00Z"), ev("a", "2026-11-17T13:01:00Z"), ev("b", "2026-11-17T13:02:00Z"), ev("c", "2026-11-17T13:03:00Z")], new Set(["c"]));
		assert.deepEqual(r.map((e) => e.id), ["a", "b"]);
	});
	it("plan edits: last write wins per block", () => {
		const block = (id: string): StudyBlock => ({ id, date: "2026-11-18", start: "14:00", minutes: 50, status: "proposed", source: "planner" });
		const r = applyPlanEdits([block("x"), block("y")], [
			{ blockId: "x", at: "2026-11-17T10:00:00Z", change: { status: "accepted" } },
			{ blockId: "y", at: "2026-11-17T09:00:00Z", change: { start: "16:00" } },
		], (id) => (id === "y" ? "2026-11-17T09:30:00Z" : undefined));
		assert.equal(r.blocks[0]!.status, "accepted");
		assert.equal(r.blocks[1]!.start, "14:00", "the laptop changed y later");
		assert.deepEqual(r.ignored.map((i) => i.blockId), ["y"]);
	});
	it("the fingerprint ignores key order and changes with content", () => {
		const a = scheduleFingerprint({ timeZone: "Europe/London", nudges: [], blocks: [] });
		assert.equal(a, scheduleFingerprint({ blocks: [], nudges: [], timeZone: "Europe/London" } as never));
		assert.notEqual(a, scheduleFingerprint({ timeZone: "Europe/Paris", nudges: [], blocks: [] }));
	});
});
