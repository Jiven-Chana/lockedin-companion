/**
 * LearnHarnessEngine (plan §6.3–6.7): a companion session is a LearnHarness
 * Teach chat. We create it, send the structured opening message, wait for
 * question 1, map the record to our view, and send graded answers back —
 * all in-process through LearnHarness's own server functions. LearnHarness's
 * code is not modified.
 *
 * Everything LearnHarness-specific goes through LhPort, so the engine is
 * testable with a fake port (tests/companion-lh-engine.test.ts) and the real
 * port (lh-port.ts) stays a thin adapter.
 */

import type { ChatInput } from "../../../core/input-events.ts";
import type { PlanTree } from "../../../core/contracts.ts";
import { hasProbeDone, needsContinuation, pendingQuestionOf, type LhMessage } from "../../../core/native-messages.ts";
import { QUESTION_TOOLS, toolQuestionKind } from "../../../core/pending.ts";
import { dismissedAnswer } from "../../../core/question-core.ts";
import { learnSteps, mapLearnView, tutorOwesNextStep, type LearnMade } from "../../../core/companion/learn.ts";
import { HINT_REQUEST, keepGoingText, LEARN_COPY, LEARN_SAYS, PREPARE_RULES, SESSION_COPY, SHOW_ME_THINKING, TEACHER_RULES } from "../../../core/companion/policy.ts";
import { answerRecordFrom, AnswerInputError, gradeAnswer, questionDataFromCall } from "../../../core/companion/question-data.ts";
import { mapChatToView, SUPPORTED_QUESTION_TOOLS } from "../../../core/companion/view-mapper.ts";
import type { AnswerInput, CompanionSession, Lecture } from "../../../core/companion/types.ts";
import { badRequest, CompanionError, conflict, EngineError } from "../errors.ts";
import type { PrepareContext, SessionEngine, SessionPatch } from "./types.ts";

export interface LhSendResult {
	status: number;
	/** Machine-readable code from LearnHarness's refusal envelope, if any. */
	code?: string;
	error?: string;
}

/** The slice of LearnHarness the engine needs. */
export interface LhPort {
	/** Create a Teach chat stamped with the strong model slot; returns its id. */
	createChat(title: string): string;
	messages(chatId: string): LhMessage[] | null;
	running(chatId: string): boolean;
	failure(chatId: string): string | undefined;
	send(chatId: string, input: ChatInput): Promise<LhSendResult>;
	/** A side question anchored at the given teaching message; resolves to the full answer text. */
	askSide(chatId: string, anchorMessageId: string, text: string): Promise<string>;
	cost(chatId: string): number | null;
	deleteChat(chatId: string): void;
	/** The session plan the teacher wrote (plan_init), or null before there is one. */
	tree(chatId: string): PlanTree | null;
	/** Hand a message to the turn that is running; false when no turn is running to take it. */
	steer(chatId: string, text: string): Promise<boolean>;
	/** Pictures, demos and look-ups that are finished, whether or not the engine has put them in the chat yet. */
	made(chatId: string): LearnMade[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The student's latest typed message in the chat (answers are tool results, not user text). */
function lastUserText(messages: LhMessage[]): string | null {
	const m = [...messages].reverse().find((x) => x.role === "user");
	if (!m) return null;
	const c = (m as { content?: unknown }).content;
	if (typeof c === "string") return c;
	return Array.isArray(c) ? c.map((p: { type?: string; text?: string }) => (p?.type === "text" ? (p.text ?? "") : "")).join("") : null;
}

/**
 * Has the teacher already been asked for a question since the learner last
 * answered? "Once" is once per stop: after a nudge, a new answer earns the
 * teacher one more if it stops again. (Before v1.0 the check was "is the
 * newest typed message the nudge", which stays true for the rest of the
 * session because answers aren't typed messages: one stop used up the only
 * nudge, and the next one ended the session at 2 of 5.)
 */
function askedSinceLastAnswer(messages: readonly LhMessage[]): boolean {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i]!;
		if (m.role === "toolResult" && (SUPPORTED_QUESTION_TOOLS as readonly string[]).includes(m.toolName)) return false;
		if (m.role === "user") return lastUserText(messages.slice(0, i + 1))?.trim() === TEACHER_RULES.continueText;
	}
	return false;
}

/** The probe-handoff marker sits between the prober's turn and the teacher's. */
function teacherSpoke(messages: LhMessage[]): boolean {
	const handoff = messages.findIndex((m) => m.role === "custom" && String(m.id).startsWith("steer_probe_"));
	return handoff >= 0 && messages.slice(handoff + 1).some((m) => m.role === "assistant");
}

export class LearnHarnessEngine implements SessionEngine {
	readonly name = "learnharness" as const;
	/** Chats with a "Next question, please." on its way, so overlapping screen updates ask once. */
	private readonly asking = new Set<string>();

	constructor(
		private readonly port: LhPort,
		private readonly opts: { pollMs?: number; idlePollsBeforeGivingUp?: number } = {},
	) {}

	private chatId(session: CompanionSession): string {
		if (!session.chatId) throw new EngineError("no_chat", "session has no LearnHarness chat");
		return session.chatId;
	}

	private record(session: CompanionSession): LhMessage[] {
		const messages = this.port.messages(this.chatId(session));
		if (!messages) throw new EngineError("chat_missing", "the LearnHarness chat is gone", 410);
		return messages;
	}

	private async send(chatId: string, input: ChatInput): Promise<void> {
		const res = await this.port.send(chatId, input);
		if (res.status === 200) return;
		if (res.status === 409) throw conflict("turn_running", res.error);
		if (res.status === 400) throw badRequest(res.error ?? "LearnHarness refused the input");
		// 503 models_not_configured / provider_key_missing land here: the
		// checkpoint's "no setup" condition is unmet; the fallback can take over.
		throw new EngineError(res.code ?? `lh_${res.status}`, res.error, res.status === 503 ? 503 : 502);
	}

	async start(_session: CompanionSession, ctx: PrepareContext): Promise<SessionPatch> {
		const chatId = this.port.createChat(ctx.title);
		await this.send(chatId, { type: "text", text: ctx.openingMessage });
		return { chatId };
	}

	/** Ask the teacher for the next question. False when a request is already on its way. */
	private async askForQuestion(chatId: string, text: string = TEACHER_RULES.continueText): Promise<boolean> {
		if (this.asking.has(chatId)) return false;
		this.asking.add(chatId);
		try {
			await this.send(chatId, { type: "text", text });
			return true;
		} finally {
			this.asking.delete(chatId);
		}
	}

	/** The question tools a session can show: Learn shows all of them, guesses and written answers too. */
	private tools(session: CompanionSession): readonly string[] {
		return session.spec.learn ? QUESTION_TOOLS : SUPPORTED_QUESTION_TOOLS;
	}

	private learnView(session: CompanionSession, lecture: Pick<Lecture, "id" | "title" | "module">, now: Date) {
		const chatId = this.chatId(session);
		return mapLearnView({ messages: this.record(session), running: this.port.running(chatId), failure: this.port.failure(chatId), session, lecture, tree: this.port.tree(chatId), now, made: this.port.made(chatId) });
	}

	/** Learn is ready when the tutor's first question is on screen, or it has spoken and is waiting. It is never hurried along. */
	private async waitUntilLearnReady(session: CompanionSession, timeoutMs: number): Promise<void> {
		const pollMs = this.opts.pollMs ?? PREPARE_RULES.pollMs;
		const deadline = Date.now() + timeoutMs;
		for (;;) {
			// A session still being prepared is not an error yet, whatever its record says.
			const v = this.learnView({ ...session, state: "preparing" }, { id: session.spec.lectureId, title: "", module: "" }, new Date(0));
			if (v.status === "question" || v.status === "reply") return;
			if (v.status === "error") throw new EngineError(v.error?.startsWith("unsupported_question") ? "unsupported_question" : "turn_failed", v.error);
			if (Date.now() >= deadline) throw new EngineError("timeout", `the tutor did not start within ${timeoutMs} ms`, 504);
			await sleep(pollMs);
		}
	}

	async waitUntilReady(session: CompanionSession, timeoutMs: number, onNudge?: () => void): Promise<void> {
		if (session.spec.learn) return this.waitUntilLearnReady(session, timeoutMs);
		const chatId = this.chatId(session);
		const pollMs = this.opts.pollMs ?? PREPARE_RULES.pollMs;
		const maxIdle = this.opts.idlePollsBeforeGivingUp ?? 8;
		let deadline = Date.now() + timeoutMs;
		let idle = 0;
		for (;;) {
			const messages = this.record(session);
			const pending = pendingQuestionOf(messages);
			if (pending) {
				if ((SUPPORTED_QUESTION_TOOLS as readonly string[]).includes(pending.tool)) return;
				throw new EngineError("unsupported_question", `the first question used ${pending.tool}`);
			}
			const failure = this.port.failure(chatId);
			if (failure) throw new EngineError("turn_failed", failure);
			if (this.port.running(chatId)) idle = 0;
			else if (!hasProbeDone(messages) || teacherSpoke(messages)) {
				// Idle with no question: the prober stopped without probe_done, or
				// the teacher ended its turn without asking (e.g. presented a plan).
				if (++idle >= maxIdle && messages.some((m) => m.role === "assistant")) {
					if (!hasProbeDone(messages)) throw new EngineError("probe_not_done");
					// The teacher set its plan and stopped (T-1): ask once for the question (V-22).
					if (askedSinceLastAnswer(messages)) throw new EngineError("no_question");
					await this.askForQuestion(chatId);
					onNudge?.();
					idle = 0;
					deadline = Math.max(deadline, Date.now() + Math.min(timeoutMs, PREPARE_RULES.afterNudgeMs));
					continue;
				}
			}
			if (Date.now() >= deadline) throw new EngineError("timeout", `question 1 did not arrive within ${timeoutMs} ms`, 504);
			await sleep(pollMs);
		}
	}

	/**
	 * Learn: while teaching, a tutor that reacts to an answer and stops is
	 * asked to carry on, once per stop, so the student is not left pressing a
	 * button after every answer.
	 */
	private async learnViewKeptMoving(session: CompanionSession, lecture: Lecture, now: Date) {
		const v = this.learnView(session, lecture, now);
		if (v.status !== "reply" || v.learn?.phase !== "teach" || v.learn.finished || session.state === "stopped" || !tutorOwesNextStep(this.record(session))) return v;
		const thinking = { ...v, status: "thinking" as const, activity: LEARN_COPY.writing };
		try {
			return (await this.askForQuestion(this.chatId(session), LEARN_SAYS.carryOn)) ? { ...thinking, teacherNudged: true } : thinking;
		} catch {
			return v;
		}
	}

	async view(session: CompanionSession, lecture: Lecture, now: Date = new Date()) {
		if (session.spec.learn) return this.learnViewKeptMoving(session, lecture, now);
		const chatId = this.chatId(session);
		const messages = this.record(session);
		// A hand-off (F-112): question 1 was answered on the phone, outside this chat. The chat owes one question fewer.
		const seeded = session.spec.seedAnswer ? 1 : 0;
		const mapped = mapChatToView({ messages, running: this.port.running(chatId), failure: this.port.failure(chatId), session: { ...session, budget: session.budget - seeded }, lecture });
		const v = seeded ? { ...mapped, answered: mapped.answered + seeded, budget: mapped.budget + seeded } : mapped;
		// The teacher gave feedback (or nothing at all) and stopped before the budget: ask once per stop for the next question (TEACHER_RULES).
		if (v.status === "done" && v.endedEarly && v.answered < v.budget && !askedSinceLastAnswer(messages)) {
			const thinking = { ...v, status: "thinking" as const, endedEarly: undefined, activity: SESSION_COPY.writing(v.answered + 1) };
			try {
				// A second screen update while the request is on its way shows the wait and logs nothing (X-1).
				return (await this.askForQuestion(chatId)) ? { ...thinking, teacherNudged: true } : thinking;
			} catch {
				return v;
			}
		}
		return v;
	}

	private pending(session: CompanionSession, questionId: string) {
		const chatId = this.chatId(session);
		if (this.port.running(chatId)) throw conflict("turn_running", "the teacher is still writing");
		const pending = pendingQuestionOf(this.record(session));
		if (!pending || pending.toolCallId !== questionId) throw conflict("question_not_pending", "that question is no longer open");
		if (!this.tools(session).includes(pending.tool)) throw conflict("unsupported_question");
		return { chatId, pending };
	}

	async answer(session: CompanionSession, a: AnswerInput, now: Date) {
		const { chatId, pending } = this.pending(session, a.questionId);
		const qd = questionDataFromCall(pending.toolCallId, pending.tool, pending.input);
		let answer;
		try {
			answer = gradeAnswer(qd, a, pending.tool);
		} catch (err) {
			if (err instanceof AnswerInputError) throw badRequest(err.message);
			throw err;
		}
		answer.answeredAt = now.toISOString();
		await this.send(chatId, { type: "answer", toolCallId: pending.toolCallId, answer });
		const nodeId = (pending.input as { nodeId?: unknown } | null)?.nodeId;
		return { record: answerRecordFrom(answer, pending.toolCallId, typeof nodeId === "string" ? nodeId : undefined) };
	}

	async showMe(session: CompanionSession, questionId: string, now: Date) {
		// "I don't know" + the show-me thinking: the teacher treats it as a gap
		// to repair (worked example, then a fresh question on the same idea).
		return this.answer(session, { questionId, dontKnow: true, why: SHOW_ME_THINKING }, now);
	}

	async hint(session: CompanionSession, questionId: string) {
		const { chatId, pending } = this.pending(session, questionId);
		let text: string;
		try {
			text = await this.port.askSide(chatId, pending.messageId, HINT_REQUEST);
		} catch (err) {
			throw new EngineError("hint_failed", err instanceof Error ? err.message : String(err));
		}
		return { text: text.trim(), patch: { hintedQuestionIds: [...new Set([...(session.hintedQuestionIds ?? []), questionId])] } };
	}

	async say(session: CompanionSession, text: string): Promise<{ queued: boolean }> {
		const chatId = this.chatId(session);
		// Mid-reply: the tutor picks it up at its next pause. If that turn ends first, it goes as an ordinary message.
		if (this.port.running(chatId) && (await this.port.steer(chatId, text))) return { queued: true };
		// "Skip, just teach me" with a guess still open: the open question is dismissed, which is how the tutor
		// learns of the skip. (Left open, the engine refuses to end the opening questions: seen with the real AI.)
		const open = text === LEARN_SAYS.skipProbe && !this.port.running(chatId) ? pendingQuestionOf(this.record(session)) : null;
		if (open) {
			const question = (open.input as { question?: unknown } | null)?.question;
			await this.send(chatId, { type: "answer", toolCallId: open.toolCallId, answer: dismissedAnswer(toolQuestionKind(open.tool), typeof question === "string" ? question : "") });
			return { queued: false };
		}
		try {
			await this.send(chatId, { type: "text", text });
		} catch (err) {
			if (err instanceof CompanionError && err.code === "turn_running" && (await this.port.steer(chatId, text))) return { queued: true };
			throw err;
		}
		return { queued: false };
	}

	async ask(session: CompanionSession, questionId: string, text: string): Promise<{ answer: string | null }> {
		const { chatId, pending } = this.pending(session, questionId);
		try {
			return { answer: (await this.port.askSide(chatId, pending.messageId, text)).trim() };
		} catch {
			// No side answer here (the opening questions have no teaching to anchor one to): send it as a message. The tutor asks its question again.
			await this.send(chatId, { type: "text", text });
			return { answer: null };
		}
	}

	steps(session: CompanionSession) {
		return learnSteps(this.record(session), this.port.made(this.chatId(session)));
	}

	async more(session: CompanionSession, questions: number) {
		const chatId = this.chatId(session);
		const messages = this.record(session);
		// A question already posed past the old budget simply becomes answerable.
		if (!this.port.running(chatId) && !pendingQuestionOf(messages)) {
			await this.send(chatId, { type: "text", text: keepGoingText(questions) });
		}
		return {};
	}

	async retry(session: CompanionSession): Promise<void> {
		const chatId = this.chatId(session);
		if (this.port.running(chatId)) throw conflict("turn_running");
		const messages = this.record(session);
		if (this.port.failure(chatId)) return this.send(chatId, { type: "retry" });
		if (needsContinuation(messages)) return this.send(chatId, { type: "continue" });
		// Learn never hurries the tutor: with nothing failed and nothing owed, there is nothing to retry.
		if (session.spec.learn) throw conflict("nothing_to_retry");
		// The teacher ended its turn without a question (T-1): ask for it.
		if (hasProbeDone(messages) && !pendingQuestionOf(messages)) {
			await this.askForQuestion(chatId);
			return;
		}
		throw conflict("nothing_to_retry");
	}

	cost(session: CompanionSession): number | null {
		return session.chatId ? this.port.cost(session.chatId) : null;
	}

	remove(session: CompanionSession): void {
		if (session.chatId) this.port.deleteChat(session.chatId);
	}
}
