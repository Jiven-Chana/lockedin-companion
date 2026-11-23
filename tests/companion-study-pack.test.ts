/**
 * Study packs (v0.1 F-105): every generated item passes these checks or
 * is regenerated once and then dropped.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bankToScriptedSet, checkExplainer, checkMapNodes, checkQuestion, PACK_RULES, stripQuestionIds, validateScriptedSet, type BankQuestion, type Explainer } from "../src/core/companion/index.ts";

const ctx = { slides: new Set([1, 2, 3, 4]), nodes: new Set(["best-response", "nash"]) };
const q = (over: Partial<BankQuestion> = {}): BankQuestion => ({
	id: "q1", stem: "What is a best response?", options: ["Highest payoff given others", "Any strategy", "A dominated strategy"], correct: 0,
	explanation: "It maximises your payoff given what the others play.", slides: [2], node: "best-response", difficulty: 1, ...over,
});
const e = (over: Partial<Explainer> = {}): Explainer => ({
	id: "e1", node: "nash", title: "Nash equilibrium", terms: ["best response"], body: "Each player's strategy is a best response to the others.",
	diagram: "flowchart LR\n  a[Mark best responses] --> b[Both marked?]", slides: [3], tryQuestionId: "q1", ...over,
});

describe("bank questions", () => {
	const cases: Array<[string, Partial<BankQuestion>, RegExp | null]> = [
		["a good question", {}, null],
		["a stem too long for a notification", { stem: "x".repeat(PACK_RULES.stemMax + 1) }, /keep it to 90/],
		["two options", { options: ["a", "b"] as never }, /exactly 3/],
		["duplicate options", { options: ["Yes", "yes", "No"] }, /must differ/],
		["correct out of range", { correct: 3 as never }, /0, 1 or 2/],
		["an explanation too long", { explanation: "y".repeat(141) }, /keep it to 140/],
		["a slide that doesn't exist", { slides: [9] }, /slide 9 doesn't exist/],
		["no citation", { slides: [] }, /at least one slide/],
		["a node not on the map", { node: "auctions" }, /isn't on the map/],
		["a bad difficulty", { difficulty: 4 as never }, /1, 2 or 3/],
	];
	for (const [name, over, problem] of cases)
		it(name, () => {
			const r = checkQuestion(q(over), ctx);
			if (problem) assert.match(r ?? "", problem);
			else assert.equal(r, null);
		});
});

describe("explainers", () => {
	const ectx = { ...ctx, questions: new Set(["q1"]) };
	const cases: Array<[string, Partial<Explainer>, RegExp | null]> = [
		["a good explainer", {}, null],
		["over 120 words", { body: "word ".repeat(121) }, /keep it to 120/],
		["a diagram inside the body", { body: "See:\n```mermaid\ngraph TD\n```" }, /not in the body/],
		["no diagram", { diagram: "" }, /exactly one mermaid diagram/],
		["not a mermaid diagram", { diagram: "pie title x" }, /exactly one mermaid diagram/],
		["a mindmap is fine", { diagram: "mindmap\n  root((Nash))" }, null],
		["a Try it question not in the bank", { tryQuestionId: "q9" }, /isn't in the question bank/],
		["a citation that doesn't exist", { slides: [12] }, /slide 12/],
		["terms missing", { terms: undefined as never }, /list the terms/],
	];
	for (const [name, over, problem] of cases)
		it(name, () => {
			const r = checkExplainer(e(over), ectx);
			if (problem) assert.match(r ?? "", problem);
			else assert.equal(r, null);
		});
});

describe("the concept map", () => {
	const node = (id: string, slides = [1]) => ({ id, title: id, slides });
	const cases: Array<[string, Parameters<typeof checkMapNodes>[0], RegExp | null]> = [
		["two linked ideas", [node("best-response"), node("nash", [3])], null],
		["one idea is not a map", [node("a")], /at least 2/],
		["an id that isn't a slug", [node("Best Response"), node("nash")], /lowercase slug/],
		["a node without a slide", [node("a", []), node("b")], /Slide n/],
		["a node citing a missing slide", [node("a", [7]), node("b")], /slide 7/],
		["too many ideas", Array.from({ length: PACK_RULES.maxNodes + 1 }, (_, i) => node(`n${i}`)), /keep it to/],
	];
	for (const [name, nodes, problem] of cases)
		it(name, () => {
			const r = checkMapNodes(nodes, ctx.slides);
			if (problem) assert.match(r ?? "", problem);
			else assert.equal(r, null);
		});
});

describe("the bank as the scripted engine's set", () => {
	it("is a valid scripted set, easiest first, citing slides, with explainers as worked examples", () => {
		const set = bankToScriptedSet("gt-nash", [q({ id: "q2", difficulty: 3, node: "nash", slides: [3] }), q()], [e()]);
		assert.ok(validateScriptedSet(set).ok, JSON.stringify(validateScriptedSet(set)));
		assert.deepEqual(set.questions.map((x) => x.id), ["q1", "q2"]);
		assert.deepEqual(set.questions[0]!.correct, [0]);
		assert.match(set.questions[0]!.explanation, /\(Slide 2\)$/);
		assert.equal(set.questions[1]!.workedExample, e().body);
	});
});

describe("explainers never show internal question ids (dry run)", () => {
	const ids = ["gt-w2-nash-q5", "gt-w2-nash-q12"];
	it("drops a sentence naming a question id, and keeps the rest", () => {
		assert.equal(stripQuestionIds("A Nash equilibrium is stable. Try question gt-w2-nash-q5.", ids), "A Nash equilibrium is stable.");
		assert.equal(stripQuestionIds("First idea. Then try gt-w2-nash-q12 to check! Last idea.", ids), "First idea. Last idea.");
		assert.equal(stripQuestionIds("Line one.\nSee gt-w2-nash-q5\nLine three.", ids), "Line one.\n\nLine three.");
	});
	it("leaves text without ids alone, and q1 doesn't eat q12", () => {
		assert.equal(stripQuestionIds("Nothing to strip here (Slide 3).", ids), "Nothing to strip here (Slide 3).");
		assert.equal(stripQuestionIds("Keep this. Try gt-w2-nash-q12.", ["gt-w2-nash-q1"]), "Keep this. Try gt-w2-nash-q12.");
	});
});
