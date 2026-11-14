/**
 * The miss log (plan §6.8). A quiz answer is a miss when it is wrong, an
 * "I don't know" that was not a "show me first" request, or right at
 * ≤ 30% confidence (a lucky or fragile answer: AE2-6). Misses come back in
 * retests 1, 3 and 7 days later and become "solid" after a correct answer
 * at ≥ 70% confidence in a retest.
 */

import { LOW_CONFIDENCE, MISS_SPACING_DAYS, SOLID_CONFIDENCE } from "./policy.ts";
import { addDays } from "./time.ts";
import type { AnswerRecord, Miss, MissReason } from "./types.ts";

export function missReason(a: AnswerRecord): MissReason | null {
	if (!a.graded || a.shown) return null;
	if (a.dontKnow) return "dont-know";
	if (!a.correct) return "wrong";
	if (a.confidence !== undefined && a.confidence <= LOW_CONFIDENCE) return "low-confidence";
	return null;
}

export const missId = (sessionId: string, questionId: string) => `${sessionId}:${questionId}`;

export function nextDueAfter(timesSeen: number, from: Date): Date {
	const days = MISS_SPACING_DAYS[Math.min(timesSeen, MISS_SPACING_DAYS.length - 1)]!;
	return addDays(from, days);
}

/** The miss an answer creates, or null. Ids are stable per (session, question), so re-running is idempotent. */
export function missFromAnswer(a: AnswerRecord, ctx: { sessionId: string; lectureId: string; now: Date }): Miss | null {
	const reason = missReason(a);
	if (!reason) return null;
	return {
		id: missId(ctx.sessionId, a.questionId),
		lectureId: ctx.lectureId,
		sessionId: ctx.sessionId,
		questionId: a.questionId,
		...(a.nodeId ? { nodeId: a.nodeId } : {}),
		questionText: a.questionText,
		correctLabels: a.correctLabels,
		...(a.explanation ? { explanation: a.explanation } : {}),
		...(a.confidence !== undefined ? { confidence: a.confidence } : {}),
		reason,
		status: "open",
		timesSeen: 0,
		nextDue: nextDueAfter(0, ctx.now).toISOString(),
		createdAt: ctx.now.toISOString(),
	};
}

/** Merge new misses into the log without duplicating ids. */
export function mergeMisses(existing: Miss[], incoming: Miss[]): Miss[] {
	const ids = new Set(existing.map((m) => m.id));
	return [...existing, ...incoming.filter((m) => !ids.has(m.id))];
}

/**
 * Apply one retest answer. The retest opening message asks for one question
 * per revisit item in order, so the k-th counted answer maps to
 * missIds[k % missIds.length]. Solid on correct at ≥ 70%; otherwise the
 * miss is seen once more and rescheduled.
 */
export function applyRetestAnswer(misses: Miss[], missIds: readonly string[], ordinal: number, a: AnswerRecord, now: Date): Miss[] {
	if (!a.graded || a.shown || missIds.length === 0) return misses;
	const targetId = missIds[(ordinal - 1) % missIds.length];
	return misses.map((m) => {
		if (m.id !== targetId || m.status === "solid") return m;
		if (a.correct && !a.dontKnow && (a.confidence ?? 0) >= SOLID_CONFIDENCE) {
			return { ...m, status: "solid", timesSeen: m.timesSeen + 1, solidAt: now.toISOString() };
		}
		const timesSeen = m.timesSeen + 1;
		return { ...m, timesSeen, nextDue: nextDueAfter(timesSeen, now).toISOString() };
	});
}

export function openMisses(misses: Miss[], lectureId?: string): Miss[] {
	return misses.filter((m) => m.status === "open" && (!lectureId || m.lectureId === lectureId));
}
