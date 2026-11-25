/**
 * Server-side twin of the question dock's QuestionData assembly
 * (components/question-dock.tsx, the `qd` memo), so our session screen
 * shows LearnHarness's questions in exactly the order LearnHarness records:
 * normalizeOptions → shuffleOptions(seededRandom(toolCallId)) → resolveCorrect.
 *
 * tests/companion-question.test.ts pins the parity. If the dock's assembly
 * changes upstream, that test is the tripwire.
 */

import { toolQuestionKind } from "../pending.ts";
import {
	buildAnswer,
	normalizeOptions,
	normalizeQuizType,
	resolveCorrect,
	seededRandom,
	shuffleOptions,
	type AnswerRequest,
	type AskToolInput,
	type ExplainToolInput,
	type QuestionAnswerData,
	type QuestionData,
	type QuestionMode,
	type QuizToolInput,
} from "../question-core.ts";
import { SHOW_ME_THINKING } from "./policy.ts";
import type { AnswerInput, AnswerRecord, SessionQuestion } from "./types.ts";

export class AnswerInputError extends Error {}

export function questionDataFromCall(toolCallId: string, toolName: string, rawInput: unknown): QuestionData {
	const kind = toolQuestionKind(toolName);
	const input = (rawInput ?? {}) as { question?: string; details?: string; multiSelect?: boolean; type?: unknown };
	const quizInput = kind === "quiz" ? (rawInput as QuizToolInput) : null;
	const askInput = kind === "ask" ? (rawInput as AskToolInput) : null;
	const explainInput = kind === "explain" ? (rawInput as ExplainToolInput) : null;
	const multi = input.multiSelect === true;
	const mode: QuestionMode =
		kind === "quiz" ? (multi ? "multi-select" : "single-select") : askInput?.options?.length ? (multi ? "multi-select" : "single-select") : "text";
	const options = normalizeOptions((quizInput?.options ?? askInput?.options ?? []) as { label: string; value?: string }[]);
	const ordered = kind === "quiz" && options.length > 0 ? shuffleOptions(options, seededRandom(toolCallId)) : options;
	const qd: QuestionData = {
		id: toolCallId,
		kind,
		questionType: kind === "quiz" ? normalizeQuizType(input.type) : undefined,
		question: input.question ?? "",
		context: input.details,
		mode,
		options: ordered,
		createdAt: new Date().toISOString(),
	};
	if (quizInput) {
		qd.correctIndices = resolveCorrect(quizInput.correctAnswer, ordered).indices;
		qd.explanation = quizInput.explanation;
	}
	if (explainInput) qd.committedAnswer = explainInput.correctAnswer;
	return qd;
}

/**
 * A "have a guess" (V-47): the tutor's opening questions and its predictions.
 * A guess is never marked wrong, never makes a gap and never closes one.
 */
export function isGuess(toolName: string | undefined, questionType: string | undefined): boolean {
	return toolName === "probe" || toolName === "recall" || questionType === "predict";
}

/** The browser-safe question: never the correct answer or the explanation. */
export function toSessionQuestion(qd: QuestionData, toolName?: string): SessionQuestion {
	// Answered in the student's own words: a free-recall question, or one with no options to pick from.
	const write = qd.mode === "text";
	const guess = isGuess(toolName, qd.questionType);
	return {
		id: qd.id,
		kind: write ? "write" : qd.kind === "ask" ? "ask" : "quiz",
		stem: qd.question,
		...(qd.context ? { context: qd.context } : {}),
		options: qd.options.map((o, i) => ({ index: i + 1, label: o.label })),
		multi: qd.mode === "multi-select",
		role: qd.questionType === "predict" ? "predict" : "check",
		...(guess ? { guess: true } : {}),
		...(qd.kind === "ask" && !write ? { other: true } : {}),
	};
}

/** Turn the screen's answer into LearnHarness's AnswerRequest. */
export function answerRequestFor(qd: QuestionData, a: AnswerInput): AnswerRequest {
	if (a.dontKnow) return { dontKnow: true, thinking: a.why };
	const typed = a.text?.trim();
	// In the student's own words. The tutor reads it; nothing is marked here.
	if (qd.mode === "text") {
		if (!typed) throw new AnswerInputError("write your answer first");
		return { text: typed };
	}
	const indices = [...new Set(a.indices ?? [])];
	// "Something else" on a choice with no right answer.
	if (indices.length === 0 && qd.kind === "ask" && typed) return { other: typed };
	if (indices.length === 0) throw new AnswerInputError("select an option or choose \"I don't know\"");
	if (qd.mode === "single-select" && indices.length > 1) throw new AnswerInputError("this question takes one answer");
	const values = indices.map((i) => {
		const opt = qd.options[i - 1];
		if (!Number.isInteger(i) || !opt) throw new AnswerInputError(`option ${i} does not exist`);
		return opt.value;
	});
	return {
		values,
		thinking: a.why,
		...(qd.kind === "ask" && typed ? { other: typed } : {}),
		...(qd.kind === "quiz" && a.confidence !== undefined ? { confidence: a.confidence } : {}),
	};
}

/** Grade with LearnHarness's own buildAnswer. */
export function gradeAnswer(qd: QuestionData, a: AnswerInput, toolName: string): QuestionAnswerData {
	return buildAnswer(qd, answerRequestFor(qd, a), toolName);
}

export function isShowMeAnswer(ad: Pick<QuestionAnswerData, "dontKnow" | "thinking">): boolean {
	return ad.dontKnow && (ad.thinking ?? "").trim() === SHOW_ME_THINKING;
}

/** Normalise a LearnHarness answer record for the miss and event logs. */
export function answerRecordFrom(ad: QuestionAnswerData, questionId: string, nodeId?: string): AnswerRecord {
	const correctSet = new Set(ad.correctIndices ?? []);
	const shown = isShowMeAnswer(ad);
	const guess = isGuess(ad.tool, ad.questionType);
	const written = ad.text ?? ad.other;
	return {
		questionId,
		questionText: ad.questionText,
		...(nodeId ? { nodeId } : {}),
		// A guess is not marked (V-47): it stays out of the gap list, the score and the question count.
		graded: ad.kind === "quiz" && !guess,
		...(guess ? { guess: true } : {}),
		...(written ? { written } : {}),
		correct: ad.correct === true,
		dontKnow: ad.dontKnow,
		...(ad.confidence !== undefined ? { confidence: ad.confidence } : {}),
		shown,
		correctLabels: (ad.options ?? []).filter((o) => correctSet.has(o.index)).map((o) => o.label),
		...(ad.kind === "quiz" && !ad.dontKnow && ad.answers.length ? { chosen: ad.answers.map((a) => a.label) } : {}),
		...(ad.explanation ? { explanation: ad.explanation } : {}),
		...(ad.thinking && !shown ? { why: ad.thinking } : {}),
		answeredAt: ad.answeredAt,
	};
}
