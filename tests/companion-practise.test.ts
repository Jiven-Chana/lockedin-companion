/**
 * Practise (v2.0, V-40): which questions a round asks. Mixed across a
 * module's ideas and difficulties, weighted to gaps, never repeating a
 * question while its idea has others unused.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { ManualClock } from "../src/server/companion/clock.ts";
import { CompanionContent } from "../src/server/companion/content.ts";
import { ScriptedEngine } from "../src/server/companion/engines/scripted.ts";
import { CompanionError } from "../src/server/companion/errors.ts";
import { CompanionService } from "../src/server/companion/service.ts";
import { CompanionStore } from "../src/server/companion/store.ts";
import { ideaKeyOf, pickPractise, PRACTISE_RULES, type BankQuestion, type IdeaStanding, type PractiseCandidate } from "../src/core/companion/index.ts";

/** "u1:a:1" = unit u1, idea a, difficulty 1. A second question on the same idea and difficulty: "u1:a:1:b". */
const q = (spec: string): PractiseCandidate => {
	const [lectureId, node, difficulty] = spec.split(":");
	const question: BankQuestion = { id: spec, stem: `${spec}?`, options: ["A", "B", "C"], correct: 0, explanation: "Because.", slides: [1], node: node!, difficulty: Number(difficulty) as 1 | 2 | 3 };
	return { lectureId: lectureId!, question };
};
const ids = (r: PractiseCandidate[]) => r.map((c) => c.question.id);
const asked = (rows: Record<string, [number, number]>) => new Map(Object.entries(rows).map(([id, [times, last]]) => [id, { times, last }]));
const standing = (rows: Record<string, IdeaStanding>) => new Map(Object.entries(rows));
const NONE = new Map<string, { times: number; last: number }>();

// Two units, six ideas, three difficulties.
const MODULE = ["u1:a:1", "u1:a:2", "u1:b:2", "u1:b:3", "u1:c:1", "u2:d:1", "u2:d:3", "u2:e:2", "u2:f:3"].map(q);

describe("a Practise round is mixed across a module's ideas", () => {
	it("takes one question per idea before any idea gets a second, across units", () => {
		const round = pickPractise({ candidates: MODULE, asked: NONE, standing: standing({}), n: 5 });
		assert.equal(round.length, 5);
		assert.equal(new Set(round.map(ideaKeyOf)).size, 5, "five different ideas");
		assert.deepEqual([...new Set(round.map((c) => c.lectureId))].sort(), ["u1", "u2"], "not one unit in order");
	});

	it("is asked easiest first", () => {
		const round = pickPractise({ candidates: MODULE, asked: NONE, standing: standing({}), n: 5 });
		const d = round.map((c) => c.question.difficulty);
		assert.deepEqual(d, [...d].sort((a, b) => a - b));
	});

	it("has some of each difficulty when the ideas offer the choice", () => {
		const round = pickPractise({ candidates: MODULE, asked: NONE, standing: standing({}), n: 5 });
		assert.deepEqual([...new Set(round.map((c) => c.question.difficulty))].sort(), [1, 2, 3]);
	});

	it("fewer ideas than questions: each idea is used again, with a different question", () => {
		const round = pickPractise({ candidates: ["u1:a:1", "u1:a:2", "u1:a:3", "u1:b:1", "u1:b:2"].map(q), asked: NONE, standing: standing({}), n: 4 });
		assert.equal(new Set(ids(round)).size, 4);
		assert.deepEqual(round.map((c) => c.question.node).sort(), ["a", "a", "b", "b"]);
	});

	it("never more questions than there are, and none for an empty bank", () => {
		assert.equal(pickPractise({ candidates: ["u1:a:1", "u1:b:1"].map(q), asked: NONE, standing: standing({}), n: 5 }).length, 2);
		assert.deepEqual(pickPractise({ candidates: [], asked: NONE, standing: standing({}), n: 5 }), []);
		assert.deepEqual(pickPractise({ candidates: MODULE, asked: NONE, standing: standing({}), n: 0 }), []);
	});

	it("the same history gives the same round", () => {
		const input = { candidates: MODULE, asked: asked({ "u1:a:1": [1, 100] }), standing: standing({ "u1#b": "gap" }), n: 5 };
		assert.deepEqual(ids(pickPractise(input)), ids(pickPractise(input)));
		assert.deepEqual(ids(pickPractise({ ...input, candidates: [...MODULE].reverse() })).sort(), ids(pickPractise(input)).sort(), "whatever order the bank comes in");
	});
});

describe("a round is weighted to gaps, and stays mixed", () => {
	it("ideas with a gap come first, then fading ones", () => {
		const round = pickPractise({ candidates: MODULE, asked: NONE, standing: standing({ "u2#f": "gap", "u1#c": "fading" }), n: 2 });
		assert.deepEqual(round.map(ideaKeyOf).sort(), ["u1#c", "u2#f"]);
	});

	it("at most gapShare of a round goes to repair while other ideas are available", () => {
		const all = standing(Object.fromEntries(["u1#a", "u1#b", "u1#c", "u2#d", "u2#e"].map((k) => [k, "gap" as const])));
		const round = pickPractise({ candidates: MODULE, asked: NONE, standing: all, n: 5 });
		const keys = round.map(ideaKeyOf);
		assert.equal(keys.filter((k) => all.has(k)).length, Math.ceil(5 * PRACTISE_RULES.gapShare) + 1, "three by weight, one more because only one other idea exists");
		assert.ok(keys.includes("u2#f"), "the idea with no gap still comes round");
	});

	it("with nothing else to ask, a round can be all repair", () => {
		const candidates = ["u1:a:1", "u1:b:1", "u1:c:1"].map(q);
		const round = pickPractise({ candidates, asked: NONE, standing: standing({ "u1#a": "gap", "u1#b": "gap", "u1#c": "fading" }), n: 3 });
		assert.equal(round.length, 3);
	});

	it("with no gaps, the ideas asked least recently come first", () => {
		const candidates = ["u1:a:1", "u1:b:1", "u1:c:1", "u1:d:1"].map(q);
		const round = pickPractise({ candidates, asked: asked({ "u1:a:1": [1, 400], "u1:b:1": [1, 100], "u1:c:1": [1, 300] }), standing: standing({ "u1#a": "ok", "u1#b": "ok", "u1#c": "ok" }), n: 2 });
		assert.deepEqual(round.map((c) => c.question.node).sort(), ["b", "d"], "never asked, then the oldest");
	});
});

describe("a question is not repeated until the others on its idea are used", () => {
	const candidates = ["u1:a:1", "u1:a:2", "u1:a:3"].map(q);
	const table: [string, Record<string, [number, number]>, string][] = [
		["nothing asked: the easiest", {}, "u1:a:1"],
		["one asked: one of the others", { "u1:a:1": [1, 100] }, "u1:a:2"],
		["two asked: the third", { "u1:a:1": [1, 100], "u1:a:2": [1, 200] }, "u1:a:3"],
		["all asked once: the one asked longest ago", { "u1:a:1": [1, 300], "u1:a:2": [1, 100], "u1:a:3": [1, 200] }, "u1:a:2"],
		["asked unevenly: the least asked", { "u1:a:1": [3, 900], "u1:a:2": [2, 100], "u1:a:3": [3, 50] }, "u1:a:2"],
	];
	for (const [name, history, expected] of table) {
		it(name, () => assert.deepEqual(ids(pickPractise({ candidates, asked: asked(history), standing: standing({}), n: 1 })), [expected]));
	}

	it("questions already in this session are left out", () => {
		const round = pickPractise({ candidates, asked: NONE, standing: standing({}), n: 3, exclude: new Set(["u1:a:1", "u1:a:2"]) });
		assert.deepEqual(ids(round), ["u1:a:3"]);
	});
});

// ─── through the service ────────────────────────────────────────────────────

const CONTENT = path.join(import.meta.dirname, "..", "companion", "content");
const day = (d: number, h = 12, m = 0) => new Date(2026, 10, d, h, m); // November 2026

async function setup(now = day(24, 13)) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "companion-practise-"));
	const store = new CompanionStore(dir);
	const content = new CompanionContent(store, CONTENT);
	const clock = new ManualClock(now);
	let n = 0;
	const scripted = () => new ScriptedEngine((id) => content.scriptedSet(id), (picks) => content.practiseSet(picks));
	const svc = new CompanionService({
		store, content, clock,
		clockControl: { set: (t) => clock.set(t), reset: () => clock.set(now) },
		// "learnharness" stands in for the AI: a Practise round must never use it.
		engines: { scripted: scripted(), learnharness: scripted() },
		defaultEngine: "learnharness",
		generate: (async () => { throw new Error("not called"); }) as never,
		newId: (p) => `${p}${++n}`,
	});
	await svc.onboardFlow({ calendar: { kind: "none" }, modules: [{ code: "GT", name: "Game Theory" }, { code: "NC", name: "Neural Computation" }, { code: "HCI", name: "Human Computer Interaction" }] });
	const addUnit = (id: string, module: string, title: string, ideas: [string, number, number][]) => {
		store.saveLectures([...store.allLectures(), { id, module, title, week: 0, order: store.allLectures().length + 1, kind: "lecture", hasMaterials: true, source: { file: "notes.pdf", pages: [1, 9] } }]);
		fs.mkdirSync(store.materialsDir(id), { recursive: true });
		fs.writeFileSync(path.join(store.materialsDir(id), "slides.md"), `# ${title}\n\n## Slide 1 — ${title}\n\nText.\n`);
		fs.writeFileSync(path.join(store.materialsDir(id), "map.mmd"), ["graph TD", ...[...new Set(ideas.map((i) => i[0]))].map((x) => `  ${x}["${x} · S1"]`), ""].join("\n"));
		fs.writeFileSync(path.join(store.materialsDir(id), "bank.json"), JSON.stringify(ideas.map(([node, difficulty, slide], i) => ({ id: `${id}-q${i + 1}`, stem: `${title}: ${node} ${i + 1}?`, options: ["Right", "Wrong A", "Wrong B"], correct: 0, explanation: `Because (Slide ${slide}).`, slides: [slide], node, difficulty }))));
	};
	addUnit("gt-1", "GT", "Dominance", [["dominated", 1, 2], ["dominated", 2, 3], ["iterated", 2, 4]]);
	addUnit("gt-2", "GT", "Nash", [["nash", 1, 5], ["nash", 3, 6], ["mixed", 2, 7], ["support", 3, 8]]);
	addUnit("nc-1", "NC", "GANs", [["generator", 1, 2]]);
	return { svc, store, clock };
}

async function run(svc: CompanionService, sessionId: string, right: (stem: string) => boolean) {
	const seen: { id: string; lectureId?: string; slides?: number[] }[] = [];
	for (;;) {
		const v = await svc.view(sessionId);
		if (v.status !== "question" || !v.question) return { view: v, seen };
		seen.push({ id: v.question.id, lectureId: v.question.lectureId, slides: v.question.slides });
		const want = right(v.question.stem) ? "Right" : "Wrong A";
		await svc.answer(sessionId, { questionId: v.question.id, indices: [v.question.options.findIndex((o) => o.label === want) + 1], confidence: 70 });
	}
}

describe("a Practise round, through the service (V-40)", () => {
	it("draws five questions across the module's units, on the question bank, never the AI", async () => {
		const { svc, store } = await setup();
		const { sessionId } = svc.startPractise({ module: "GT" });
		await svc.whenReady(sessionId);
		const session = store.session(sessionId)!;
		assert.deepEqual([session.engine, session.spec.kind, session.spec.study, session.budget], ["scripted", "practise", "practise", 5]);
		assert.deepEqual([...new Set(session.spec.practise!.picks.map((p) => p.lectureId))].sort(), ["gt-1", "gt-2"]);
		assert.ok(session.spec.practise!.picks.every((p) => p.lectureId.startsWith("gt-")), "only this module");
		const v = await svc.view(sessionId);
		assert.deepEqual([v.study, v.practiseOf, v.goal], ["practise", "Game Theory", "5 quick questions across Game Theory, about 3 minutes"]);
	});

	it("each question knows its unit and its slide, and a wrong answer is a gap on that unit's idea", async () => {
		const { svc, store } = await setup();
		const { sessionId } = svc.startPractise({ module: "GT" });
		await svc.whenReady(sessionId);
		const { view, seen } = await run(svc, sessionId, (stem) => !stem.startsWith("Nash: nash"));
		assert.equal(view.status, "done");
		assert.ok(seen.every((q) => q.lectureId === (q.id.startsWith("gt-1") ? "gt-1" : "gt-2") && q.slides?.length === 1));
		const misses = store.misses().filter((m) => m.status === "open");
		assert.deepEqual(misses.map((m) => [m.lectureId, m.nodeId]), [["gt-2", "nash"]]);
		const answers = store.events().filter((e) => e.type === "answer");
		assert.equal(answers.length, 5);
		assert.ok(answers.every((e) => e.data.study === "practise" && e.data.kind === "practise" && e.data.engine === "scripted"));
		assert.deepEqual([...new Set(answers.map((e) => e.data.lectureId))].sort(), ["gt-1", "gt-2"], "each answer is logged against its own unit");
		assert.deepEqual(view.comingBack, ["nash"]);
	});

	it("the next round leads with the gap and does not repeat a question while others are unused", async () => {
		const { svc, store, clock } = await setup();
		const first = svc.startPractise({ module: "GT" });
		await svc.whenReady(first.sessionId);
		await run(svc, first.sessionId, (stem) => !stem.startsWith("Nash: nash"));
		const asked = new Set(store.session(first.sessionId)!.spec.practise!.picks.map((p) => p.questionId));
		clock.set(day(25, 13));
		const second = svc.startPractise({ module: "GT" });
		const picks = store.session(second.sessionId)!.spec.practise!.picks.map((p) => p.questionId);
		const fresh = picks.filter((id) => !asked.has(id));
		assert.equal(fresh.length, 2, "the two questions not asked yesterday are both in");
		assert.ok(picks.some((id) => id === "gt-2-q1" || id === "gt-2-q2"), "the idea with a gap is asked again");
	});

	it("\"3 more\" chooses new questions by the same rule, and says so when there are none", async () => {
		const { svc, store } = await setup();
		const { sessionId } = svc.startPractise({ module: "GT" });
		await svc.whenReady(sessionId);
		await run(svc, sessionId, () => true);
		const more = await svc.more(sessionId, {});
		assert.equal(more.budget, 7, "seven questions exist: two more, not three");
		assert.equal(new Set(store.session(sessionId)!.spec.practise!.picks.map((p) => p.questionId)).size, 7);
		const { view } = await run(svc, sessionId, () => true);
		assert.deepEqual([view.status, view.answered], ["done", 7]);
		await assert.rejects(svc.more(sessionId, {}), (e: CompanionError) => e.status === 409 && e.code === "no_more_questions");
	});

	it("a module with no questions yet says so; an unknown module is refused", async () => {
		const { svc } = await setup();
		assert.throws(() => svc.startPractise({ module: "HCI" }), (e: CompanionError) => e.status === 422 && e.code === "no_questions" && /No questions for this module yet/.test(e.message));
		assert.throws(() => svc.startPractise({ module: "XX" }), (e: CompanionError) => e.status === 400);
		assert.throws(() => svc.startPractise({}), (e: CompanionError) => e.status === 400);
	});
});

describe("the question after a lecture opens a Practise round (V-40)", () => {
	it("a hand-off from the phone is Practise on the unit's bank, not the AI", async () => {
		const { svc, store } = await setup();
		const r = svc.startHandoff({ lectureId: "gt-2", questionId: "gt-2-q1", choice: 0, correct: true, at: day(24, 13).toISOString(), phoneEventId: "e1" })!;
		const session = store.session(r.sessionId)!;
		assert.deepEqual([session.engine, session.spec.study, session.spec.kind], ["scripted", "practise", "post-lecture"]);
		await svc.whenReady(r.sessionId);
		assert.equal((await svc.view(r.sessionId)).study, "practise");
	});

	it("a unit with no question bank can only be taught, so it stays Learn on the AI", async () => {
		const { svc, store } = await setup();
		store.saveLectures([...store.allLectures(), { id: "gt-3", module: "GT", title: "No pack yet", week: 0, order: 99, kind: "lecture", hasMaterials: true }]);
		const { sessionId } = svc.createSession({ ...svc.parseSpec({ kind: "post-lecture", lectureId: "gt-3" }), study: "practise" });
		const session = store.session(sessionId)!;
		assert.deepEqual([session.engine, session.spec.study], ["learnharness", "learn"]);
	});

	it("any session the tutor runs is Learn, whatever started it (two modes only)", async () => {
		const { svc, store } = await setup();
		const { sessionId } = svc.createSession(svc.parseSpec({ kind: "post-lecture", lectureId: "gt-2" }));
		const session = store.session(sessionId)!;
		assert.equal(session.engine, "learnharness");
		assert.deepEqual([session.spec.study, session.spec.learn?.scope, session.budget], ["learn", "lecture", 0]);
		assert.equal((await svc.view(sessionId)).study, "learn");
	});
});

