/**
 * The Sunday check-in (v0.1 F-111, V-5, N-5): last week's blocks *started*
 * and minutes, "too much / about right / too little", then a proposed
 * target the student confirms or keeps. The target never changes without
 * a confirm tap, and nothing is ever counted as missed (R-6, BC §6).
 */

import { CHECKIN_RULES, PLAN_COPY } from "./policy.ts";
import { addDays, atTime, dateKey, isoWeekday } from "./time.ts";
import type { StudyBlock } from "./types.ts";

export type Feeling = "too-much" | "about-right" | "too-little";
export const FEELINGS: readonly Feeling[] = ["too-much", "about-right", "too-little"];

/**
 * The week the check-in looks back on: on a Sunday (when N-5 fires) the
 * week ending today; on any other day, the last full week.
 */
export function lastWeekRange(now: Date): { from: string; to: string } {
	const monday = addDays(atTime(now, "00:00"), 1 - isoWeekday(now));
	const from = isoWeekday(now) === 7 ? monday : addDays(monday, -7);
	return { from: dateKey(from), to: dateKey(addDays(from, 6)) };
}

/** Blocks started last week and their minutes. Only what was done is counted; never what wasn't. */
export function lastWeekSummary(blocks: readonly StudyBlock[], now: Date): { started: number; minutes: number; text: string } {
	const { from, to } = lastWeekRange(now);
	const started = blocks.filter((b) => b.status === "started" && b.date >= from && b.date <= to);
	const minutes = started.reduce((n, b) => n + b.minutes, 0);
	return { started: started.length, minutes, text: PLAN_COPY.checkin(started.length, minutes) };
}

/**
 * The proposed target after a check-in: a step down for "too much", up for
 * "too little", the same for "about right"; never under the minimum or over
 * the free time the coming week has.
 */
export function proposeTarget(current: number, feeling: Feeling, roomMinutes: number): number {
	const step = feeling === "too-much" ? -CHECKIN_RULES.stepMinutes : feeling === "too-little" ? CHECKIN_RULES.stepMinutes : 0;
	const ceiling = Math.max(CHECKIN_RULES.minTargetMinutes, roomMinutes);
	return Math.min(ceiling, Math.max(CHECKIN_RULES.minTargetMinutes, current + step));
}
