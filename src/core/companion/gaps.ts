/**
 * Gaps by idea (v2.0, V-39, V-43).
 *
 * A gap belongs to an idea, not to one question in one session. An idea has
 * a gap while it has an open miss. It leaves the list after two right
 * answers on different questions about it, on two different days, each
 * marked "Fairly sure" or "Certain" (GAP_RULES), counted from the latest
 * miss: a new miss starts the count again. A right answer anywhere counts:
 * Learn, Practise or the phone.
 *
 * Spacing and repetition are what the evidence supports (LIT-17, LIT-24),
 * and one lucky answer must not hide a gap (AE2-6). Nothing here is dated as
 * "due" or "overdue": a gap is something ready to grow (R-6, V-49).
 *
 * Pure: no IO, no clock.
 */

import { GAP_RULES } from "./policy.ts";
import { dateKey } from "./time.ts";
import type { Miss } from "./types.ts";

/** A right answer, from the event log. */
export interface RightAnswer {
	ideaKey: string;
	questionId: string;
	at: Date;
	/** How sure the student said they were (0–100), or null when they didn't say. */
	confidence: number | null;
}

export const GENERAL_IDEA = "(general)";
/** The idea a miss belongs to. A question with no idea tagged belongs to its unit as a whole. */
export const ideaKeyOfMiss = (m: Pick<Miss, "lectureId" | "nodeId">) => `${m.lectureId}#${m.nodeId || GENERAL_IDEA}`;

/**
 * The right answers that count towards closing a gap opened at `since`:
 * after it, sure enough, each on a different question and a different day.
 */
export function countedRights(since: Date, rights: readonly RightAnswer[]): RightAnswer[] {
	const questions = new Set<string>();
	const days = new Set<string>();
	const counted: RightAnswer[] = [];
	for (const r of [...rights].sort((a, b) => a.at.getTime() - b.at.getTime())) {
		if (r.at.getTime() <= since.getTime()) continue;
		if (r.confidence === null || r.confidence < GAP_RULES.sureConfidence) continue;
		if (questions.has(r.questionId) || days.has(dateKey(r.at))) continue;
		questions.add(r.questionId);
		days.add(dateKey(r.at));
		counted.push(r);
	}
	return counted;
}

export interface IdeaGap {
	key: string;
	lectureId: string;
	/** The idea's id in its unit's map, or GENERAL_IDEA. */
	nodeId: string;
	/** The open misses on this idea, newest first. */
	misses: Miss[];
	/** Right answers counted so far towards closing it, and how many are needed. */
	right: number;
	needed: number;
	/** When the latest miss happened: the count runs from here. */
	since: Date;
	/** A wrong answer given while sure: the most useful kind to work on (LIT-27). */
	confidentError: boolean;
}

/** Every idea with a gap, each with how far it is towards closing. Confident errors first, then the most recent. */
export function gapsByIdea(misses: readonly Miss[], rights: readonly RightAnswer[]): IdeaGap[] {
	const byIdea = new Map<string, Miss[]>();
	for (const m of misses) {
		if (m.status !== "open") continue;
		const key = ideaKeyOfMiss(m);
		byIdea.set(key, [...(byIdea.get(key) ?? []), m]);
	}
	const out: IdeaGap[] = [];
	for (const [key, list] of byIdea) {
		const sorted = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
		const since = new Date(sorted[0]!.createdAt);
		const counted = countedRights(since, rights.filter((r) => r.ideaKey === key));
		out.push({
			key,
			lectureId: sorted[0]!.lectureId,
			nodeId: sorted[0]!.nodeId || GENERAL_IDEA,
			misses: sorted,
			right: Math.min(counted.length, GAP_RULES.rightAnswers),
			needed: GAP_RULES.rightAnswers,
			since,
			confidentError: sorted.some((m) => m.reason === "wrong" && (m.confidence ?? 0) >= GAP_RULES.sureConfidence),
		});
	}
	return out.sort((a, b) => Number(b.confidentError) - Number(a.confidentError) || b.since.getTime() - a.since.getTime() || a.key.localeCompare(b.key));
}

/**
 * Close the gaps that have earned it: every open miss of an idea with enough
 * counted right answers becomes solid. Returns the same array when nothing
 * closed.
 */
export function closeGaps(misses: Miss[], rights: readonly RightAnswer[], now: Date): Miss[] {
	const closed = new Set(gapsByIdea(misses, rights).filter((g) => g.right >= g.needed).map((g) => g.key));
	if (closed.size === 0) return misses;
	return misses.map((m) => (m.status === "open" && closed.has(ideaKeyOfMiss(m)) ? { ...m, status: "solid", solidAt: now.toISOString() } : m));
}
