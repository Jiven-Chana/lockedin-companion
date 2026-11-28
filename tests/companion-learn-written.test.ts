/**
 * v3.1 Part B: written and worked answers are the main check in Learn.
 * Jiven, 28 Nov: "the form of question being MCQs is not great for the learn
 * session, it should be more organic… give harder Qs."
 *
 * The engine's written check (`explain`) has no right-or-wrong of its own:
 * the tutor commits its answer before asking, then marks the student's in
 * its reply. LockedIn reads that mark from one line the tutor is told to
 * write first, so a written check counts towards Solid and To revisit.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { LEARN_COPY, LEARN_SAYS, learnSteps, tutorOwesNextStep, unmarkedCheck, verdictOf, writtenMarks, type LearnItem } from "../src/core/companion/index.ts";
import { newAnswerResult, newUserMessage, type LhMessage } from "../src/core/native-messages.ts";
import { assistant, text } from "./helpers/companion-lh.ts";

const ROOT = path.join(import.meta.dirname, "..");
const call = (id: string, name: string, args: Record<string, unknown>) => ({ type: "toolCall" as const, id, name, arguments: args });
const explain = (id: string, over: Record<string, unknown> = {}) => call(id, "explain", { type: "check", nodeId: "minimax", question: "Derive the optimal discriminator for a fixed generator.", correctAnswer: "D*(x) = p_data(x) / (p_data(x) + p_g(x)), by maximising the integrand pointwise.", ...over });
const answer = (id: string, over: Record<string, unknown> = {}): LhMessage =>
	newAnswerResult(id, "explain", { kind: "explain", questionText: "Derive the optimal discriminator for a fixed generator.", dontKnow: false, answers: [], text: "Set the derivative of the integrand to zero.", committed: "D*(x) = p_data(x) / (p_data(x) + p_g(x)), by maximising the integrand pointwise.", answeredAt: "2026-11-28T10:00:00.000Z", ...over } as never);
const opening = () => newUserMessage("LEARN SESSION\nModule: NC\n…");

describe("the verdict line", () => {
	const cases: Array<[string, ReturnType<typeof verdictOf>]> = [
		["Verdict: right\nYes: you maximised pointwise.", { verdict: "right", rest: "Yes: you maximised pointwise." }],
		["Verdict: partly\n\nThe method is right; you stopped before solving for D.", { verdict: "partly", rest: "The method is right; you stopped before solving for D." }],
		["verdict: Not yet\nThat is the generator's objective.", { verdict: "notyet", rest: "That is the generator's objective." }],
		["**Verdict: right**\nGood.", { verdict: "right", rest: "Good." }],
		["`Verdict: partly`\nNearly.", { verdict: "partly", rest: "Nearly." }],
		["Good work. Verdict: right", { verdict: null, rest: "Good work. Verdict: right" }],
		["No verdict here.", { verdict: null, rest: "No verdict here." }],
		["Verdict: brilliant\nx", { verdict: null, rest: "Verdict: brilliant\nx" }],
	];
	for (const [said, expected] of cases) it(JSON.stringify(said.slice(0, 28)), () => assert.deepEqual(verdictOf(said), expected));
});

describe("a written check in a step", () => {
	const answeredIn = (messages: LhMessage[]) => learnSteps(messages).at(-1)!.find((i): i is Extract<LearnItem, { type: "answered" }> => i.type === "answered")!;
	const tutorIn = (messages: LhMessage[]) => learnSteps(messages).at(-1)!.filter((i): i is Extract<LearnItem, { type: "tutor" }> => i.type === "tutor").map((i) => i.text);

	it("carries the tutor's mark, and the line itself is never shown", () => {
		const msgs = [opening(), assistant([text("Now you try."), explain("e1")]), answer("e1"), assistant([text("Verdict: partly\nThe method is right; you stopped before solving for D.")], "stop")];
		assert.equal(answeredIn(msgs).verdict, "partly");
		assert.equal(answeredIn(msgs).written, "Set the derivative of the integrand to zero.");
		assert.match(answeredIn(msgs).explanation ?? "", /^D\*\(x\)/, "the answer the tutor committed before asking is shown");
		assert.deepEqual(tutorIn(msgs), ["The method is right; you stopped before solving for D."]);
	});
	it("while the tutor has not replied yet, there is no mark", () => {
		assert.equal(answeredIn([opening(), assistant([text("Try."), explain("e1")]), answer("e1")]).verdict, undefined);
	});
	it("\"I don't know\" is not yet, without waiting for the tutor", () => {
		assert.equal(answeredIn([opening(), assistant([text("Try."), explain("e1")]), answer("e1", { dontKnow: true, text: undefined })]).verdict, "notyet");
	});
	it("a guess before teaching is never marked, whatever the tutor writes", () => {
		const msgs = [opening(), assistant([text("Have a go."), explain("p1", { type: "predict" })]), answer("p1", { questionType: "predict" }), assistant([text("Verdict: right\nLet's see why.")], "stop")];
		assert.equal(answeredIn(msgs).verdict, undefined);
		assert.deepEqual(tutorIn(msgs), ["Let's see why."], "the line is still hidden");
	});
	it("a reply with no verdict line leaves the check unmarked", () => {
		const msgs = [opening(), assistant([text("Try."), explain("e1")]), answer("e1"), assistant([text("Good, and here is the next step.")], "stop")];
		assert.equal(answeredIn(msgs).verdict, undefined);
		assert.deepEqual(tutorIn(msgs), ["Good, and here is the next step."]);
	});
});

describe("the marks for the student's record", () => {
	it("every marked written check in the session, with its idea, the question, what they wrote and the committed answer", () => {
		const msgs = [
			opening(),
			assistant([text("Try."), explain("e1")]), answer("e1"), assistant([text("Verdict: partly\nNearly.")]),
			assistant([text("Again."), explain("e2", { question: "Now solve for D.", nodeId: "m2-minimax" })]), answer("e2", { questionText: "Now solve for D.", text: "D = p/(p+q)" }), assistant([text("Verdict: right\nYes.")], "stop"),
			assistant([text("One more."), explain("e3")]), answer("e3"),
		];
		assert.deepEqual(writtenMarks(msgs), [
			{ questionId: "e1", nodeId: "minimax", questionText: "Derive the optimal discriminator for a fixed generator.", written: "Set the derivative of the integrand to zero.", committed: "D*(x) = p_data(x) / (p_data(x) + p_g(x)), by maximising the integrand pointwise.", verdict: "partly", answeredAt: "2026-11-28T10:00:00.000Z" },
			{ questionId: "e2", nodeId: "m2-minimax", questionText: "Now solve for D.", written: "D = p/(p+q)", committed: "D*(x) = p_data(x) / (p_data(x) + p_g(x)), by maximising the integrand pointwise.", verdict: "right", answeredAt: "2026-11-28T10:00:00.000Z" },
		]);
	});
	it("a guess, a dismissed question and multiple choice are not in it", () => {
		const quiz = call("q1", "quiz", { type: "check", nodeId: "minimax", question: "Pick.", options: [{ label: "A", value: "a" }], correctAnswer: "a" });
		const msgs = [opening(), assistant([text("Guess."), explain("p1", { type: "predict" })]), answer("p1", { questionType: "predict" }), assistant([text("Verdict: right\nOk.")]), assistant([quiz])];
		assert.deepEqual(writtenMarks(msgs), []);
	});
});

describe("the settings and the words", () => {
	it("written checks are switched on in the seed", () => {
		const seed = JSON.parse(fs.readFileSync(path.join(ROOT, "companion", "seed", "settings.json"), "utf-8")) as { agent: { tools: Record<string, boolean> } };
		assert.equal(seed.agent.tools.explain, true);
	});
	it("the tutor is told to write the verdict first and to make checks real work", () => {
		const method = fs.readFileSync(path.join(ROOT, "companion", "seed", "prompts", "teacher", "05-method.md"), "utf-8");
		assert.match(method, /`Verdict: right`\n`Verdict: partly`\n`Verdict: not yet`/);
		assert.match(method, /never mark a wrong answer right/);
		assert.match(method, /ends on a problem they do themselves/);
		assert.match(method, /the next is harder/);
	});
	it("a mark is said without red, and never as a score", () => {
		assert.deepEqual(LEARN_COPY.verdict, { right: "Right", partly: "Partly there", notyet: "Not yet" });
		assert.equal(LEARN_COPY.marking, "Your tutor is reading it…");
	});
});

/**
 * Seen with the real tutor on 28 Nov: its reply to a written answer came back
 * empty. The answer sat unmarked and the student was left with "Carry on".
 */
describe("a reply that never came", () => {
	const empty = () => assistant([text("")], "stop");
	const tree = [opening(), assistant([text("Try."), explain("e1")]), answer("e1")];

	it("an empty reply to an answer means the tutor still owes its turn", () => {
		assert.equal(tutorOwesNextStep([...tree, empty()]), true);
		assert.equal(tutorOwesNextStep(tree), false, "it has not replied at all yet: that is waiting, not a stall");
	});
	it("it is asked once: after LockedIn's own line, nothing more is owed", () => {
		assert.equal(tutorOwesNextStep([...tree, empty(), newUserMessage(LEARN_SAYS.markIt)]), false);
		assert.equal(tutorOwesNextStep([...tree, empty(), newUserMessage(LEARN_SAYS.markIt), empty()]), false);
	});
	it("for a written check it is asked to mark the answer, not just to carry on", () => {
		assert.equal(unmarkedCheck([...tree, empty()]), true);
		assert.equal(unmarkedCheck([...tree, assistant([text("Verdict: right\nYes.")], "stop")]), false);
		assert.equal(unmarkedCheck([...tree, assistant([text("Good, next step.")], "stop")]), true, "a reply with no mark leaves the check unmarked too");
		assert.equal(unmarkedCheck([opening(), assistant([text("Guess."), explain("p1", { type: "predict" })]), answer("p1", { questionType: "predict" }), empty()]), false, "a guess is never marked");
	});
	it("the mark that follows LockedIn's own line is still read, and the line is not shown", () => {
		const msgs = [...tree, empty(), newUserMessage(LEARN_SAYS.markIt), assistant([text("Verdict: partly\nYou gave the method but not the reason.")], "stop")];
		const step = learnSteps(msgs).at(-1)!;
		assert.equal(step[0]!.type === "answered" ? step[0]!.verdict : null, "partly");
		assert.deepEqual(step.filter((i) => i.type === "tutor" || i.type === "you").map((i) => (i.type === "tutor" || i.type === "you" ? i.text : "")), ["You gave the method but not the reason."]);
	});
	it("the tutor is told what that line means", () => {
		const method = fs.readFileSync(path.join(ROOT, "companion", "seed", "prompts", "teacher", "05-method.md"), "utf-8");
		assert.ok(method.includes(`"${LEARN_SAYS.markIt}"`));
	});
});
