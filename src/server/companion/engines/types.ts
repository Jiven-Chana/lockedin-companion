/**
 * The session engine interface (plan §5.4). The session screen only ever
 * talks to the companion service, and the service only talks to this, so
 * switching engines (COMPANION_ENGINE, or per session from the facilitator
 * panel) changes no UI code. The fallback hinges on it.
 *
 * Differences from the plan's sketch, on purpose:
 *  - prepare() is split into start() (returns as soon as the first turn is
 *    admitted, so POST /sessions answers immediately) and waitUntilReady()
 *    (run in the background; records the latency);
 *  - methods take the session record and return a patch for it, so engine
 *    state (chat id, scripted queue) persists in one place: sessions.json.
 */

import type {
	AnswerInput,
	AnswerRecord,
	CompanionSession,
	EngineName,
	LearnItem,
	Lecture,
	Miss,
	SessionView,
} from "../../../core/companion/types.ts";

export interface PrepareContext {
	title: string;
	openingMessage: string;
	misses: Miss[];
}

export type SessionPatch = Partial<Omit<CompanionSession, "id">>;

export interface SessionEngine {
	readonly name: EngineName;
	start(session: CompanionSession, ctx: PrepareContext): Promise<SessionPatch>;
	/** Resolves when question 1 is on the screen. `onNudge` fires if the teacher had to be asked for it (V-22). */
	waitUntilReady(session: CompanionSession, timeoutMs: number, onNudge?: () => void): Promise<void>;
	view(session: CompanionSession, lecture: Lecture, now?: Date): Promise<SessionView>;
	answer(session: CompanionSession, a: AnswerInput, now: Date): Promise<{ record: AnswerRecord; patch?: SessionPatch }>;
	/** "Show me first" on the given question. LearnHarness answers it as a
	 *  request (record.shown); scripted shows the worked example (no record). */
	showMe(session: CompanionSession, questionId: string, now: Date): Promise<{ record?: AnswerRecord; patch?: SessionPatch }>;
	hint(session: CompanionSession, questionId: string): Promise<{ text: string; patch?: SessionPatch }>;
	/**
	 * Learn (V-54): the student types or says something to the tutor. `queued`
	 * when the tutor was mid-reply and picks it up at its next pause.
	 */
	say?(session: CompanionSession, text: string): Promise<{ queued: boolean }>;
	/**
	 * Learn: something asked while a question is open. The tutor answers beside
	 * the question, which stays open. Null when it could only be sent as an
	 * ordinary message (the question is then set aside and asked again).
	 */
	ask?(session: CompanionSession, questionId: string, text: string): Promise<{ answer: string | null }>;
	/** Every step of a Learn session so far, oldest first ("Earlier"). */
	steps?(session: CompanionSession): LearnItem[][];
	/** "Keep going": the service raises the budget; the engine makes more questions happen. */
	more(session: CompanionSession, questions: number): Promise<{ patch?: SessionPatch }>;
	/** Recover a failed or interrupted turn (risk table: offer Retry). */
	retry(session: CompanionSession): Promise<void>;
	/** Money spent on this session, when known. */
	cost(session: CompanionSession): number | null;
	/** Delete what the engine stored for this session. */
	remove(session: CompanionSession): void;
}
