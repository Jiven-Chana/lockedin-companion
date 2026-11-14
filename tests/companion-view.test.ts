/**
 * LearnHarness record → SessionView (plan §6.4, §12.1). Synthetic records
 * built with LearnHarness's own constructors. At the checkpoint, add a real
 * recorded companion chat as a fixture here too.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	DEFAULT_PREFS,
	SHOW_ME_THINKING,
	answerRecordsOf,
	gradeAnswer,
	mapChatToView,
	questionDataFromCall,
	specFor,
	type CompanionSession,
} from "../src/core/companion/index.ts";
import type { LhMessage } from "../src/core/native-messages.ts";
import { answerResult, assistant, newUserMessage, probeDone, quizCall, text } from "./helpers/companion-lh.ts";

const lecture = { id: "hci-w3-personas", title: "Personas and scenarios", module: "HCI" };
const session = (over: Partial<CompanionSession> = {}): CompanionSession => ({
	id: "s1", engine: "learnharness", chatId: "c1", spec: specFor("post-lecture", lecture.id, DEFAULT_PREFS),
	budget: 5, answered: 0, createdAt: new Date().toISOString(), state: "ready", ...over,
});
const view = (messages: LhMessage[], running = false, over: Partial<CompanionSession> = {}, failure?: string) =>
	mapChatToView({ messages, running, session: session(over), lecture, ...(failure ? { failure } : {}) });

function answer(callId: string, pick: "right" | "wrong" | "dk" | "show", confidence = 70) {
	const call = quizCall(callId) as { arguments: unknown };
	const qd = questionDataFromCall(callId, "quiz", call.arguments);
	const idx = qd.options.findIndex((o) => o.value === (pick === "right" ? "right" : "a")) + 1;
	const ad =
		pick === "dk" ? gradeAnswer(qd, { questionId: callId, dontKnow: true }, "quiz")
		: pick === "show" ? gradeAnswer(qd, { questionId: callId, dontKnow: true, why: SHOW_ME_THINKING }, "quiz")
		: gradeAnswer(qd, { questionId: callId, indices: [idx], confidence }, "quiz");
	return answerResult(callId, ad);
}

const opening = newUserMessage("APP SESSION\nKind: post-lecture");
const q1 = assistant([text("Start with what a persona is for (Slide 4)."), quizCall("call_1")]);

describe("mapChatToView", () => {
	it("preparing while the first turn runs, with progress text instead of a spinner", () => {
		const v = view([opening], true, { state: "preparing" });
		assert.equal(v.status, "preparing");
		assert.equal(v.activity, "Reading your HCI slides → writing question 1");
		assert.equal(v.goal, "5 questions on Personas and scenarios, about 10 minutes");
	});

	it("stays preparing through the prober → teacher handoff gap", () => {
		assert.equal(view([opening, ...probeDone("c1")], false, { state: "preparing" }).status, "preparing");
	});

	it("shows question 1 with its lead-in, hides plan/probe chatter, never the answer", () => {
		const v = view([opening, ...probeDone("c1"), q1]);
		assert.equal(v.status, "question");
		assert.equal(v.question?.id, "call_1");
		assert.equal(v.question?.stem, "Question call_1?");
		assert.equal(v.question?.options.length, 3);
		assert.match(v.prose ?? "", /Start with what a persona is for \(Slide 4\)\./);
		assert.doesNotMatch(v.prose ?? "", /probe_done/);
		assert.deepEqual(v.slideRefs, [4]);
		assert.equal(v.canHint, true);
		const json = JSON.stringify(v);
		assert.doesNotMatch(json, /correctAnswer|"right"|Because/);
	});

	it("thinking after an answer, with feedback for the answered question", () => {
		const v = view([opening, q1, answer("call_1", "wrong")], true);
		assert.equal(v.status, "thinking");
		assert.equal(v.activity, "Writing question 2…");
		assert.equal(v.answered, 1);
		assert.equal(v.feedback?.questionId, "call_1");
		assert.equal(v.feedback?.correct, false);
		assert.deepEqual(v.feedback?.correctLabels, ["Right"]);
		assert.deepEqual(v.feedback?.slideRefs, [4]);
	});

	it("prose is only the teacher's text since the last answer", () => {
		const q2 = assistant([text("Right idea. Now scenarios (Slide 8)."), quizCall("call_2")]);
		const v = view([opening, q1, answer("call_1", "right"), q2]);
		assert.equal(v.question?.id, "call_2");
		assert.equal(v.prose, "Right idea. Now scenarios (Slide 8).");
		assert.deepEqual(v.slideRefs, [4, 8]);
	});

	it("the screen enforces the budget even if the teacher asks another question", () => {
		const q2 = assistant([text("One more."), quizCall("call_2")]);
		const v = view([opening, q1, answer("call_1", "right"), q2], false, { budget: 1 });
		assert.equal(v.status, "done");
		assert.equal(v.question, undefined);
	});

	it("\"show me first\" does not count toward the budget", () => {
		const q1b = assistant([text("Here is a worked example (Slide 4). Now:"), quizCall("call_2")]);
		const v = view([opening, q1, answer("call_1", "show"), q1b]);
		assert.equal(v.answered, 0);
		assert.equal(v.status, "question");
		assert.equal(v.feedback?.shown, true);
	});

	it("done early when the teacher stops before the budget", () => {
		const wrap = assistant([text("Good work today.")]);
		const v = view([opening, q1, answer("call_1", "right"), wrap]);
		assert.equal(v.status, "done");
		assert.equal(v.endedEarly, true);
	});

	it("errors on a failed turn and on question tools our screen cannot render", () => {
		assert.equal(view([opening, q1], false, {}, "provider exploded").status, "error");
		const explain = assistant([text("Explain:"), { ...quizCall("call_x"), name: "explain", arguments: { type: "check", nodeId: "n", question: "Why?", correctAnswer: "Because." } } as never]);
		const v = view([opening, explain]);
		assert.equal(v.status, "error");
		assert.equal(v.error, "unsupported_question:explain");
	});

	it("answer records carry the plan node and the learner's why", () => {
		const records = answerRecordsOf([opening, q1, answer("call_1", "right", 30)]);
		assert.equal(records.length, 1);
		assert.equal(records[0]?.nodeId, "persona-purpose");
		assert.equal(records[0]?.confidence, 30);
		assert.equal(records[0]?.correct, true);
	});
});
