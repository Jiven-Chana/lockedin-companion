/**
 * The routine the setup chat learns (v0.1 F-109, V-4): energy times,
 * private commitments, places (free text, never sensed: R-2), a weekly
 * target and a preferred block length. Validated before it's saved; it
 * never touches a Settings toggle.
 */

import { PLAN_RULES } from "./policy.ts";
import { isValidHM, parseHM } from "./time.ts";
import type { Routine } from "./types.ts";

const ENERGY = ["morning", "afternoon", "evening"] as const;

/** A partial routine (the chat's draft) → a complete, checked one, or the problems. */
export function validateRoutine(raw: unknown, confirmedAt: string): { ok: true; routine: Routine } | { ok: false; errors: string[] } {
	const r = (raw ?? {}) as Partial<Routine>;
	const errors: string[] = [];
	const energy = Array.isArray(r.energy) ? [...new Set(r.energy.filter((e): e is Routine["energy"][number] => (ENERGY as readonly string[]).includes(e as string)))] : [];
	const commitments: Routine["commitments"] = [];
	for (const [i, c] of (Array.isArray(r.commitments) ? r.commitments : []).entries()) {
		const where = `commitment ${i + 1}`;
		const label = typeof c?.label === "string" ? c.label.trim().slice(0, 40) : "";
		const weekdays = Array.isArray(c?.weekdays) ? [...new Set(c.weekdays.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))].sort() : [];
		if (!label) errors.push(`${where}: a name, e.g. "Shift"`);
		if (weekdays.length === 0) errors.push(`${where}: which days`);
		if (!isValidHM(c?.start) || !isValidHM(c?.end) || parseHM(c.end) <= parseHM(c.start)) errors.push(`${where}: a start and end time, end after start`);
		else commitments.push({ label, weekdays, start: c.start, end: c.end });
	}
	if (commitments.length > 10) errors.push("at most 10 commitments");
	const places = Array.isArray(r.places) ? r.places.filter((p): p is string => typeof p === "string" && !!p.trim()).map((p) => p.trim().slice(0, 40)).slice(0, 5) : [];
	const target = r.weeklyTargetMinutes;
	if (!Number.isInteger(target) || (target as number) < 30 || (target as number) > 40 * 60) errors.push("a weekly target between 30 minutes and 40 hours");
	const block = r.preferredBlockMinutes ?? PLAN_RULES.defaultBlockMinutes;
	if (!Number.isInteger(block) || block < PLAN_RULES.minBlockMinutes || block > PLAN_RULES.maxBlockMinutes) errors.push(`a block length of ${PLAN_RULES.minBlockMinutes} to ${PLAN_RULES.maxBlockMinutes} minutes`);
	if (errors.length) return { ok: false, errors };
	return { ok: true, routine: { energy, commitments, places, weeklyTargetMinutes: target as number, preferredBlockMinutes: block, confirmedAt } };
}
