/**
 * Question data and grading (plan §6.4, §12.1): our server-side twin of the
 * question dock's assembly must give the same option order and correct
 * indices as LearnHarness for the same toolCallId, and grade through
 * LearnHarness's own buildAnswer.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import {
	answerRequestFor,
	gradeAnswer,
	isShowMeAnswer,
	questionDataFromCall,
	scriptedQuestionData,
	SHOW_ME_THINKING,
	toSessionQuestion,
	answerRecordFrom,
} from "../src/core/companion/index.ts";
import { normalizeOptions, resolveCorrect, seededRandom, shuffleOptions } from "../src/core/question-core.ts";

const QUIZ = {
	type: "check",
	nodeId: "persona-purpose",
	question: "Which is the main purpose of a persona?",
	options: [{ label: "Focus decisions on users' goals", value: "focus" }, { label: "Record averages", value: "avg" }, { label: "Replace research", value: "replace" }, { label: "Describe one person", value: "one" }],
	explanation: "Personas keep goals in view (Slide 4).",
	correctAnswer: "focus",
};

/** The dock's assembly, transcribed from components/question-dock.tsx (the `qd` memo). */
function dockOrder(toolCallId: string, input: typeof QUIZ) {
	const options = normalizeOptions(input.options);
	const ordered = shuffleOptions(options, seededRandom(toolCallId));
	return { ordered, correct: resolveCorrect(input.correctAnswer, ordered).indices };
}

describe("questionDataFromCall", () => {
	it("matches the dock's seeded shuffle and correct indices for many call ids", () => {
		for (let i = 0; i < 50; i++) {
			const id = `toolu_${i.toString(36)}abc${i * 7}`;
			const qd = questionDataFromCall(id, "quiz", QUIZ);
			const dock = dockOrder(id, QUIZ);
			assert.deepEqual(qd.options, dock.ordered);
			assert.deepEqual(qd.correctIndices, dock.correct);
		}
	});

	it("the dock still assembles questions this way (tripwire for upstream changes)", () => {
		const src = fs.readFileSync(new URL("../components/question-dock.tsx", import.meta.url), "utf-8");
		assert.match(src, /shuffleOptions\(options, seededRandom\(toolCallId\)\)/);
		assert.match(src, /resolveCorrect\(quizInput\.correctAnswer, ordered\)/);
	});

	it("the browser view never carries the answer or the explanation", () => {
		const view = toSessionQuestion(questionDataFromCall("c1", "quiz", QUIZ));
		const json = JSON.stringify(view);
		assert.doesNotMatch(json, /explanation|correct|Slide 4/);
		assert.equal(view.role, "check");
		assert.deepEqual(view.options.map((o) => o.index), [1, 2, 3, 4]);
	});
});

describe("grading through buildAnswer", () => {
	const qd = questionDataFromCall("c1", "quiz", QUIZ);
	const right = qd.correctIndices![0]!;
	const wrong = right === 1 ? 2 : 1;

	it("marks correct and incorrect, with confidence and the why box", () => {
		const ok = gradeAnswer(qd, { questionId: "c1", indices: [right], confidence: 90, why: "goals" }, "quiz");
		assert.equal(ok.correct, true);
		assert.equal(ok.confidence, 90);
		assert.equal(ok.thinking, "goals");
		const bad = gradeAnswer(qd, { questionId: "c1", indices: [wrong], confidence: 30 }, "quiz");
		assert.equal(bad.correct, false);
		const rec = answerRecordFrom(bad, "c1", "persona-purpose");
		assert.deepEqual(rec.correctLabels, ["Focus decisions on users' goals"]);
		assert.equal(rec.nodeId, "persona-purpose");
	});

	it("\"I don't know\" sends no confidence; show-me is recognised", () => {
		const dk = gradeAnswer(qd, { questionId: "c1", dontKnow: true, confidence: 70 }, "quiz");
		assert.equal(dk.correct, false);
		assert.equal(dk.confidence, undefined);
		assert.equal(isShowMeAnswer(dk), false);
		const show = gradeAnswer(qd, { questionId: "c1", dontKnow: true, why: SHOW_ME_THINKING }, "quiz");
		assert.equal(isShowMeAnswer(show), true);
		assert.equal(answerRecordFrom(show, "c1").shown, true);
	});

	it("rejects impossible selections", () => {
		assert.throws(() => answerRequestFor(qd, { questionId: "c1", indices: [9] }), /does not exist/);
		assert.throws(() => answerRequestFor(qd, { questionId: "c1", indices: [1, 2] }), /one answer/);
		assert.throws(() => answerRequestFor(qd, { questionId: "c1" }), /select an option/);
	});
});

describe("scripted questions grade like LearnHarness ones", () => {
	it("shuffles deterministically per session and resolves the authored answer", () => {
		const q = { id: "q1", nodeId: "n", stem: "S?", options: ["A", "B", "C", "D"], correct: [2], explanation: "C (Slide 1)." };
		const a = scriptedQuestionData("s1", q);
		const b = scriptedQuestionData("s1", q);
		assert.deepEqual(a.options, b.options);
		const shownIndex = a.options.findIndex((o) => o.label === "C") + 1;
		assert.deepEqual(a.correctIndices, [shownIndex]);
		assert.equal(gradeAnswer(a, { questionId: "q1", indices: [shownIndex] }, "quiz").correct, true);
	});
});
