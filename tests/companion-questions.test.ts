/**
 * v3.1 Part A: Practise questions that stand on their own and are worth
 * answering. Jiven, 28 Nov: "some of the practise Qs are really fucking easy
 * and some are just not really well written and feels like AI slop", and of
 * "In the lecture's temperature example, which estimate minimises the total
 * absolute error for measurements 17, 19, and 24?": "how am i supposed to know?"
 *
 * The questions stay on the cheap model, one call a unit (AI usage is the
 * constraint). What changes is the prompt, rule checks in code, and one small
 * second call that sees only the questions.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { applyColdCheck, checkQuestion, dedupeQuestions, leansOnContext, PACK_RULES, PHONE_RULES, pickPractise, retargetExplainers, type BankQuestion, type Explainer, type PractiseCandidate } from "../src/core/companion/index.ts";

const ROOT = path.join(import.meta.dirname, "..");
const ctx = { slides: new Set([1, 2, 3, 4]), nodes: new Set(["estimators", "nash"]) };
const q = (over: Partial<BankQuestion> = {}): BankQuestion => ({
	id: "q1", stem: "Measurements are 17, 19 and 24. Which single estimate minimises the total absolute error?", options: ["The median, 19", "The mean, 20", "The midrange, 20.5"], correct: 0,
	explanation: "Total absolute error is smallest at the median; the mean minimises squared error instead.", slides: [2], node: "estimators", difficulty: 3, ...over,
});

describe("a question stands on its own", () => {
	it("has room to state the example it uses", () => {
		assert.equal(PACK_RULES.stemMax, 200);
		assert.equal(checkQuestion(q(), ctx), null);
		assert.equal(checkQuestion(q({ stem: `${"x".repeat(199)}?` }), ctx), null);
		assert.match(checkQuestion(q({ stem: "x".repeat(201) }), ctx) ?? "", /keep it to 200/);
	});

	const leaning: Array<[string, string]> = [
		["the question he quoted", "In the lecture's temperature example, which estimate minimises the total absolute error for measurements 17, 19, and 24?"],
		["a slide by number", "On slide 12, which term is the regulariser?"],
		["the slides", "According to the slides, what does the discriminator output?"],
		["the lecture", "What did the lecture say a perceptron cannot learn?"],
		["something above", "In the example above, which player has a dominant strategy?"],
		["a figure that is not there", "In the diagram shown, which node is the generator?"],
		["class", "As we saw in class, what is a best response?"],
		["earlier", "Using the payoff table from earlier, find the Nash equilibrium."],
		["the notes", "In the notes, which loss is used for GANs?"],
		["this module's convention, unstated", "Using the course's notation, what is z?"],
	];
	for (const [name, stem] of leaning) it(`refuses a stem that points at ${name}`, () => {
		assert.ok(leansOnContext(stem), stem);
		assert.match(checkQuestion(q({ stem }), ctx) ?? "", /stands on its own/);
	});

	const fine = [
		"Measurements are 17, 19 and 24. Which single estimate minimises the total absolute error?",
		"A generator maps noise z to samples. What does the discriminator output for a sample?",
		"Player A's payoffs are (3, 1) and (2, 4). Which row is A's best response to column 1?",
		"Which of these is an example of unsupervised learning?",
		"A lecturer wants students to recall more. Which practice helps most?",
		"Why does sliding a window over an image share weights?",
		"Which note in a C major scale is the dominant?",
	];
	for (const stem of fine) it(`accepts: ${stem.slice(0, 50)}…`, () => {
		assert.equal(leansOnContext(stem), null);
		assert.equal(checkQuestion(q({ stem }), ctx), null);
	});

	it("an option cannot point away either", () => {
		assert.match(checkQuestion(q({ options: ["The median, 19", "The value on slide 4", "The midrange, 20.5"] }), ctx) ?? "", /stands on its own/);
	});
});

describe("the right answer cannot be spotted without knowing the material", () => {
	it("refuses a right answer that stands out by its length", () => {
		const long = "It maximises your own payoff given exactly what every other player is choosing";
		assert.match(checkQuestion(q({ options: [long, "Any strategy", "A random one"] }), ctx) ?? "", /same length and form/);
		// A wrong option as long as the right one: nothing stands out.
		assert.equal(checkQuestion(q({ options: [long, "It maximises the total payoff of all the players taken together", "A random one"] }), ctx), null);
		// Short answers of different lengths are fine: the difference is a few characters.
		assert.equal(checkQuestion(q({ options: ["The median, 19", "20", "The midrange, 20.5"] }), ctx), null);
	});
	for (const bad of ["All of the above", "None of the above", "Both A and B", "all of these"]) it(`refuses "${bad}"`, () => {
		assert.match(checkQuestion(q({ options: ["The median, 19", "The mean, 20", bad] }), ctx) ?? "", /a real answer/);
	});
});

describe("no two questions in a unit are the same question", () => {
	const a = q({ id: "a", stem: "What does the discriminator in a GAN output for a sample?" });
	it("drops the later of two that ask the same thing in nearly the same words", () => {
		const b = q({ id: "b", stem: "What does the discriminator in a GAN output for one sample?" });
		const c = q({ id: "c", stem: "Which loss does the generator minimise?" });
		const r = dedupeQuestions([a, b, c]);
		assert.deepEqual(r.kept.map((x) => x.id), ["a", "c"]);
		assert.deepEqual(r.dropped, [{ index: 1, like: 0 }]);
	});
	it("keeps two questions on one idea that ask different things", () => {
		const b = q({ id: "b", stem: "Why does the discriminator in a GAN need real samples as well?" });
		assert.equal(dedupeQuestions([a, b]).kept.length, 2);
	});
	it("the same wording over different numbers is a different case to work, and is kept", () => {
		const one = q({ id: "a", stem: "Payoffs are (3, 1) and (2, 4). Which row is the best response to column 1?" });
		const two = q({ id: "b", stem: "Payoffs are (5, 0) and (1, 6). Which row is the best response to column 1?" });
		assert.equal(dedupeQuestions([one, two]).kept.length, 2);
		assert.equal(dedupeQuestions([one, { ...one, id: "c" }]).kept.length, 1);
	});
	it("case and punctuation do not make a question new", () => {
		assert.equal(dedupeQuestions([a, q({ id: "b", stem: "what does the DISCRIMINATOR in a gan output, for a sample" })]).kept.length, 1);
	});
});

describe("the small second check, which sees only the questions", () => {
	const five = Array.from({ length: 10 }, (_, i) => q({ id: `q${i + 1}`, correct: (i % 3) as 0 | 1 | 2 }));
	const agree = five.map((x, i) => ({ n: i + 1, answerable: true, answer: x.correct }));

	it("keeps what it can answer and agrees with", () => {
		const r = applyColdCheck(five, agree);
		assert.equal(r.kept.length, 10);
		assert.deepEqual(r.dropped, []);
	});
	it("drops a question it cannot answer as posed, and one it answers differently", () => {
		const verdicts = agree.map((v) => (v.n === 2 ? { ...v, answerable: false, answer: null } : v.n === 5 ? { ...v, answer: (v.answer! + 1) % 3 } : v));
		const r = applyColdCheck(five, verdicts);
		assert.deepEqual(r.kept.map((x) => x.id), ["q1", "q3", "q4", "q6", "q7", "q8", "q9", "q10"]);
		assert.deepEqual(r.dropped, [{ index: 1, reason: "unanswerable" }, { index: 4, reason: "disagrees" }]);
	});
	it("a question it said nothing about is kept", () => {
		assert.equal(applyColdCheck(five, agree.slice(0, 3)).kept.length, 10);
		assert.equal(applyColdCheck(five, []).kept.length, 10);
	});
	it("it has no slides, so when disagreeing would leave too few it is overruled; what it could not answer still goes", () => {
		const verdicts = agree.map((v) => (v.n === 1 ? { ...v, answerable: false, answer: null } : v.n <= 6 ? { ...v, answer: (v.answer! + 1) % 3 } : v));
		const r = applyColdCheck(five, verdicts);
		assert.equal(r.kept.length, 9, `below ${PACK_RULES.coldFloor} the disagreements are not acted on`);
		assert.deepEqual(r.dropped, [{ index: 0, reason: "unanswerable" }]);
	});
	it("an answer out of range, or a verdict for a question that is not there, is ignored", () => {
		assert.equal(applyColdCheck(five, [{ n: 99, answerable: false, answer: null }, { n: 1, answerable: true, answer: 7 }]).kept.length, 10);
	});
});

describe("a round is not the easiest questions", () => {
	const cand = (lectureId: string, id: string, node: string, difficulty: 1 | 2 | 3): PractiseCandidate => ({ lectureId, question: q({ id, node, difficulty }) });
	it("where history cannot choose between two questions on an idea, the harder one is asked", () => {
		const candidates = ["a", "b", "c"].flatMap((n) => [cand("u", `${n}1`, n, 1), cand("u", `${n}3`, n, 3)]);
		const picked = pickPractise({ candidates, asked: new Map(), standing: new Map(), n: 3 });
		assert.deepEqual(picked.map((p) => p.question.difficulty), [1, 3, 3], "two applied, one easier to open on");
	});
	it("still opens on the easiest of what it chose", () => {
		const candidates = [cand("u", "a3", "a", 3), cand("u", "b2", "b", 2), cand("u", "c1", "c", 1)];
		assert.deepEqual(pickPractise({ candidates, asked: new Map(), standing: new Map(), n: 3 }).map((p) => p.question.difficulty), [1, 2, 3]);
	});
});

describe("an explainer still ends on a question after the questions are rewritten", () => {
	const e = (over: Partial<Explainer>): Explainer => ({ id: "e1", node: "nash", title: "T", terms: [], body: "B", diagram: "flowchart LR\n a --> b", slides: [1], tryQuestionId: "old-q7", ...over });
	it("one whose question is gone points at another on the same idea; with none on the idea it is dropped", () => {
		const bank = [q({ id: "new-q1", node: "estimators" }), q({ id: "new-q2", node: "nash" }), q({ id: "new-q3", node: "nash" })];
		const out = retargetExplainers([e({ id: "e1" }), e({ id: "e2", node: "estimators", tryQuestionId: "new-q1" }), e({ id: "e3", node: "gone" })], bank);
		assert.deepEqual(out.map((x) => [x.id, x.tryQuestionId]), [["e1", "new-q2"], ["e2", "new-q1"]]);
	});
});

describe("the phone's notification prefers a question short enough to read on a lock screen", () => {
	it("the limit is the old one, so notifications read as they did", () => assert.equal(PHONE_RULES.notifyStemMax, 90));
});

describe("what the question writer is told", () => {
	const bank = fs.readFileSync(path.join(ROOT, "companion", "prompts", "bank.md"), "utf-8");
	const gap = fs.readFileSync(path.join(ROOT, "companion", "prompts", "gap-questions.md"), "utf-8");
	const check = fs.readFileSync(path.join(ROOT, "companion", "prompts", "bank-check.md"), "utf-8");
	it("a question stands on its own: it gives the numbers or the case it needs", () => {
		for (const p of [bank, gap]) {
			assert.match(p, /stands on its own/);
			assert.match(p, /at most 200 characters/);
			assert.doesNotMatch(p, /answerable from the slides alone/);
			assert.doesNotMatch(p, /at most 90 characters/);
		}
	});
	it("applied questions first, not mostly recall", () => {
		assert.match(bank, /At least half .* apply/);
		assert.doesNotMatch(bank, /mostly 1 and 2/);
	});
	it("wrong options are made from the right one", () => {
		for (const p of [bank, gap]) assert.match(p, /same length and form/);
		assert.match(bank, /without knowing the material/);
	});
	it("still one call for a unit", () => assert.match(bank, /call `submit_bank` once/));
	it("the checker is given the questions only, and told what to report", () => {
		assert.match(check, /You do not have the slides/);
		assert.match(check, /`answerable`/);
		assert.match(check, /call `submit_check` once/);
	});
});
