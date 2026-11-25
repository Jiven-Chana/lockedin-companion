/**
 * The scripted session engine's logic (plan §6.9), pure. The same session
 * screen, driven by authored questions from
 * companion/content/<lectureId>/questions.json instead of LearnHarness.
 *
 * Grading reuses LearnHarness's own helpers (normalizeOptions, the seeded
 * shuffle, resolveCorrect, buildAnswer) so both engines produce identical
 * answer records and miss-log behaviour.
 */

import {
	buildAnswer,
	normalizeOptions,
	resolveCorrect,
	seededRandom,
	shuffleOptions,
	type QuestionData,
} from "../question-core.ts";
import { goalFor } from "./nudges.ts";
import { answerRecordFrom, answerRequestFor, toSessionQuestion } from "./question-data.ts";
import { parseSlideRefs } from "./slides.ts";
import type {
	AnswerInput,
	AnswerRecord,
	CompanionSession,
	Lecture,
	Miss,
	ScriptedQuestion,
	ScriptedSet,
	ScriptedState,
	SessionSpec,
	SessionView,
} from "./types.ts";

export class ScriptedConflictError extends Error {}

export function validateScriptedSet(raw: unknown): { ok: true; set: ScriptedSet } | { ok: false; errors: string[] } {
	const errors: string[] = [];
	const s = raw as Partial<ScriptedSet> | null;
	if (!s || typeof s !== "object") return { ok: false, errors: ["not an object"] };
	if (typeof s.lectureId !== "string" || !s.lectureId) errors.push("lectureId is required");
	if (!Array.isArray(s.questions) || s.questions.length === 0) errors.push("questions must be a non-empty array");
	const ids = new Set<string>();
	(s.questions ?? []).forEach((q: Partial<ScriptedQuestion>, i) => {
		const where = `questions[${i}]${q?.id ? ` (${q.id})` : ""}`;
		if (typeof q?.id !== "string" || !q.id) errors.push(`${where}: id is required`);
		else if (ids.has(q.id)) errors.push(`${where}: duplicate id`);
		else ids.add(q.id);
		if (typeof q?.stem !== "string" || !q.stem.trim()) errors.push(`${where}: stem is required`);
		if (!Array.isArray(q?.options) || q.options.length < 2 || q.options.some((o) => typeof o !== "string" || !o.trim()))
			errors.push(`${where}: at least 2 non-empty options`);
		else if (new Set(q.options.map((o) => o.trim())).size !== q.options.length) errors.push(`${where}: duplicate options`);
		if (!Array.isArray(q?.correct) || q.correct.length === 0 || q.correct.some((c) => !Number.isInteger(c) || c < 0 || c >= (q.options?.length ?? 0)))
			errors.push(`${where}: correct must list valid 0-based option indices`);
		if (typeof q?.explanation !== "string" || !q.explanation.trim()) errors.push(`${where}: explanation is required`);
		if (typeof q?.nodeId !== "string" || !q.nodeId) errors.push(`${where}: nodeId is required`);
	});
	return errors.length > 0 ? { ok: false, errors } : { ok: true, set: s as ScriptedSet };
}

const byId = (set: ScriptedSet, id: string) => set.questions.find((q) => q.id === id);

/** Pick the questions for a session. Retests ask a sibling of each missed
 *  question (same nodeId, different wording) where one exists. */
export function initialScriptedState(set: ScriptedSet, spec: SessionSpec, misses: Miss[] = []): ScriptedState {
	const budget = spec.budget.questions;
	const queue: string[] = [];
	const used = new Set<string>();
	const add = (q: ScriptedQuestion | undefined) => {
		if (q && !used.has(q.id)) {
			queue.push(q.id);
			used.add(q.id);
			return true;
		}
		return false;
	};
	if (spec.kind === "retest" && misses.length > 0) {
		for (let round = 0; queue.length < budget && round < budget; round++) {
			let progressed = false;
			for (const m of misses) {
				if (queue.length >= budget) break;
				const sibling = set.questions.find((q) => q.nodeId === m.nodeId && q.id !== m.questionId && !used.has(q.id));
				progressed = add(sibling ?? (round === 0 ? byId(set, m.questionId) : undefined)) || progressed;
			}
			if (!progressed) break;
		}
	}
	// Hand-off (F-112): the phone's question is question 1, already answered; continue at question 2.
	const seed = spec.seedAnswer ? byId(set, spec.seedAnswer.questionId) : undefined;
	if (seed) add(seed);
	// A study block's first step (V-44) is its first question.
	const first = spec.firstQuestionId ? byId(set, spec.firstQuestionId) : undefined;
	if (first && queue.length < budget) add(first);
	for (const q of set.questions.filter((q) => !q.retestOnly)) if (queue.length < budget) add(q);
	for (const q of set.questions) if (queue.length < budget) add(q);
	if (seed && spec.seedAnswer) {
		const a = spec.seedAnswer;
		const answer: AnswerRecord = {
			questionId: seed.id, questionText: seed.stem, nodeId: seed.nodeId, graded: true, correct: a.correct, dontKnow: false, shown: false,
			correctLabels: seed.correct.map((i) => seed.options[i]!).filter(Boolean), explanation: seed.explanation, answeredAt: a.at,
		};
		return { queue, position: 1, answers: [answer], examplesShown: [], hinted: [] };
	}
	return { queue, position: 0, answers: [], examplesShown: [], hinted: [] };
}

/** The question as LearnHarness would hold it: option values are the authored indices. */
export function scriptedQuestionData(sessionId: string, q: ScriptedQuestion): QuestionData {
	const options = normalizeOptions(q.options.map((label, i) => ({ label, value: String(i) })));
	const ordered = shuffleOptions(options, seededRandom(`${sessionId}:${q.id}`));
	return {
		id: q.id,
		kind: "quiz",
		questionType: "check",
		question: q.stem,
		mode: q.correct.length > 1 ? "multi-select" : "single-select",
		options: ordered,
		correctIndices: resolveCorrect(q.correct.map(String), ordered).indices,
		explanation: q.explanation,
		createdAt: new Date(0).toISOString(),
	};
}

function counted(state: ScriptedState): number {
	return state.answers.filter((a) => a.graded && !a.shown).length;
}

function currentQuestion(set: ScriptedSet, state: ScriptedState): ScriptedQuestion | undefined {
	const id = state.queue[state.position];
	return id ? byId(set, id) : undefined;
}

function workedExampleFor(set: ScriptedSet, q: ScriptedQuestion): string | undefined {
	const authored = q.workedExample ?? set.questions.find((x) => x.nodeId === q.nodeId && x.workedExample)?.workedExample;
	if (authored) return authored;
	// No authored example: point at the slide the explanation cites, never at the answer.
	const slides = parseSlideRefs(`${q.leadIn ?? ""} ${q.explanation}`);
	return slides.length > 0 ? `Have a look at Slide ${slides.join(", ")} first, then try the question.` : undefined;
}

const withSlides = <T extends object>(question: T, slides: number[]): T & { slides?: number[] } => (slides.length ? { ...question, slides } : question);

export function scriptedView(set: ScriptedSet, state: ScriptedState, session: CompanionSession, lecture: Pick<Lecture, "id" | "title" | "module">): SessionView {
	const answered = counted(state);
	const last = [...state.answers].reverse().find((a) => a.graded && !a.shown);
	const feedback = last
		? {
				questionId: last.questionId,
				correct: last.correct,
				dontKnow: last.dontKnow,
				shown: false,
				correctLabels: last.correctLabels,
				...(last.explanation ? { explanation: last.explanation } : {}),
				slideRefs: parseSlideRefs(last.explanation),
			}
		: undefined;
	const q = currentQuestion(set, state);
	const done = answered >= session.budget || !q;
	const base: SessionView = {
		id: session.id,
		engine: "scripted",
		kind: session.spec.kind,
		mode: session.spec.mode,
		lecture: { id: lecture.id, title: lecture.title, module: lecture.module },
		goal: set.goal && session.spec.kind !== "retest" && session.budget === session.spec.budget.questions ? set.goal : goalFor(session.spec, lecture, session.budget),
		status: done ? "done" : "question",
		answered,
		budget: session.budget,
		...(feedback ? { feedback } : {}),
		canHint: false,
		slideRefs: [],
	};
	if (session.state === "error") return { ...base, status: "error", error: session.error ?? "engine_error" };
	if (done || !q) return { ...base, status: "done", ...(answered < session.budget ? { endedEarly: true } : {}), slideRefs: feedback?.slideRefs ?? [] };
	const example = session.spec.mode === "show-first" || state.examplesShown.includes(q.id) ? workedExampleFor(set, q) : undefined;
	const prose = [example, q.leadIn].filter(Boolean).join("\n\n") || undefined;
	const qd = scriptedQuestionData(session.id, q);
	return {
		...base,
		...(prose ? { prose } : {}),
		// The question's own slide (lo-fi: "the slide this question comes from"): the bank's, else the one its lead-in cites.
		question: { ...withSlides(toSessionQuestion(qd), q.slides?.length ? q.slides : parseSlideRefs(q.leadIn ?? "")), ...(q.lectureId ? { lectureId: q.lectureId } : {}), ...(q.ai ? { ai: true } : {}) },
		canHint: !!q.hint,
		slideRefs: [...new Set([...parseSlideRefs(prose), ...(feedback?.slideRefs ?? [])])].sort((a, b) => a - b),
	};
}

function requireCurrent(set: ScriptedSet, state: ScriptedState, questionId: string): ScriptedQuestion {
	const q = currentQuestion(set, state);
	if (!q || q.id !== questionId) throw new ScriptedConflictError("question_not_pending");
	return q;
}

export function scriptedAnswer(
	set: ScriptedSet,
	state: ScriptedState,
	session: CompanionSession,
	a: AnswerInput,
	now: Date,
): { state: ScriptedState; record: AnswerRecord } {
	if (counted(state) >= session.budget) throw new ScriptedConflictError("session_done");
	const q = requireCurrent(set, state, a.questionId);
	const qd = scriptedQuestionData(session.id, q);
	const answer = buildAnswer(qd, answerRequestFor(qd, a), "quiz");
	answer.answeredAt = now.toISOString();
	const record = { ...answerRecordFrom(answer, q.id, q.nodeId), ...(q.lectureId ? { lectureId: q.lectureId } : {}) };
	return { state: { ...state, answers: [...state.answers, record], position: state.position + 1 }, record };
}

/** "Show me first": reveal the worked example for the current question; the question stays. */
export function scriptedShowMe(set: ScriptedSet, state: ScriptedState, questionId: string): ScriptedState {
	const q = requireCurrent(set, state, questionId);
	return state.examplesShown.includes(q.id) ? state : { ...state, examplesShown: [...state.examplesShown, q.id] };
}

export function scriptedHint(set: ScriptedSet, state: ScriptedState, questionId: string): { state: ScriptedState; text: string } {
	const q = requireCurrent(set, state, questionId);
	if (!q.hint) throw new ScriptedConflictError("no_hint");
	return { state: state.hinted.includes(q.id) ? state : { ...state, hinted: [...state.hinted, q.id] }, text: q.hint };
}

/** "Keep going": queue up to n more unused questions. */
export function scriptedMore(set: ScriptedSet, state: ScriptedState, n: number): ScriptedState {
	const used = new Set(state.queue);
	const extra = [...set.questions.filter((q) => !q.retestOnly), ...set.questions].filter((q) => !used.has(q.id) && used.add(q.id)).slice(0, n).map((q) => q.id);
	return { ...state, queue: [...state.queue, ...extra] };
}
