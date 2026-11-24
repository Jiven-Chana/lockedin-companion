/**
 * Study blocks and the simulated lock (plan §7.7). Pure.
 *
 * The lock is OFF by default (X-6, INT-01-b), every lock has an override
 * (LIT-10, LIT-11), and the screen says plainly that it is simulated.
 * Breaks: apps reopen for 5 minutes after every 25 (Pomodoro).
 */

import { BLOCK_RULES } from "./policy.ts";
import { addMinutes, atTime, isValidHM, minutesBetween } from "./time.ts";
import { blockOccursOn } from "./nudges.ts";
import type { LockStrictness, StudyBlock } from "./types.ts";

const STATUSES = ["proposed", "accepted", "started", "removed"] as const;
const SOURCES = ["planner", "student", "phone"] as const;

/** Check blocks the student saves or edits (F-110). Planner proposals are built by plan-week.ts. */
export function validateBlocks(blocks: unknown): { ok: true; blocks: StudyBlock[] } | { ok: false; errors: string[] } {
	if (!Array.isArray(blocks)) return { ok: false, errors: ["blocks must be an array"] };
	const errors: string[] = [];
	const out: StudyBlock[] = [];
	const ids = new Set<string>();
	blocks.forEach((raw, i) => {
		const b = raw as Partial<StudyBlock>;
		const where = `block ${i + 1}`;
		if (typeof b.id !== "string" || !/^[\w-]{1,64}$/.test(b.id)) errors.push(`${where}: id is required`);
		else if (ids.has(b.id)) errors.push(`${where}: duplicate id`);
		else ids.add(b.id);
		if (typeof b.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) errors.push(`${where}: date must be YYYY-MM-DD`);
		if (!isValidHM(b.start)) errors.push(`${where}: start must be HH:MM`);
		const minutes = b.minutes ?? BLOCK_RULES.defaultMinutes;
		if (!Number.isInteger(minutes) || minutes < BLOCK_RULES.minMinutes || minutes > BLOCK_RULES.maxMinutes)
			errors.push(`${where}: minutes must be ${BLOCK_RULES.minMinutes}–${BLOCK_RULES.maxMinutes}`);
		const status = (STATUSES as readonly string[]).includes(b.status as string) ? (b.status as StudyBlock["status"]) : "accepted";
		const source = (SOURCES as readonly string[]).includes(b.source as string) ? (b.source as StudyBlock["source"]) : "student";
		out.push({
			id: b.id as string,
			date: b.date as string,
			start: b.start as string,
			minutes,
			status,
			source,
			...(typeof b.lectureId === "string" && b.lectureId ? { lectureId: b.lectureId } : {}),
			...(typeof b.firstTaskQuestionId === "string" && b.firstTaskQuestionId ? { firstTaskQuestionId: b.firstTaskQuestionId } : {}),
			...(b.reason === "keep-up" || b.reason === "gap" ? { reason: b.reason } : {}),
			...(typeof b.anchorOf === "string" ? { anchorOf: b.anchorOf } : {}),
		});
	});
	return errors.length > 0 ? { ok: false, errors } : { ok: true, blocks: out };
}

export interface ActiveBlock {
	block: StudyBlock;
	startedAt: string;
	endsAt: string;
	minutesLeft: number;
	/** Inside a Pomodoro break: apps are open. */
	onBreak: boolean;
	/** When the current focus or break phase ends. */
	phaseEndsAt: string;
}

export function activeBlock(blocks: StudyBlock[], now: Date): ActiveBlock | null {
	for (const block of blocks) {
		if (!blockOccursOn(block, now)) continue;
		const start = atTime(now, block.start);
		const end = addMinutes(start, block.minutes);
		if (now < start || now >= end) continue;
		const cycle = BLOCK_RULES.focusMinutes + BLOCK_RULES.breakMinutes;
		const into = minutesBetween(start, now);
		const inCycle = into % cycle;
		const onBreak = inCycle >= BLOCK_RULES.focusMinutes;
		const phaseEnd = addMinutes(start, Math.floor(into / cycle) * cycle + (onBreak ? cycle : BLOCK_RULES.focusMinutes));
		return {
			block,
			startedAt: start.toISOString(),
			endsAt: end.toISOString(),
			minutesLeft: Math.ceil(minutesBetween(now, end)),
			onBreak,
			phaseEndsAt: (phaseEnd < end ? phaseEnd : end).toISOString(),
		};
	}
	return null;
}

export type LockDecision =
	| { allowed: true; reason: "no-block" | "lock-off" | "break" | "override-active" | "override" }
	| { allowed: false; prompt: "confirm" | "why"; message: string };

/**
 * Opening a decoy app during a block. Gentle asks "Open anyway?"; firm asks
 * "What do you want it for?" and then lets them through for 2 minutes.
 * `confirmed` / `reason` are the student's answer to that prompt.
 */
export function lockDecision(args: {
	strictness: LockStrictness;
	active: ActiveBlock | null;
	now: Date;
	overrideUntil?: string;
	confirmed?: boolean;
	reason?: string;
}): LockDecision {
	const { strictness, active, now } = args;
	if (!active) return { allowed: true, reason: "no-block" };
	if (strictness === "off") return { allowed: true, reason: "lock-off" };
	if (active.onBreak) return { allowed: true, reason: "break" };
	if (args.overrideUntil && new Date(args.overrideUntil) > now) return { allowed: true, reason: "override-active" };
	if (strictness === "gentle") {
		return args.confirmed
			? { allowed: true, reason: "override" }
			: { allowed: false, prompt: "confirm", message: `Study block: ${active.minutesLeft} minutes left. Open anyway?` };
	}
	return args.reason && args.reason.trim()
		? { allowed: true, reason: "override" }
		: { allowed: false, prompt: "why", message: "What do you want it for?" };
}
