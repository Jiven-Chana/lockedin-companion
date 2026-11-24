/**
 * LearnHarness chat record → SessionView (plan §6.4). Pure: the engine
 * passes in the record's messages plus liveness, and gets the screen state.
 *
 * Hidden on purpose: plan_init, probe_done, tool chatter, handoff markers.
 * Never exposed before an answer: correctAnswer and explanation.
 */

import { failedOutputCallIds, pendingQuestionOf, userFacingTextOf, type LhMessage } from "../native-messages.ts";
import type { QuestionAnswerData } from "../question-core.ts";
import { sideSegmentId } from "../side-chat.ts";
import { goalFor } from "./nudges.ts";
import { SESSION_COPY } from "./policy.ts";
import { answerRecordFrom, questionDataFromCall, toSessionQuestion } from "./question-data.ts";
import { parseSlideRefs } from "./slides.ts";
import type { AnswerRecord, CompanionSession, Lecture, SessionFeedback, SessionView } from "./types.ts";

/** Question tools our screen can render. probe/explain/recall are switched
 *  off by the seed config and the prompt overrides. */
export const SUPPORTED_QUESTION_TOOLS = ["quiz", "ask_user_question"] as const;

function callInputs(messages: readonly LhMessage[]): Map<string, unknown> {
	const out = new Map<string, unknown>();
	for (const m of messages) {
		if (m.role !== "assistant") continue;
		for (const block of m.content) if (block.type === "toolCall") out.set(block.id, block.arguments);
	}
	return out;
}

function answerDetails(m: LhMessage): QuestionAnswerData | null {
	if (m.role !== "toolResult" || m.isError) return null;
	const d = m.details as QuestionAnswerData | null | undefined;
	if (!d || typeof d !== "object" || d.dismissed || typeof d.kind !== "string") return null;
	return d;
}

/** Every answered quiz / ask in the record, oldest first, normalised. */
export function answerRecordsOf(messages: readonly LhMessage[]): AnswerRecord[] {
	const inputs = callInputs(messages);
	const out: AnswerRecord[] = [];
	for (const m of messages) {
		if (m.role !== "toolResult" || !(SUPPORTED_QUESTION_TOOLS as readonly string[]).includes(m.toolName)) continue;
		const d = answerDetails(m);
		if (!d) continue;
		const nodeId = (inputs.get(m.toolCallId) as { nodeId?: unknown } | undefined)?.nodeId;
		out.push(answerRecordFrom(d, m.toolCallId, typeof nodeId === "string" ? nodeId : undefined));
	}
	return out;
}

/** Graded answers that count toward the budget ("show me first" does not). */
export function countedAnswers(records: readonly AnswerRecord[]): number {
	return records.filter((r) => r.graded && !r.shown).length;
}

export interface LhViewInput {
	messages: readonly LhMessage[];
	running: boolean;
	failure?: string;
	session: CompanionSession;
	lecture: Pick<Lecture, "id" | "title" | "module">;
}

export function mapChatToView(input: LhViewInput): SessionView {
	const { messages, running, session, lecture } = input;
	const failed = failedOutputCallIds(messages);
	const records = answerRecordsOf(messages);
	const answered = countedAnswers(records);
	const budget = session.budget;

	// Prose: teacher text since the last answered question.
	let lastAnswerIdx = -1;
	messages.forEach((m, i) => {
		if (m.role === "toolResult" && (SUPPORTED_QUESTION_TOOLS as readonly string[]).includes(m.toolName) && answerDetails(m)) lastAnswerIdx = i;
	});
	const proseParts: string[] = [];
	for (const m of messages.slice(lastAnswerIdx + 1)) {
		if (m.role !== "assistant") continue;
		proseParts.push(...userFacingTextOf(m.content, failed).map((t) => t.trim()).filter(Boolean));
	}
	const prose = proseParts.join("\n\n") || undefined;

	// Feedback: the newest graded result.
	const last = [...records].reverse().find((r) => r.graded);
	const feedback: SessionFeedback | undefined = last
		? {
				questionId: last.questionId,
				correct: last.correct,
				dontKnow: last.dontKnow,
				shown: last.shown,
				correctLabels: last.correctLabels,
				...(last.explanation ? { explanation: last.explanation } : {}),
				slideRefs: parseSlideRefs(last.explanation),
			}
		: undefined;

	const pending = pendingQuestionOf(messages as LhMessage[]);
	const supported = pending && (SUPPORTED_QUESTION_TOOLS as readonly string[]).includes(pending.tool);
	const hasAssistant = messages.some((m) => m.role === "assistant");

	const base: SessionView = {
		id: session.id,
		engine: "learnharness",
		kind: session.spec.kind,
		mode: session.spec.mode,
		lecture: { id: lecture.id, title: lecture.title, module: lecture.module },
		goal: goalFor(session.spec, lecture, budget),
		status: "preparing",
		answered,
		budget,
		...(prose ? { prose } : {}),
		...(feedback ? { feedback } : {}),
		canHint: false,
		slideRefs: [...new Set([...parseSlideRefs(prose), ...(feedback?.slideRefs ?? [])])].sort((a, b) => a - b),
	};

	if (input.failure || session.state === "error") {
		return { ...base, status: "error", error: session.error ?? input.failure ?? "engine_error" };
	}
	if (answered >= budget) {
		// The screen enforces the budget itself (§13): only "Keep going" continues.
		return running ? { ...base, status: "thinking", activity: "Wrapping up…" } : { ...base, status: "done" };
	}
	if (pending && supported) {
		const qd = questionDataFromCall(pending.toolCallId, pending.tool, pending.input);
		const canHint = qd.kind === "quiz" && !!prose && sideSegmentId(messages as LhMessage[], pending.messageId) !== null;
		return { ...base, status: "question", question: toSessionQuestion(qd), canHint };
	}
	if (pending && !supported) return { ...base, status: "error", error: `unsupported_question:${pending.tool}` };
	if (running) {
		return records.length === 0
			? { ...base, status: "preparing", activity: SESSION_COPY.reading(lecture.module) }
			: { ...base, status: "thinking", activity: SESSION_COPY.writing(answered + 1) };
	}
	// Between the prober's turn and the teacher's (the probe-handoff wake),
	// nothing runs for a moment: a session still preparing is still preparing.
	if (session.state === "preparing") {
		return { ...base, status: "preparing", activity: SESSION_COPY.reading(lecture.module) };
	}
	if (!hasAssistant) return { ...base, status: "error", error: "no_question" };
	return { ...base, status: "done", endedEarly: true };
}

/**
 * Which question the student is on, for "Question 2 of 5" and the dots
 * (lo-fi task 1). It counts the question in front of them, not the ones
 * behind: question 1 reads 1 of 5. While the feedback for the answer just
 * given is still on screen, it stays on that question.
 */
export function questionNumber(input: { answered: number; budget: number; done: boolean; reviewing: boolean }): { current: number; total: number; dots: ("done" | "current" | "todo")[] } {
	const total = Math.max(1, input.budget);
	const current = Math.min(total, Math.max(1, input.done || input.reviewing ? input.answered : input.answered + 1));
	const finished = input.done ? total : input.reviewing ? current : current - 1;
	return { current, total, dots: Array.from({ length: total }, (_, i) => (i < finished ? "done" : i === current - 1 && !input.done ? "current" : "todo")) };
}

