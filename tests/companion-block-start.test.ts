/**
 * v1.1.1: the four defects found in v1.1.
 *  - A study block can be started (V-44): on its own day, from the Start
 *    button or by opening its notification. Starting it is what earns the
 *    block's points and milestones.
 *  - A block's first step is named, and its session opens on it.
 *  - A session that was stopped is offered again on Today (R-5).
 *  - How sure you are is four taps, none preselected.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
	canStartBlock, CONFIDENCE_TAPS, NUDGE_TEXT, PLAN_COPY, resumableSession, RESUME_RULES, SCORE_RULES, SESSION_COPY, SOLID_CONFIDENCE,
	type CompanionSession, type StudyBlock,
} from "../src/core/companion/index.ts";
import { CONFIDENCE_STOPS } from "../src/core/question-core.ts";
import { ManualClock } from "../src/server/companion/clock.ts";
import { CompanionContent } from "../src/server/companion/content.ts";
import { ScriptedEngine } from "../src/server/companion/engines/scripted.ts";
import { CompanionError } from "../src/server/companion/errors.ts";
import { CompanionService } from "../src/server/companion/service.ts";
import { CompanionStore } from "../src/server/companion/store.ts";

const CONTENT = path.join(import.meta.dirname, "..", "companion", "content");
const day = (d: number, h = 12, m = 0) => new Date(2026, 10, d, h, m); // November 2026; the 23rd is a Monday

async function setup(now = day(26, 9)) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "companion-block-start-"));
	const store = new CompanionStore(dir);
	const content = new CompanionContent(store, CONTENT);
	const clock = new ManualClock(now);
	let n = 0;
	const svc = new CompanionService({
		store, content, clock,
		clockControl: { set: (t) => clock.set(t), reset: () => clock.set(now) },
		engines: { scripted: new ScriptedEngine((id) => content.scriptedSet(id)), learnharness: new ScriptedEngine((id) => content.scriptedSet(id)) },
		defaultEngine: "scripted",
		generate: (async () => { throw new Error("not called"); }) as never,
		newId: (p) => `${p}${++n}`,
	});
	await svc.onboardFlow({ calendar: { kind: "none" }, modules: [{ code: "NC", name: "Neural Computation" }] });
	// A unit with a study pack. Its bank has an easy question first and the block's first step second, on slide 12.
	const id = "nc-gans";
	store.saveLectures([...store.allLectures(), { id, module: "NC", title: "GANs", week: 0, order: 99, kind: "lecture", hasMaterials: true, source: { file: "notes.pdf", pages: [1, 4] } }]);
	fs.mkdirSync(store.materialsDir(id), { recursive: true });
	fs.writeFileSync(path.join(store.materialsDir(id), "slides.md"), "# GANs\n\n## Slide 1 — GANs\n\nText.\n");
	fs.writeFileSync(path.join(store.materialsDir(id), "map.mmd"), 'graph TD\n  generator["generator · S1"]\n  discriminator["discriminator · S12"]\n');
	fs.writeFileSync(path.join(store.materialsDir(id), "bank.json"), JSON.stringify([
		{ id: `${id}-q1`, stem: "What does the generator do?", options: ["Right", "Wrong A", "Wrong B"], correct: 0, explanation: "Because (Slide 1).", slides: [1], node: "generator", difficulty: 1 },
		{ id: `${id}-q2`, stem: "What does the discriminator do?", options: ["Right", "Wrong A", "Wrong B"], correct: 0, explanation: "Because (Slide 12).", slides: [12], node: "discriminator", difficulty: 2 },
		{ id: `${id}-q3`, stem: "Why do they compete?", options: ["Right", "Wrong A", "Wrong B"], correct: 0, explanation: "Because (Slide 12).", slides: [12], node: "discriminator", difficulty: 3 },
	]));
	const block = (over: Partial<StudyBlock> = {}): StudyBlock => ({ id: "blk1", date: "2026-11-26", start: "14:00", minutes: 50, status: "accepted", source: "planner", lectureId: id, module: "NC", firstTaskQuestionId: `${id}-q2`, ...over });
	const types = () => store.events().map((e) => e.type);
	return { svc, store, clock, block, types };
}

describe("a study block can be started (V-44)", () => {
	const table: [string, Partial<StudyBlock>, Date, boolean][] = [
		["an accepted block, on its day", {}, day(26, 9), true],
		["a proposal, on its day: starting it is choosing it", { status: "proposed" }, day(26, 9), true],
		["late the same evening", {}, day(26, 23, 30), true],
		["the day before", {}, day(25, 9), false],
		["the day after", {}, day(27, 9), false],
		["already started", { status: "started" }, day(26, 9), false],
		["removed", { status: "removed" }, day(26, 9), false],
	];
	for (const [name, over, now, expected] of table) {
		it(`canStartBlock: ${name} → ${expected}`, () => {
			assert.equal(canStartBlock({ date: "2026-11-26", status: "accepted", ...over }, now), expected);
		});
	}

	it("Start marks the block started, logs it, and opens its session on the block's first step", async () => {
		const { svc, store, block, types } = await setup(day(26, 14));
		store.saveBlocks([block()]);
		const r = svc.startBlock("blk1");
		assert.deepEqual([r.block.status, r.block.startedAt], ["started", day(26, 14).toISOString()]);
		const started = store.events().filter((e) => e.type === "block_started");
		assert.deepEqual(started.map((e) => e.data.via), ["start"]);
		assert.ok(r.sessionId);
		const session = store.session(r.sessionId!)!;
		assert.deepEqual([session.spec.kind, session.spec.lectureId, session.spec.firstQuestionId], ["block", "nc-gans", "nc-gans-q2"]);
		// The scripted session asks the first step first, not the easiest question.
		await svc.whenReady(r.sessionId!);
		const v = await svc.view(r.sessionId!);
		assert.deepEqual([v.status, v.question?.id, v.question?.stem], ["question", "nc-gans-q2", "What does the discriminator do?"]);
		assert.ok(types().includes("block_started"));
	});

	it("starting a block is what earns its points and the first-block milestone", async () => {
		const { svc, store, block } = await setup(day(26, 14));
		store.saveBlocks([block()]);
		assert.equal(svc.progress().score.now, 0);
		svc.startBlock("blk1");
		const p = svc.progress();
		assert.equal(p.score.now, SCORE_RULES.blockStarted);
		assert.ok(p.milestones.find((m) => m.id === "first-block")!.earnedAt, "the first study block kept");
	});

	it("a block on another day can't be started, by Start or by the API, and stays as it was", async () => {
		const { svc, store, block } = await setup(day(25, 14));
		store.saveBlocks([block()]);
		const refused = (e: CompanionError) => e.status === 409 && e.code === "block_not_today" && e.message === PLAN_COPY.notToday;
		assert.throws(() => svc.startBlock("blk1"), refused);
		assert.throws(() => svc.updateBlock("blk1", { status: "started" }), refused);
		assert.equal(store.blocks()[0]!.status, "accepted");
		assert.equal(store.events().filter((e) => e.type === "block_started").length, 0);
		assert.throws(() => svc.startBlock("nope"), (e: CompanionError) => e.status === 404);
	});

	it("starting twice opens a session again and counts once", async () => {
		const { svc, store, block } = await setup(day(26, 14));
		store.saveBlocks([block()]);
		const a = svc.startBlock("blk1");
		const b = svc.startBlock("blk1");
		assert.equal(b.block.startedAt, a.block.startedAt);
		assert.ok(b.sessionId && b.sessionId !== a.sessionId);
		assert.equal(store.events().filter((e) => e.type === "block_started").length, 1);
		assert.equal(svc.progress().score.now, SCORE_RULES.blockStarted);
	});

	it("a free-study block with nothing to open is still started", async () => {
		const { svc, store, block } = await setup(day(26, 14));
		store.saveLectures([]);
		store.saveBlocks([block({ lectureId: undefined, module: undefined, firstTaskQuestionId: undefined })]);
		const r = svc.startBlock("blk1");
		assert.deepEqual([r.block.status, r.sessionId], ["started", null]);
	});

	it("the block's notification names its first step, and opening it starts the block", async () => {
		const { svc, store, clock, block } = await setup(day(26, 13, 59));
		store.saveBlocks([block()]);
		clock.set(day(26, 14, 1));
		const { nudge } = await svc.tick();
		assert.equal(nudge?.type, "block");
		assert.equal(nudge!.text, NUDGE_TEXT.block(50, PLAN_COPY.firstStep(12)));
		assert.equal(nudge!.text, "Your study block starts now. First step: slide 12, one question.");
		assert.equal(store.blocks()[0]!.status, "accepted", "a notification arriving is not starting");
		const opened = svc.nudgeAction(nudge!.id, "open");
		assert.equal(store.blocks()[0]!.status, "started");
		assert.equal(store.session(opened.sessionId!)!.spec.firstQuestionId, "nc-gans-q2");
		assert.deepEqual(store.events().filter((e) => e.type === "block_started" && e.data.via).map((e) => e.data.via), ["nudge"]);
	});

	it("without a first step the notification keeps its old words", () => {
		assert.equal(NUDGE_TEXT.block(50), "Your study block starts now. 50 minutes, at your own pace.");
		assert.equal(PLAN_COPY.firstStep(null), "First step: one question");
	});

	it("the plan and Today say which block can be started, and its first step", async () => {
		const { svc, store, block } = await setup(day(26, 9));
		store.saveBlocks([block(), block({ id: "blk2", date: "2026-11-27", firstTaskQuestionId: undefined })]);
		const blocks = svc.plan("2026-11-23").blocks;
		assert.deepEqual(blocks.map((b) => [b.id, b.canStart, b.firstStep]), [["blk1", true, "First step: slide 12, one question"], ["blk2", false, null]]);
		const next = svc.today().nextBlock!;
		assert.deepEqual([next.blockId, next.canStart, next.firstStep, next.status], ["blk1", true, "First step: slide 12, one question", "accepted"]);
	});
});

describe("a session that was left is offered again (R-5)", () => {
	const s = (over: Partial<CompanionSession>): CompanionSession => ({
		id: "s1", engine: "scripted", spec: { kind: "post-lecture", lectureId: "L1", mode: "question-first", budget: { questions: 5, minutes: 10 } },
		budget: 5, answered: 2, createdAt: day(24, 10).toISOString(), state: "stopped", endedAt: day(24, 10, 20).toISOString(), ...over,
	});
	const table: [string, CompanionSession[], Date, string | null][] = [
		["stopped with questions left", [s({})], day(24, 12), "s1"],
		["still active (the tab was closed)", [s({ state: "active", endedAt: undefined, lastActivityAt: day(24, 10, 5).toISOString() })], day(24, 12), "s1"],
		["stopped before any answer", [s({ answered: 0 })], day(24, 12), "s1"],
		["nothing left to answer", [s({ answered: 5 })], day(24, 12), null],
		["finished", [s({ state: "done", answered: 5 })], day(24, 12), null],
		["failed", [s({ state: "error" })], day(24, 12), null],
		["prepared but never opened", [s({ state: "ready", answered: 0 })], day(24, 12), null],
		["left longer ago than a week", [s({})], day(24 + RESUME_RULES.offerDays + 1, 12), null],
		["exactly a week on", [s({})], new Date(day(24, 10, 20).getTime() + RESUME_RULES.offerDays * 86_400_000), "s1"],
		["a later session on the same lecture was finished", [s({}), s({ id: "s2", state: "done", answered: 5, createdAt: day(25, 10).toISOString() })], day(25, 12), null],
		["a later session on another lecture was finished", [s({}), s({ id: "s2", state: "done", answered: 5, createdAt: day(25, 10).toISOString(), spec: { ...s({}).spec, lectureId: "L2" } })], day(25, 12), "s1"],
		["two left: the later one", [s({}), s({ id: "s2", createdAt: day(25, 10).toISOString(), endedAt: day(25, 10, 5).toISOString() })], day(25, 12), "s2"],
	];
	for (const [name, sessions, now, expected] of table) {
		it(`${name} → ${expected ?? "nothing"}`, () => assert.equal(resumableSession(sessions, now)?.id ?? null, expected));
	}

	it("Stop keeps the session on Today, with where it was saved and how much is left", async () => {
		const { svc, store, block, clock } = await setup(day(26, 14));
		store.saveBlocks([block()]);
		const { sessionId } = svc.startBlock("blk1");
		await svc.whenReady(sessionId!);
		await svc.view(sessionId!);
		svc.stop(sessionId!);
		clock.set(day(26, 15));
		const t = svc.today();
		assert.equal(t.activeSession, sessionId);
		assert.deepEqual([t.resume?.sessionId, t.resume?.module, t.resume?.title, t.resume?.answered, t.resume?.budget], [sessionId, "NC", "GANs", 0, 5]);
		assert.equal(t.resume!.text, `${SESSION_COPY.savedAt(1)} ${SESSION_COPY.left(5, 10)}.`);
		assert.equal(t.resume!.text, "Saved at question 1. Pick up any time. Nothing is marked missed. 5 questions left, about 10 minutes.");
		assert.equal(store.session(sessionId!)!.state, "stopped", "Today describing it does not reopen it");
		// Opening it is what resumes it.
		await svc.view(sessionId!);
		assert.equal(store.session(sessionId!)!.state, "active");
	});

	it("nothing to pick up: no card", async () => {
		const { svc } = await setup();
		assert.deepEqual([svc.today().activeSession, svc.today().resume], [null, null]);
	});
});

describe("how sure you are is four taps", () => {
	it("Guess, Unsure, Fairly sure, Certain, on values the engine accepts", () => {
		assert.deepEqual(CONFIDENCE_TAPS.map((c) => c.label), ["Guess", "Unsure", "Fairly sure", "Certain"]);
		for (const c of CONFIDENCE_TAPS) assert.ok(CONFIDENCE_STOPS.includes(c.value), `${c.value} is a confidence stop`);
	});

	it("the two sure taps clear a gap and the two unsure ones don't", () => {
		assert.deepEqual(CONFIDENCE_TAPS.map((c) => c.value >= SOLID_CONFIDENCE), [false, false, true, true]);
	});

	it("an answer with no tap is accepted, and carries no confidence", async () => {
		const { svc } = await setup();
		assert.equal(svc.parseAnswer({ questionId: "q", indices: [1] }).confidence, undefined);
		assert.equal(svc.parseAnswer({ questionId: "q", indices: [1], confidence: 70 }).confidence, 70);
	});
});
