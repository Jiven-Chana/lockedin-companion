/**
 * v2.0 step 2: the session, finished to the lo-fi (task 1).
 *  - "Question 2 of 5" counts the question you are on, with dots.
 *  - The slide beside a question is that question's own slide.
 *  - The done screen shows no score: it names what comes back and the next block.
 *  - A break is offered at the end of a set.
 *  - The laptop says how question 1 went on the phone, and picks up at question 2.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { BLOCK_RULES, CLIENT_EVENT_TYPES, HANDOFF_COPY, questionNumber, SESSION_COPY, type StudyBlock } from "../src/core/companion/index.ts";
import { ManualClock } from "../src/server/companion/clock.ts";
import { CompanionContent } from "../src/server/companion/content.ts";
import { ScriptedEngine } from "../src/server/companion/engines/scripted.ts";
import { CompanionService } from "../src/server/companion/service.ts";
import { CompanionStore } from "../src/server/companion/store.ts";

const CONTENT = path.join(import.meta.dirname, "..", "companion", "content");
const day = (d: number, h = 12, m = 0) => new Date(2026, 10, d, h, m); // November 2026; the 23rd is a Monday
const UNIT = "nc-gans";

async function setup(now = day(24, 13)) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "companion-session-lofi-"));
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
	store.saveLectures([...store.allLectures(), { id: UNIT, module: "NC", title: "GANs", week: 0, order: 99, kind: "lecture", hasMaterials: true, source: { file: "notes.pdf", pages: [1, 20] } }]);
	fs.mkdirSync(store.materialsDir(UNIT), { recursive: true });
	fs.writeFileSync(path.join(store.materialsDir(UNIT), "slides.md"), "# GANs\n\n## Slide 3 — The generator\n\nText.\n\n## Slide 12 — The discriminator\n\nText.\n");
	fs.writeFileSync(path.join(store.materialsDir(UNIT), "map.mmd"), 'graph TD\n  generator["The generator · S3"]\n  discriminator["The discriminator · S12"]\n');
	const q = (i: number, node: string, slide: number, difficulty: number) => ({ id: `${UNIT}-q${i}`, stem: `Question ${i} on ${node}?`, options: ["Right", "Wrong A", "Wrong B"], correct: 0, explanation: `Because (Slide ${slide}).`, slides: [slide], node, difficulty });
	fs.writeFileSync(path.join(store.materialsDir(UNIT), "bank.json"), JSON.stringify([q(1, "generator", 3, 1), q(2, "discriminator", 12, 1), q(3, "generator", 3, 2), q(4, "discriminator", 12, 2), q(5, "generator", 3, 3)]));
	return { svc, store, clock };
}

/** Answer every question; `right(n)` says whether question n is answered correctly. */
async function answerAll(svc: CompanionService, sessionId: string, right: (n: number) => boolean) {
	for (let n = 1; ; n++) {
		const v = await svc.view(sessionId);
		if (v.status !== "question" || !v.question) return v;
		const want = right(n) ? "Right" : "Wrong A";
		await svc.answer(sessionId, { questionId: v.question.id, indices: [v.question.options.findIndex((o) => o.label === want) + 1], confidence: 70 });
	}
}

describe("the question you are on (lo-fi task 1)", () => {
	const table: [string, { answered: number; budget: number; done: boolean; reviewing: boolean }, number, string][] = [
		["the first question reads 1 of 5, not 0 of 5", { answered: 0, budget: 5, done: false, reviewing: false }, 1, "c...."],
		["its feedback is still question 1", { answered: 1, budget: 5, done: false, reviewing: true }, 1, "d...."],
		["then question 2", { answered: 1, budget: 5, done: false, reviewing: false }, 2, "dc..."],
		["the last question", { answered: 4, budget: 5, done: false, reviewing: false }, 5, "ddddc"],
		["feedback on the last", { answered: 5, budget: 5, done: false, reviewing: true }, 5, "ddddd"],
		["done", { answered: 5, budget: 5, done: true, reviewing: false }, 5, "ddddd"],
		["after three more", { answered: 5, budget: 8, done: false, reviewing: false }, 6, "dddddc.."],
		["a hand-off opens on question 2", { answered: 1, budget: 5, done: false, reviewing: false }, 2, "dc..."],
		["never past the end", { answered: 9, budget: 5, done: false, reviewing: false }, 5, "ddddc"],
		["an empty budget is still one question", { answered: 0, budget: 0, done: false, reviewing: false }, 1, "c"],
	];
	for (const [name, input, current, dots] of table) {
		it(name, () => {
			const at = questionNumber(input);
			assert.equal(at.current, current);
			assert.equal(at.dots.map((d) => (d === "done" ? "d" : d === "current" ? "c" : ".")).join(""), dots);
			assert.equal(at.total, Math.max(1, input.budget));
		});
	}
	it("the words", () => assert.equal(SESSION_COPY.position(2, 5), "Question 2 of 5"));
});

describe("the question's own slide", () => {
	it("a bank question carries the slides it comes from, and the next question brings its own", async () => {
		const { svc } = await setup();
		const { sessionId } = svc.createSession(svc.parseSpec({ kind: "post-lecture", lectureId: UNIT }));
		await svc.whenReady(sessionId);
		const first = await svc.view(sessionId);
		assert.deepEqual([first.question?.id, first.question?.slides], [`${UNIT}-q1`, [3]]);
		await svc.answer(sessionId, { questionId: first.question!.id, indices: [1], confidence: 70 });
		const second = await svc.view(sessionId);
		assert.deepEqual([second.question?.id, second.question?.slides], [`${UNIT}-q2`, [12]]);
	});
});

describe("the done screen names what comes back, not a score (R-6)", () => {
	it("ideas missed in this session are named once each, by the idea's title; and the next block", async () => {
		const { svc, store } = await setup();
		const block: StudyBlock = { id: "b1", date: "2026-11-26", start: "14:00", minutes: 50, status: "accepted", source: "planner" };
		store.saveBlocks([block]);
		const { sessionId } = svc.createSession(svc.parseSpec({ kind: "post-lecture", lectureId: UNIT }));
		await svc.whenReady(sessionId);
		// Questions 1, 3 and 5 are on the generator; get 1 and 3 wrong.
		const done = await answerAll(svc, sessionId, (n) => n !== 1 && n !== 3);
		assert.equal(done.status, "done");
		assert.deepEqual(done.comingBack, ["The generator"]);
		assert.equal(done.nextBlockAt, day(26, 14).toISOString());
		assert.equal(SESSION_COPY.comingBack(done.comingBack!), "Coming back in your next Practise: The generator.");
		assert.equal(SESSION_COPY.doneTitle(done.answered, "GANs"), "Done: 5 questions on GANs.");
	});

	it("nothing missed and no block planned: it says so", async () => {
		const { svc } = await setup();
		const { sessionId } = svc.createSession(svc.parseSpec({ kind: "post-lecture", lectureId: UNIT }));
		await svc.whenReady(sessionId);
		const done = await answerAll(svc, sessionId, () => true);
		assert.deepEqual([done.comingBack, done.nextBlockAt], [[], null]);
		assert.equal(SESSION_COPY.comingBack([]), "Nothing to come back to from this one.");
	});

	it("a question still being answered carries neither", async () => {
		const { svc } = await setup();
		const { sessionId } = svc.createSession(svc.parseSpec({ kind: "post-lecture", lectureId: UNIT }));
		await svc.whenReady(sessionId);
		const v = await svc.view(sessionId);
		assert.deepEqual([v.comingBack, v.nextBlockAt], [undefined, undefined]);
	});

	it("no score, no streak, in the words", () => {
		assert.equal(SESSION_COPY.noScore, "No streak, no score to keep up.");
		assert.equal(SESSION_COPY.nextBlock("Thu 14:00"), "Next: Thu 14:00 block, already in your week.");
		assert.equal(SESSION_COPY.doneTitle(1, "GANs"), "Done: 1 question on GANs.");
	});
});

describe("a break at the end of a set (INT-03-c, S-69)", () => {
	it("is five minutes, offered beside more questions and finishing", () => {
		assert.equal(SESSION_COPY.takeBreak(BLOCK_RULES.breakMinutes), "Take a 5-min break");
		assert.equal(SESSION_COPY.moreQuestions(3), "3 more questions");
		assert.equal(SESSION_COPY.finish, "Finish for today");
		assert.match(SESSION_COPY.breakRule, /never mid-question/);
		assert.match(SESSION_COPY.breakNote, /One buzz/);
	});
	it("the screen may log it", async () => {
		const { svc, store } = await setup();
		for (const t of ["break_started", "break_ended"] as const) assert.ok(CLIENT_EVENT_TYPES.includes(t));
		assert.deepEqual(svc.logClientEvents([{ type: "break_started", data: { sessionId: "s1", minutes: 5 } }, { type: "break_ended", data: { sessionId: "s1", natural: true } }]), { logged: 2 });
		assert.deepEqual(store.events().slice(-2).map((e) => e.type), ["break_started", "break_ended"]);
	});
});

describe("the hand-off from the phone says how question 1 went (R-8, AFF-H)", () => {
	const handoff = (correct: boolean) => ({ lectureId: UNIT, questionId: `${UNIT}-q1`, choice: correct ? 0 : 1, correct, at: day(24, 13).toISOString(), phoneEventId: `e-${correct}` });

	it("right on the phone: a tick, and the laptop picks up at question 2", async () => {
		const { svc } = await setup();
		svc.startHandoff(handoff(true));
		const b = svc.banner()!;
		assert.equal(b.text, "Question 1 answered on your phone ✓ 4 more ready.");
		assert.equal(b.startsAt, 2);
		assert.equal(HANDOFF_COPY.ready(b.startsAt), "Ready now · picks up at question 2");
	});

	it("wrong on the phone: it says so, and that it comes back", async () => {
		const { svc } = await setup();
		svc.startHandoff(handoff(false));
		const b = svc.banner()!;
		assert.equal(b.text, "Question 1: not quite. It comes back in your next Practise. 4 more ready.");
		assert.equal(b.startsAt, 2);
	});

	it("a hand-off with no question answered starts at question 1", async () => {
		const { svc } = await setup();
		svc.startHandoff({ lectureId: UNIT, at: day(24, 13).toISOString(), phoneEventId: "e-none" });
		assert.equal(svc.banner()!.startsAt, 1);
		assert.equal(HANDOFF_COPY.ready(1), "Ready now · question 1 is waiting");
	});
});
