/**
 * The round on the phone (v2.1 part A; V-46, V-67): the rest of a question's
 * round travels with it so "Keep going here" needs no laptop, what was saved
 * comes straight after the next lecture's own question, and a notification
 * never grows past what the relay accepts. Pure rules.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildRound, fitNudge, initialScriptedState, PHONE_RULES, savedAfter, type NudgeQuestion, type ScriptedSet, type SessionSpec } from "../src/core/companion/index.ts";

const q = (id: string, lectureId = id.split("-")[0]!): NudgeQuestion => ({ id, lectureId, stem: `${id}?`, options: ["a", "b", "c"], correct: 0, explanation: "because", slides: [3] });
const ids = (qs: NudgeQuestion[]) => qs.map((x) => x.id);

describe("the rest of the round", () => {
	it("is what was saved, then the lecture's own questions, never the first question again, up to five in all", () => {
		const own = ["gt-1", "gt-2", "gt-3", "gt-4", "gt-5", "gt-6"].map((id) => q(id));
		const cases: { name: string; first: string; saved: string[]; size?: number; want: string[] }[] = [
			{ name: "nothing saved", first: "gt-1", saved: [], want: ["gt-2", "gt-3", "gt-4", "gt-5"] },
			{ name: "saved from another lecture follow the new lecture's own question", first: "gt-1", saved: ["hci-7", "hci-8"], want: ["hci-7", "hci-8", "gt-2", "gt-3"] },
			{ name: "more saved than fit", first: "gt-1", saved: ["hci-1", "hci-2", "hci-3", "hci-4", "hci-5"], want: ["hci-1", "hci-2", "hci-3", "hci-4"] },
			{ name: "the first question was itself saved", first: "gt-2", saved: ["gt-2", "gt-3"], want: ["gt-3", "gt-1", "gt-4", "gt-5"] },
			{ name: "a smaller round", first: "gt-1", saved: ["hci-7"], size: 3, want: ["hci-7", "gt-2"] },
		];
		for (const c of cases) {
			assert.deepEqual(ids(buildRound({ first: q(c.first), saved: c.saved.map((id) => q(id)), own, size: c.size ?? PHONE_RULES.roundSize })), c.want, c.name);
		}
		assert.equal(PHONE_RULES.roundSize, 5);
	});

	it("a short bank gives a short round", () => {
		assert.deepEqual(ids(buildRound({ first: q("gt-1"), saved: [], own: [q("gt-1"), q("gt-2")], size: 5 })), ["gt-2"]);
		assert.deepEqual(buildRound({ first: q("gt-1"), saved: [], own: [q("gt-1")], size: 5 }), []);
	});
});

describe("what is saved for later", () => {
	const ref = (id: string) => ({ lectureId: id.split("-")[0]!, questionId: id });
	it("the newest are kept, each once, and an answer takes its question off the list", () => {
		let saved = savedAfter([], { add: [ref("hci-1"), ref("hci-2")] }, 4);
		assert.deepEqual(saved.map((s) => s.questionId), ["hci-1", "hci-2"]);
		saved = savedAfter(saved, { add: [ref("hci-2"), ref("gt-1"), ref("gt-2"), ref("gt-3")] }, 4);
		assert.deepEqual(saved.map((s) => s.questionId), ["hci-2", "gt-1", "gt-2", "gt-3"], "the oldest gives way");
		saved = savedAfter(saved, { remove: ["gt-1", "nope"] }, 4);
		assert.deepEqual(saved.map((s) => s.questionId), ["hci-2", "gt-2", "gt-3"]);
	});
});

describe("a notification the relay will accept", () => {
	it("loses questions from the end of its round until it fits; its own question always stays", () => {
		const long = (id: string) => ({ ...q(id), explanation: "x".repeat(900) });
		const nudge = { id: "N-1:gt", question: long("gt-1"), round: [long("gt-2"), long("gt-3"), long("gt-4"), long("gt-5")] };
		assert.equal(fitNudge(nudge, 100_000).round.length, 4);
		const cut = fitNudge(nudge, 4_000);
		assert.ok(JSON.stringify(cut).length <= 4_000);
		assert.ok(cut.round.length >= 1 && cut.round.length < 4);
		assert.deepEqual(ids(cut.round), ids(nudge.round).slice(0, cut.round.length));
		const tiny = fitNudge(nudge, 1_200);
		assert.deepEqual(tiny.round, []);
		assert.equal(tiny.question.id, "gt-1");
		// A notification with no round is left as it is.
		const plain: { id: string; body: string; round?: unknown[] } = { id: "N-5", body: "x".repeat(50) };
		assert.deepEqual(fitNudge(plain, 10), { id: "N-5", body: "x".repeat(50) });
	});
});

describe("picking up on the laptop after several answers on the phone", () => {
	const set: ScriptedSet = { lectureId: "gt", questions: [1, 2, 3, 4, 5].map((n) => ({ id: `gt-${n}`, stem: `gt-${n}?`, options: ["a", "b", "c"], correct: [0], explanation: "because", nodeId: `n${n}` })) };
	const spec = (over: Partial<SessionSpec>): SessionSpec => ({ kind: "practise", lectureId: "gt", mode: "question-first", budget: { questions: 5, minutes: 10 }, study: "practise", ...over });
	const at = "2026-11-24T13:06:00.000Z";

	it("every phone answer is already on the record and the session opens on the next question", () => {
		const cases: { name: string; over: Partial<SessionSpec>; position: number; answered: string[]; right: boolean[] }[] = [
			{ name: "none", over: {}, position: 0, answered: [], right: [] },
			{ name: "one, the old way", over: { seedAnswer: { questionId: "gt-1", choice: 0, correct: true, at } }, position: 1, answered: ["gt-1"], right: [true] },
			{ name: "three", over: { seedAnswers: [{ questionId: "gt-1", choice: 0, correct: true, at }, { questionId: "gt-2", choice: 1, correct: false, at }, { questionId: "gt-3", choice: 0, correct: true, at }] }, position: 3, answered: ["gt-1", "gt-2", "gt-3"], right: [true, false, true] },
			{ name: "one the laptop doesn't have is left out", over: { seedAnswers: [{ questionId: "zz-9", choice: 0, correct: true, at }, { questionId: "gt-2", choice: 0, correct: true, at }] }, position: 1, answered: ["gt-2"], right: [true] },
		];
		for (const c of cases) {
			const s = initialScriptedState(set, spec(c.over));
			assert.equal(s.position, c.position, c.name);
			assert.deepEqual(s.answers.map((a) => a.questionId), c.answered, c.name);
			assert.deepEqual(s.answers.map((a) => a.correct), c.right, c.name);
			assert.deepEqual(s.queue.slice(0, c.position), c.answered, c.name);
			assert.equal(s.queue.length, 5, c.name);
		}
	});
});
