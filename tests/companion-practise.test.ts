/**
 * Practise (v2.0, V-40): which questions a round asks. Mixed across a
 * module's ideas and difficulties, weighted to gaps, never repeating a
 * question while its idea has others unused.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
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
