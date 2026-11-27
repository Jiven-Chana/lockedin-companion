/**
 * The round on the phone (v2.1 part A; V-46, V-67). The question a
 * notification carries is question 1 of a Practise round; the rest of the
 * round travels with it, so "Keep going here" works with the laptop closed.
 * Questions saved with "Done for now" or "Save the rest for later" come
 * straight after the next lecture's own question: that notification stays
 * about the lecture that just ended (R-3). Pure, no IO.
 */

import type { NudgeQuestion } from "./nudges.ts";

/** A question in a round, by where it lives. */
export interface RoundRef {
	lectureId: string;
	questionId: string;
}

/**
 * Questions 2 onwards of the round that starts with `first`: what was saved,
 * oldest first, then the lecture's own questions in bank order. Never `first`
 * again, never a question twice, `size` questions in all at most.
 */
export function buildRound(input: { first: NudgeQuestion; saved: readonly NudgeQuestion[]; own: readonly NudgeQuestion[]; size: number }): NudgeQuestion[] {
	const seen = new Set([input.first.id]);
	const out: NudgeQuestion[] = [];
	for (const q of [...input.saved, ...input.own]) {
		if (out.length >= input.size - 1) break;
		if (seen.has(q.id)) continue;
		seen.add(q.id);
		out.push(q);
	}
	return out;
}

/** The saved list after questions are added to it or answered: each once, the newest `max` kept. */
export function savedAfter(saved: readonly RoundRef[], change: { add?: readonly RoundRef[]; remove?: readonly string[] }, max: number): RoundRef[] {
	const gone = new Set(change.remove ?? []);
	const adding = new Set((change.add ?? []).map((r) => r.questionId));
	const out = [...saved.filter((r) => !gone.has(r.questionId) && !adding.has(r.questionId)), ...(change.add ?? [])];
	return out.slice(Math.max(0, out.length - max));
}

/**
 * A notification small enough for the relay: questions come off the end of
 * its round until it fits. Its own question is never touched, so the worst
 * case is today's behaviour (one question, the rest on the laptop).
 */
export function fitNudge<T extends { round?: unknown[] }>(nudge: T, maxChars: number): T {
	if (!nudge.round) return nudge;
	let round = nudge.round;
	while (round.length > 0 && JSON.stringify({ ...nudge, round }).length > maxChars) round = round.slice(0, -1);
	return round.length === nudge.round.length ? nudge : { ...nudge, round };
}

/**
 * The week's blocks small enough for the relay (v2.2 part C): a block's
 * on-the-move questions come off the furthest block first until everything
 * fits. A block's own lines are never touched, so the worst case is v2.1's
 * week. `besideChars` is what is stored beside the blocks (the week).
 */
export function fitBlocks<T extends { round?: unknown[] }>(blocks: readonly T[], besideChars: number, maxChars: number): T[] {
	const out = [...blocks];
	for (let i = out.length - 1; i >= 0 && JSON.stringify(out).length + besideChars > maxChars; i--) {
		if (!out[i]!.round) continue;
		const { round: _round, ...rest } = out[i]!;
		out[i] = rest as T;
	}
	return out;
}

/**
 * The phone's Practise pools small enough for the relay (v2.3 part B): one
 * question at a time comes off the end of the largest pool until they fit
 * beside the blocks and the week (`besideChars`). A pool with nothing left
 * is not sent. The blocks and the week are never touched for this.
 */
export function fitPractise<T extends { questions: unknown[] }>(pools: readonly T[], besideChars: number, maxChars: number): T[] {
	let out = pools.filter((p) => p.questions.length > 0);
	while (out.length > 0 && JSON.stringify(out).length + besideChars > maxChars) {
		const largest = out.reduce((a, b) => (b.questions.length > a.questions.length ? b : a));
		out = out.map((p) => (p === largest ? { ...p, questions: p.questions.slice(0, -1) } : p)).filter((p) => p.questions.length > 0);
	}
	return out;
}
