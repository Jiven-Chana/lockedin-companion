/**
 * ScriptedEngine (plan §6.9): the same session screen over authored JSON
 * questions. Deterministic, free, and instant — the usability-test and
 * demo-day safety net. State lives on the session record (`scripted`).
 */

import {
	initialScriptedState,
	ScriptedConflictError,
	scriptedAnswer,
	scriptedHint,
	scriptedMore,
	scriptedShowMe,
	scriptedView,
} from "../../../core/companion/scripted.ts";
import { AnswerInputError } from "../../../core/companion/question-data.ts";
import type { AnswerInput, CompanionSession, Lecture, ScriptedSet, ScriptedState } from "../../../core/companion/types.ts";
import { badRequest, conflict, EngineError } from "../errors.ts";
import type { PrepareContext, SessionEngine, SessionPatch } from "./types.ts";

function wrap<T>(fn: () => T): T {
	try {
		return fn();
	} catch (err) {
		if (err instanceof ScriptedConflictError) throw conflict(err.message);
		if (err instanceof AnswerInputError) throw badRequest(err.message);
		throw err;
	}
}

export class ScriptedEngine implements SessionEngine {
	readonly name = "scripted" as const;

	constructor(private readonly loadSet: (lectureId: string) => ScriptedSet | null) {}

	private set(session: CompanionSession): ScriptedSet {
		const set = this.loadSet(session.spec.lectureId);
		if (!set) throw new EngineError("no_scripted_set", `no scripted questions for ${session.spec.lectureId}`, 422);
		return set;
	}

	private state(session: CompanionSession): ScriptedState {
		if (!session.scripted) throw new EngineError("not_started", "scripted session was never started");
		return session.scripted;
	}

	async start(session: CompanionSession, ctx: PrepareContext): Promise<SessionPatch> {
		const scripted = initialScriptedState(this.set(session), session.spec, ctx.misses);
		if (scripted.queue.length === 0) throw new EngineError("no_scripted_set", "the scripted set has no questions", 422);
		return { scripted };
	}

	async waitUntilReady(): Promise<void> {}

	async view(session: CompanionSession, lecture: Lecture) {
		return scriptedView(this.set(session), this.state(session), session, lecture);
	}

	async answer(session: CompanionSession, a: AnswerInput, now: Date) {
		const { state, record } = wrap(() => scriptedAnswer(this.set(session), this.state(session), session, a, now));
		return { record, patch: { scripted: state } };
	}

	async showMe(session: CompanionSession, questionId: string) {
		const scripted = wrap(() => scriptedShowMe(this.set(session), this.state(session), questionId));
		return { patch: { scripted } };
	}

	async hint(session: CompanionSession, questionId: string) {
		const { state, text } = wrap(() => scriptedHint(this.set(session), this.state(session), questionId));
		return { text, patch: { scripted: state, hintedQuestionIds: [...new Set([...(session.hintedQuestionIds ?? []), questionId])] } };
	}

	async more(session: CompanionSession, questions: number) {
		return { patch: { scripted: scriptedMore(this.set(session), this.state(session), questions) } };
	}

	async retry(): Promise<void> {
		throw conflict("nothing_to_retry");
	}

	cost(): number | null {
		return 0;
	}

	remove(): void {}
}
