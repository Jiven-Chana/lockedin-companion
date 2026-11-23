/**
 * The start layer end to end through CompanionService (plan §2.1 journeys
 * J1–J6), on the scripted engine with a manual clock and a temp store.
 * The same flows run on LearnHarness at the checkpoint and in T23 dry runs.
 *
 * 17 Nov 2026 is a Tuesday. The sample timetable: HCI Tue 11–13, GT Wed
 * 10–12, HCI lab Thu 14–16, GT problem class Fri 10–11.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { ManualClock } from "../src/server/companion/clock.ts";
import { CompanionContent } from "../src/server/companion/content.ts";
import { ScriptedEngine } from "../src/server/companion/engines/scripted.ts";
import type { SessionEngine } from "../src/server/companion/engines/types.ts";
import { EngineError } from "../src/server/companion/errors.ts";
import { CompanionService } from "../src/server/companion/service.ts";
import { CompanionStore } from "../src/server/companion/store.ts";

const CONTENT = path.join(import.meta.dirname, "..", "companion", "content");
const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m);

function setup(opts: { engines?: Partial<Record<"learnharness" | "scripted", SessionEngine>>; defaultEngine?: "learnharness" | "scripted"; autoFallback?: boolean; start?: Date } = {}) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "companion-svc-"));
	const store = new CompanionStore(dir);
	const content = new CompanionContent(store, CONTENT);
	const clock = new ManualClock(opts.start ?? at(17, 12, 58));
	const scripted = new ScriptedEngine((id) => content.scriptedSet(id));
	let n = 0;
	const svc = new CompanionService({
		store, content, clock,
		clockControl: { set: (t) => clock.set(t), reset: () => clock.set(at(17, 12, 58)) },
		engines: { scripted, learnharness: scripted, ...opts.engines },
		defaultEngine: opts.defaultEngine ?? "scripted",
		autoFallback: opts.autoFallback,
		newId: (p) => `${p}${++n}`,
	});
	const events = () => store.events().map((e) => e.type);
	return { svc, store, clock, dir, events };
}

async function answerAll(svc: CompanionService, sessionId: string, pick: (labels: string[]) => number, confidence = 70) {
	for (;;) {
		const v = await svc.view(sessionId);
		if (v.status !== "question" || !v.question) return v;
		await svc.answer(sessionId, { questionId: v.question.id, indices: [pick(v.question.options.map((o) => o.label))], confidence });
	}
}

describe("J1: first run, taste before setup", () => {
	it("onboarding → try-now → question 1, with no key, model or upload", async () => {
		const { svc, events } = setup();
		const { profile, reads, tryNow } = svc.onboard({ modules: ["HCI", "GT"], timetableSource: "sample", nudgesPerDay: 1 });
		assert.equal(profile.prefs.lock, "off", "the lock is off by default");
		assert.equal(reads.location, "never read");
		assert.equal(reads.label, "Sample timetable");
		assert.ok(tryNow, "Today offers a try-now card");
		const { sessionId } = svc.createSession(tryNow.spec);
		await svc.whenReady(sessionId);
		const v = await svc.view(sessionId);
		assert.equal(v.status, "question");
		assert.equal(v.budget, 3);
		assert.deepEqual(events(), ["onboarding_done", "session_prepare_started", "session_prepared", "session_opened", "question_shown"]);
	});
});

describe("J2: Tayo's post-lecture nudge", () => {
	it("pre-warms at the lecture end, fires at +5, opens on question 1, and respects the cap", async () => {
		const { svc, clock, store, events } = setup();
		svc.demoScenario({ name: "tayo" });
		assert.equal(svc.now().toISOString(), at(17, 12, 58).toISOString());
		assert.deepEqual(await svc.tick(), { nudge: null, prepared: [] });

		clock.set(at(17, 13, 0));
		const { prepared } = await svc.tick();
		assert.equal(prepared.length, 1, "preparation starts when the lecture ends");
		assert.equal((await svc.tick()).nudge, null, "not before end + 5");

		clock.set(at(17, 13, 5));
		const { nudge } = await svc.tick();
		assert.equal(nudge?.type, "N-1");
		assert.equal(nudge?.text, "HCI just finished. 5 questions on it, about 10 minutes?");
		assert.equal(nudge?.ready, true);
		assert.equal(nudge?.sessionId, prepared[0]);

		const opened = svc.nudgeAction(nudge!.id, "open");
		assert.equal(opened.sessionId, prepared[0], "tapping opens the pre-warmed session");
		const v = await svc.view(opened.sessionId!);
		assert.equal(v.status, "question");
		assert.equal(v.goal, "5 questions on personas and scenarios, about 10 minutes");

		// Get question 1 wrong (the authored answer is known), then answer the rest.
		const q1Correct = "To focus design decisions on specific users' goals";
		let first = true;
		const done = await answerAll(svc, opened.sessionId!, (labels) => {
			const pick = first ? labels.findIndex((l) => l !== q1Correct) : 0;
			first = false;
			return pick + 1;
		});
		assert.equal(done.status, "done");
		assert.equal(store.misses().length >= 1, true, "a miss was logged");

		// No more nudges today, even with a missed lecture eligible in the evening.
		store.updateLecture("gt-w2-nash", (l) => ({ ...l, attended: false }));
		clock.set(at(17, 19, 5));
		assert.equal((await svc.tick()).nudge, null);
		assert.equal(store.nudges().length, 1);
		for (const t of ["nudge_fired", "nudge_opened", "session_opened", "question_shown", "answer", "session_done"]) assert.ok(events().includes(t as never), t);
	});

	it("\"I wasn't there\" marks the lecture missed and stops the prepared session", async () => {
		const { svc, clock, store } = setup();
		svc.demoScenario({ name: "tayo" });
		clock.set(at(17, 13, 5));
		const { nudge } = await svc.tick();
		svc.nudgeAction(nudge!.id, "wasnt-there");
		assert.equal(store.lectures().find((l) => l.id === "hci-w3-personas")?.attended, false);
		assert.equal(store.session(nudge!.sessionId!)?.state, "stopped");
	});
});

describe("J3: Maya's missed lecture, and resume", () => {
	it("N-3 in the evening in show-me-first mode; leaving mid-question resumes on the same question", async () => {
		const { svc, clock } = setup();
		svc.demoScenario({ name: "maya" });
		clock.set(at(17, 18, 50));
		const { prepared } = await svc.tick();
		assert.equal(prepared.length, 1);
		clock.set(at(17, 19, 0));
		const { nudge } = await svc.tick();
		assert.equal(nudge?.type, "N-3");
		assert.equal(nudge?.text, "Missed Tuesday's lecture? Here it is in three 5-minute pieces.");
		const { sessionId } = svc.nudgeAction(nudge!.id, "open");
		const v = await svc.view(sessionId!);
		assert.equal(v.mode, "show-first");
		assert.match(v.prose ?? "", /Worked example/);
		svc.stop(sessionId!);
		clock.set(at(17, 20, 0));
		const again = await svc.view(sessionId!);
		assert.equal(again.question?.id, v.question?.id, "resumes on the exact pending question");
	});
});

describe("J4: the resurfaced miss", () => {
	it("a miss comes back in a later retest with fresh wording and becomes solid", async () => {
		const { svc, clock, store } = setup();
		svc.demoScenario({ name: "tayo" });
		clock.set(at(17, 13, 5));
		const { nudge } = await svc.tick();
		const { sessionId } = svc.nudgeAction(nudge!.id, "open");
		const v = await svc.view(sessionId!);
		const correctLabel = "To focus design decisions on specific users' goals";
		const wrong = v.question!.options.find((o) => o.label !== correctLabel)!.index;
		await svc.answer(sessionId!, { questionId: v.question!.id, indices: [wrong], confidence: 70 });
		const [m] = store.misses();
		assert.equal(m?.reason, "wrong");
		assert.equal(m?.nextDue, at(18, 13, 5).toISOString());

		// Thursday: no lecture with slides today, so N-2 may use the day's budget.
		clock.set(at(19, 9, 0));
		const tick = await svc.tick();
		assert.equal(tick.nudge?.type, "N-2");
		assert.equal(tick.nudge?.text, "The one you missed on Tuesday. 3 questions, about 4 minutes.");
		const { sessionId: retest } = svc.nudgeAction(tick.nudge!.id, "open");
		await svc.whenReady(retest!);
		const rv = await svc.view(retest!);
		assert.notEqual(rv.question?.id, "q1", "never the same wording: a sibling question");
		const right = rv.question!.options.findIndex((o) => /specific person|focus/i.test(o.label)) + 1;
		await svc.answer(retest!, { questionId: rv.question!.id, indices: [right], confidence: 90 });
		assert.equal(store.misses()[0]?.status, "solid");
	});
});

describe("J5: study blocks and the simulated lock", () => {
	it("off by default, gentle/firm prompt, always a way out, one-tap skip", () => {
		const { svc, clock, events } = setup();
		svc.onboard({});
		svc.saveBlocks([{ id: "b1", date: "2026-11-17", start: "15:00", minutes: 50, status: "accepted", source: "student" }]);
		assert.throws(() => svc.saveBlocks([{ id: "b2", date: "next Tuesday", start: "10:00", minutes: 25 }]), /date must be YYYY-MM-DD/);
		clock.set(at(17, 15, 10));
		assert.deepEqual(svc.appOpen({ app: "Social" }), { allowed: true, reason: "lock-off" });

		svc.updateProfile({ prefs: { lock: "gentle" } });
		const gentle = svc.appOpen({ app: "Social" });
		assert.equal(gentle.allowed, false);
		assert.match((gentle as { message: string }).message, /Study block: 40 minutes left\. Open anyway\?/);
		assert.equal(svc.appOpen({ app: "Social", confirmed: true }).allowed, true);

		svc.updateProfile({ prefs: { lock: "firm" } });
		clock.set(at(17, 15, 13));
		assert.equal((svc.appOpen({ app: "Videos" }) as { prompt?: string }).prompt, "why");
		assert.equal(svc.appOpen({ app: "Videos", reason: "lecture recording" }).allowed, true);
		assert.equal(svc.appOpen({ app: "Videos" }).allowed, true, "the override lasts 2 minutes");
		clock.set(at(17, 15, 27));
		assert.equal(svc.activeBlock().active?.onBreak, true, "Pomodoro break after 25 minutes");
		assert.ok(events().includes("lock_override") && events().includes("app_open_blocked"));

		const skipped = svc.skipBlock("b1");
		assert.equal(skipped.status, "removed", "skipping a dated block removes it (one tap, X-7)");
	});
});

describe("J6: coming back after a break", () => {
	it("welcome back, nothing overdue, no streak", () => {
		const { svc } = setup();
		svc.demoScenario({ name: "returning" });
		const today = svc.today();
		assert.equal(today.welcomeBack?.text, "Welcome back. 3 questions on last week?");
		const json = JSON.stringify(svc.progress());
		assert.doesNotMatch(json, /overdue|streak/i);
	});
});

describe("snooze → N-4", () => {
	it("a snoozed nudge comes back later and resumes the same session; it does not count toward the cap", async () => {
		const { svc, clock } = setup();
		svc.demoScenario({ name: "tayo" });
		clock.set(at(17, 13, 5));
		const { nudge } = await svc.tick();
		const { returnAt } = svc.nudgeAction(nudge!.id, "snooze");
		assert.equal(returnAt, at(17, 14, 5).toISOString());
		clock.set(at(17, 14, 6));
		const back = (await svc.tick()).nudge;
		assert.equal(back?.type, "N-4");
		assert.equal(back?.sessionId, nudge!.sessionId);
		assert.equal(back?.text, "Picking up where you left off. 5 questions left, about 10 minutes.");
	});
});

describe("engines, fallback and errors", () => {
	const broken: SessionEngine = {
		name: "learnharness",
		start: async () => {
			throw new EngineError("models_not_configured", "No model configured", 503);
		},
		waitUntilReady: async () => {},
		view: async () => {
			throw new Error("unreachable");
		},
		answer: async () => {
			throw new Error("unreachable");
		},
		showMe: async () => ({}),
		hint: async () => ({ text: "" }),
		more: async () => ({}),
		retry: async () => {},
		cost: () => null,
		remove: () => {},
	};

	it("without fallback a failed prepare is an honest error state", async () => {
		const { svc, events } = setup({ engines: { learnharness: broken }, defaultEngine: "learnharness" });
		svc.onboard({});
		const { sessionId } = svc.createSession(svc.parseSpec({ kind: "try-now", lectureId: "hci-w3-personas" }));
		await svc.whenReady(sessionId);
		const v = await svc.view(sessionId);
		assert.equal(v.status, "error");
		assert.equal(v.error, "models_not_configured");
		assert.ok(events().includes("error"));
	});

	it("with COMPANION_AUTO_FALLBACK the session continues on the scripted engine, and says so", async () => {
		const { svc, store, events } = setup({ engines: { learnharness: broken }, defaultEngine: "learnharness", autoFallback: true });
		svc.onboard({});
		const { sessionId } = svc.createSession(svc.parseSpec({ kind: "try-now", lectureId: "hci-w3-personas" }));
		await svc.whenReady(sessionId);
		const v = await svc.view(sessionId);
		assert.equal(v.engine, "scripted");
		assert.equal(v.status, "question");
		assert.equal(store.session(sessionId)?.fellBackFrom, "learnharness");
		assert.ok(events().includes("engine_fallback"));
	});

	it("the facilitator can switch the engine for the next sessions", () => {
		const { svc, store } = setup();
		svc.onboard({});
		svc.demoEngine({ engine: "learnharness" });
		const { sessionId } = svc.createSession(svc.parseSpec({ kind: "try-now", lectureId: "hci-w3-personas" }));
		assert.equal(store.session(sessionId)?.engine, "learnharness");
	});
});

describe("tick robustness", () => {
	it("a candidate that cannot be prepared or fired is logged, and the tick still answers", async () => {
		const { svc, clock, store } = setup();
		svc.demoScenario({ name: "tayo" });
		svc.createSession = () => {
			throw new Error("boom");
		};
		clock.set(at(17, 13, 0));
		assert.deepEqual(await svc.tick(), { nudge: null, prepared: [] });
		clock.set(at(17, 13, 15));
		assert.deepEqual(await svc.tick(), { nudge: null, prepared: [] });
		const errors = store.events().filter((e) => e.type === "error").map((e) => e.data.where);
		assert.deepEqual([...new Set(errors)].sort(), ["fire", "prewarm"]);
	});
});

describe("data and the event log", () => {
	it("participant ids stamp events; CSV export; delete-all keeps lecture materials", async () => {
		const { svc, store, dir } = setup();
		svc.demoParticipant({ participant: "P03" });
		svc.onboard({});
		svc.logClientEvents([{ type: "onboarding_step", data: { step: 1 } }]);
		assert.throws(() => svc.logClientEvents({ type: "answer" }), /event type must be one of/);
		const csv = svc.eventsCsv();
		assert.match(csv.split("\n")[0]!, /^t,wall,participant,type,data$/);
		assert.match(csv, /P03,onboarding_step/);
		fs.mkdirSync(path.join(dir, "materials", "x"), { recursive: true });
		await svc.deleteAll();
		assert.equal(store.profile(), null);
		assert.deepEqual(store.events(), []);
		assert.ok(fs.existsSync(path.join(dir, "materials", "x")));
		assert.equal(store.demo().participant, "P03", "facilitator state survives a student's delete");
	});

	it("validates inputs at the boundary", () => {
		const { svc } = setup();
		svc.onboard({});
		assert.throws(() => svc.parseSpec({ kind: "nope", lectureId: "x" }), /kind must be/);
		assert.throws(() => svc.parseSpec({ kind: "try-now", lectureId: "../etc" }), /invalid lecture id/);
		assert.throws(() => svc.parseAnswer({ questionId: "q1" }), /choose an option/);
		assert.throws(() => svc.parseAnswer({ questionId: "q1", indices: [1], confidence: 42 }), /confidence must be one of/);
		assert.throws(() => svc.updateProfile({ prefs: { nudgesPerDay: 3 } }), /1 or 2/);
		assert.throws(() => svc.demoClock({}), /use \{set/);
	});
});
