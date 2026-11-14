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
	waitUntilReady(session: CompanionSession, timeoutMs: number): Promise<void>;
	view(session: CompanionSession, lecture: Lecture): Promise<SessionView>;
	answer(session: CompanionSession, a: AnswerInput, now: Date): Promise<{ record: AnswerRecord; patch?: SessionPatch }>;
	/** "Show me first" on the given question. LearnHarness answers it as a
	 *  request (record.shown); scripted shows the worked example (no record). */
	showMe(session: CompanionSession, questionId: string, now: Date): Promise<{ record?: AnswerRecord; patch?: SessionPatch }>;
	hint(session: CompanionSession, questionId: string): Promise<{ text: string; patch?: SessionPatch }>;
	/** "Keep going": the service raises the budget; the engine makes more questions happen. */
	more(session: CompanionSession, questions: number): Promise<{ patch?: SessionPatch }>;
	/** Recover a failed or interrupted turn (risk table: offer Retry). */
	retry(session: CompanionSession): Promise<void>;
	/** Money spent on this session, when known. */
	cost(session: CompanionSession): number | null;
	/** Delete what the engine stored for this session. */
	remove(session: CompanionSession): void;
}
