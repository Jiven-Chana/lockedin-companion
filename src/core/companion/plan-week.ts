/**
 * The weekly plan (v0.1 F-110, V-5) and the pacing rule (spec §5.5, V-18).
 * Pure: the service gathers the week's lectures, routine and units; this
 * decides what to study and proposes blocks in the free gaps. The student
 * ticks, moves or removes each proposal; nothing is ever "missed" (R-6).
 */

import { PLAN_COPY, PLAN_RULES, SHARE_RULES } from "./policy.ts";
import { addDays, addMinutes, atTime, dateKey, formatHM, isoWeekday, minutesOfDay, parseHM, wakingWindow } from "./time.ts";
import type { BlockPlaced, EnergyTime, Lecture, ModuleInfo, Profile, Routine, StudyBlock } from "./types.ts";
import { currentWeek } from "./units.ts";

// ─── the pacing rule ────────────────────────────────────────────────────────

/** A unit with the student's standing on it (from lecturesWithStatus). */
export type UnitStatus = Pick<Lecture, "id" | "module" | "week" | "order" | "hasMaterials"> & { status: "answered" | "revisit" | "not-started" };

export interface PacedUnit {
	lectureId: string;
	module: string;
	reason: "keep-up" | "gap";
}

/**
 * What to study, in order (spec §5.5). Per module: keep up with the current
 * week (and the one before) first, in course order; then earlier units
 * marked revisit, most recent first, no more than maxGapWeeksBack behind.
 * Modules take turns, by their share of the week (V-63). `blocks` caps the
 * list; gap units get at most gapShare of it, except in a reading week
 * (catch-up time).
 */
export function pacedUnits(input: { modules: readonly Pick<ModuleInfo, "code" | "weekOneStart" | "readingWeeks" | "share">[]; units: readonly UnitStatus[]; now: Date; blocks: number }): PacedUnit[] {
	const keepUp: PacedUnit[][] = [];
	const gaps: PacedUnit[][] = [];
	let anyReading = false;
	for (const m of input.modules) {
		const units = input.units.filter((u) => u.module === m.code && u.hasMaterials).sort((a, b) => (a.week || 99) - (b.week || 99) || a.order - b.order);
		const cw = currentWeek(m, input.now);
		anyReading ||= cw.reading;
		let k: typeof units;
		let g: typeof units;
		if (cw.week === null) {
			// No week set: the first units not yet answered are "keep up"; anything marked revisit is a gap.
			k = units.filter((u) => u.status === "not-started").slice(0, 3);
			g = units.filter((u) => u.status === "revisit").reverse();
		} else {
			const from = cw.week - PLAN_RULES.keepUpWeeksBack;
			k = units.filter((u) => u.week >= from && u.week <= cw.week! && u.status !== "answered");
			g = units.filter((u) => u.week > 0 && u.week < from && u.week >= cw.week! - PLAN_RULES.maxGapWeeksBack && u.status === "revisit").sort((a, b) => b.week - a.week || b.order - a.order);
		}
		keepUp.push(k.map((u) => ({ lectureId: u.id, module: m.code, reason: "keep-up" })));
		gaps.push(g.map((u) => ({ lectureId: u.id, module: m.code, reason: "gap" })));
	}
	const shares = input.modules.map((m) => SHARE_RULES[m.share ?? "normal"]);
	const interleave = (lists: PacedUnit[][]) => {
		const out: PacedUnit[] = [];
		const next = lists.map(() => 0);
		for (let round = 0; lists.some((l, i) => next[i]! < l.length); round++) {
			lists.forEach((l, i) => {
				const share = shares[i]!;
				if ((round + 1) % share.every !== 0) return;
				for (let n = share.turns; n > 0 && next[i]! < l.length; n--) out.push(l[next[i]!++]!);
			});
		}
		return out;
	};
	const k = interleave(keepUp);
	const g = interleave(gaps);
	// Catch-up gets at most gapShare of the blocks (all of them in a reading week); keep-up fills the rest.
	const gapCap = anyReading ? input.blocks : Math.floor(input.blocks * PLAN_RULES.gapShare);
	const nGaps = Math.min(g.length, gapCap);
	const nKeep = Math.min(k.length, input.blocks - nGaps);
	return [...k.slice(0, nKeep), ...g.slice(0, nGaps)];
}

// ─── proposing the week ─────────────────────────────────────────────────────

export interface PlanInput {
	/** Any day in the week to plan (Monday to Sunday). */
	week: Date;
	now: Date;
	lectures: readonly Lecture[];
	routine?: Pick<Routine, "commitments" | "energy">;
	quietHours: Profile["prefs"]["quietHours"];
	targetMinutes: number;
	blockMinutes: number;
	/** This week's blocks already accepted or started: they count toward the target and are busy. */
	existing: readonly StudyBlock[];
	/** Last week's accepted or started blocks: their weekday-and-time slots are preferred (LIT-18). */
	lastWeek: readonly StudyBlock[];
	/** What to study, in order (pacedUnits). */
	focus: readonly PacedUnit[];
	/** A first task per unit (a bank question id), when its pack has one. */
	firstTask?: (lectureId: string) => string | undefined;
	newId: (i: number) => string;
}

export interface PlanResult {
	proposals: StudyBlock[];
	/** Minutes already accepted this week plus the proposals. */
	plannedMinutes: number;
	/** All the free time this week could hold (blocks of blockMinutes, at most maxBlocksPerDay a day). */
	roomMinutes: number;
	/** False when the target is more than the week has room for: "Your week only has room for …". */
	fits: boolean;
}

interface Busy { start: Date; end: Date; module?: string; lecture?: boolean }

export const clampBlockMinutes = (m: number) => Math.min(PLAN_RULES.maxBlockMinutes, Math.max(PLAN_RULES.minBlockMinutes, Math.round(m)));
const roundUp = (d: Date) => {
	const step = PLAN_RULES.slotStepMinutes;
	const m = minutesOfDay(d);
	const r = Math.ceil(m / step) * step;
	return addMinutes(d, r - m);
};
export const anchorKey = (b: Pick<StudyBlock, "date" | "start">) => `${isoWeekday(new Date(`${b.date}T12:00:00`))}@${b.start}`;

function busyOn(day: Date, input: PlanInput): Busy[] {
	const key = dateKey(day);
	const out: Busy[] = [];
	for (const l of input.lectures) {
		if (!l.start || !l.end || l.archived) continue;
		const s = new Date(l.start);
		const e = new Date(l.end);
		if (e <= atTime(day, "00:00") || s >= addDays(atTime(day, "00:00"), 1)) continue;
		out.push({ start: s, end: e, module: l.module, lecture: (l.kind ?? "lecture") === "lecture" });
	}
	for (const c of input.routine?.commitments ?? []) if (c.weekdays.includes(isoWeekday(day))) out.push({ start: atTime(day, c.start), end: atTime(day, c.end) });
	for (const b of input.existing) if (b.date === key && (b.status === "accepted" || b.status === "started")) out.push({ start: atTime(day, b.start), end: addMinutes(atTime(day, b.start), b.minutes) });
	return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}

interface Slot { day: Date; start: Date; score: number; afterModule?: string; anchor?: string; energy?: EnergyTime }

/** What put a slot at the top, in the order the reasons are given: last week's slot, the student's energy, a lecture just before, else a free gap. */
function placedOf(s: Slot): BlockPlaced {
	if (s.anchor) return { by: "anchor" };
	if (s.energy) return { by: "energy", when: s.energy };
	if (s.afterModule) return { by: "after-lecture", module: s.afterModule };
	return { by: "gap" };
}

/** "because you have energy in the afternoon": why the planner put a block where it is, or null for one the student made or moved. */
export function blockWhy(block: Pick<StudyBlock, "placed">, modules: readonly Pick<ModuleInfo, "code" | "name">[]): string | null {
	const p = block.placed;
	if (!p) return null;
	if (p.by === "anchor") return PLAN_COPY.placed.anchor;
	if (p.by === "energy") return PLAN_COPY.placed.energy(p.when);
	if (p.by === "after-lecture") return PLAN_COPY.placed.afterLecture(modules.find((m) => m.code === p.module)?.name ?? p.module);
	return PLAN_COPY.placed.gap;
}

function slotsOn(day: Date, input: PlanInput, len: number, anchors: Set<string>): Slot[] {
	const { start: wake, end: sleep } = wakingWindow(day, input.quietHours);
	const busy = busyOn(day, input);
	const buf = PLAN_RULES.bufferMinutes;
	const gaps: { start: Date; end: Date; after?: Busy }[] = [];
	let cursor = wake;
	let after: Busy | undefined;
	for (const b of busy) {
		const bs = addMinutes(b.start, -buf);
		if (bs > cursor) gaps.push({ start: cursor, end: bs < sleep ? bs : sleep, ...(after ? { after } : {}) });
		const be = addMinutes(b.end, buf);
		if (be > cursor) {
			cursor = be;
			after = b;
		}
	}
	if (cursor < sleep) gaps.push({ start: cursor, end: sleep, ...(after ? { after } : {}) });
	const notBefore = roundUp(addMinutes(input.now, buf));
	const out: Slot[] = [];
	for (const g of gaps) {
		// Candidate starts: the gap's start, then every hour, so a long gap offers several times.
		for (let s = roundUp(g.start); addMinutes(s, len) <= g.end; s = addMinutes(s, 60)) {
			if (s < notBefore) continue;
			const key = `${isoWeekday(day)}@${formatHM(s)}`;
			let score = 0;
			let energy: EnergyTime | undefined;
			if (anchors.has(key)) score += 4;
			for (const e of input.routine?.energy ?? []) {
				const [from, to] = PLAN_RULES.energy[e];
				if (minutesOfDay(s) >= parseHM(from) && minutesOfDay(s) < parseHM(to)) {
					score += 2;
					energy ??= e;
				}
			}
			const rightAfterLecture = g.after?.lecture && s.getTime() === roundUp(g.start).getTime();
			if (rightAfterLecture) score += 1;
			out.push({ day, start: s, score, ...(rightAfterLecture && g.after?.module ? { afterModule: g.after.module } : {}), ...(anchors.has(key) ? { anchor: key } : {}), ...(energy ? { energy } : {}) });
		}
	}
	return out;
}

/**
 * Propose blocks for the rest of the week (F-110). Never overlaps a lecture,
 * event, routine commitment, accepted block or quiet hours; at most
 * maxBlocksPerDay a day; prefers last week's slots, then energy windows,
 * then the gap right after a lecture (whose module it then studies).
 */
export function proposeWeek(input: PlanInput): PlanResult {
	const len = clampBlockMinutes(input.blockMinutes);
	const monday = addDays(atTime(input.week, "00:00"), 1 - isoWeekday(input.week));
	const anchors = new Set(input.lastWeek.filter((b) => b.status === "accepted" || b.status === "started").map(anchorKey));
	const already = input.existing.filter((b) => b.status === "accepted" || b.status === "started");
	const alreadyMinutes = already.reduce((n, b) => n + b.minutes, 0);
	const perDay = new Map<string, number>();
	for (const b of already) perDay.set(b.date, (perDay.get(b.date) ?? 0) + 1);

	const byDay: Slot[][] = [];
	let room = alreadyMinutes;
	for (let i = 0; i < 7; i++) {
		const day = addDays(monday, i);
		const slots = slotsOn(day, input, len, anchors);
		byDay.push(slots);
		// Room: how many non-overlapping blocks fit, up to the daily cap.
		let fit = 0;
		let lastEnd = 0;
		for (const s of [...slots].sort((a, b) => a.start.getTime() - b.start.getTime())) {
			if (fit + (perDay.get(dateKey(day)) ?? 0) >= PLAN_RULES.maxBlocksPerDay) break;
			if (s.start.getTime() >= lastEnd) {
				fit++;
				lastEnd = addMinutes(s.start, len + PLAN_RULES.bufferMinutes).getTime();
			}
		}
		room += fit * len;
	}

	const wanted = Math.max(0, input.targetMinutes - alreadyMinutes);
	const count = Math.min(Math.ceil(wanted / len), PLAN_RULES.maxBlocksPerWeek - already.length);
	const chosen: Slot[] = [];
	const taken = (s: Slot) => chosen.some((c) => c.day.getTime() === s.day.getTime() && Math.abs(c.start.getTime() - s.start.getTime()) < (len + PLAN_RULES.bufferMinutes) * 60_000);
	const all = byDay.flat().sort((a, b) => b.score - a.score || a.start.getTime() - b.start.getTime());
	for (const s of all) {
		if (chosen.length >= count) break;
		const k = dateKey(s.day);
		if ((perDay.get(k) ?? 0) >= PLAN_RULES.maxBlocksPerDay || taken(s)) continue;
		// Spread: prefer a new day while days remain, so the week isn't front-loaded.
		chosen.push(s);
		perDay.set(k, (perDay.get(k) ?? 0) + 1);
	}
	chosen.sort((a, b) => a.start.getTime() - b.start.getTime());

	// Focus: a block right after a lecture studies that module's next unit; the rest follow the pacing order.
	const queue = [...input.focus];
	const take = (module?: string) => {
		const i = module ? queue.findIndex((f) => f.module === module) : 0;
		return i >= 0 ? queue.splice(i, 1)[0] : queue.shift();
	};
	const proposals: StudyBlock[] = chosen.map((s, i) => {
		const f = take(s.afterModule) ?? undefined;
		const first = f ? input.firstTask?.(f.lectureId) : undefined;
		return {
			id: input.newId(i),
			date: dateKey(s.day),
			start: formatHM(s.start),
			minutes: len,
			status: "proposed" as const,
			source: "planner" as const,
			...(f ? { lectureId: f.lectureId, module: f.module, reason: f.reason } : {}),
			...(first ? { firstTaskQuestionId: first } : {}),
			...(s.anchor ? { anchorOf: s.anchor } : {}),
			placed: placedOf(s),
		};
	});
	const plannedMinutes = alreadyMinutes + proposals.length * len;
	return { proposals, plannedMinutes, roomMinutes: room, fits: input.targetMinutes <= room };
}

// ─── moving a block from the phone (v2.1 part B) ────────────────────────────

/** A time a block can move to. `next` is the earliest free time of all ("Pick for me: next free gap"). */
export interface MoveTime {
	kind: "today" | "evening" | "tomorrow" | "next";
	date: string;
	start: string;
}

/**
 * Where a block can go when the student says "Not now" (lo-fi task 2):
 * later today, this evening, tomorrow morning, and the next free gap. Only
 * times the planner itself would use: never on a lecture, a commitment,
 * another block or in quiet hours, and never in the past. A kind with no
 * free time is left out; nothing at all means the week has no room.
 */
export function moveTimes(input: { block: Pick<StudyBlock, "id" | "minutes">; now: Date; lectures: readonly Lecture[]; routine?: Pick<Routine, "commitments" | "energy">; quietHours: Profile["prefs"]["quietHours"]; blocks: readonly StudyBlock[] }): MoveTime[] {
	const len = clampBlockMinutes(input.block.minutes);
	const plan: PlanInput = {
		week: input.now, now: input.now, lectures: input.lectures, ...(input.routine ? { routine: { commitments: input.routine.commitments, energy: [] } } : {}), quietHours: input.quietHours,
		targetMinutes: 0, blockMinutes: len, existing: input.blocks.filter((b) => b.id !== input.block.id), lastWeek: [], focus: [], newId: () => "",
	};
	const today = atTime(input.now, "00:00");
	const free: Date[] = [];
	for (let i = 0; i < PLAN_RULES.moveDays; i++) for (const s of slotsOn(addDays(today, i), plan, len, new Set())) free.push(s.start);
	free.sort((a, b) => a.getTime() - b.getTime());
	const todayKey = dateKey(input.now);
	const tomorrowKey = dateKey(addDays(today, 1));
	const evening = parseHM(PLAN_RULES.moveEveningFrom);
	const laterFrom = addMinutes(input.now, PLAN_RULES.moveLaterMinutes);
	const pick = (kind: MoveTime["kind"], d: Date | undefined): MoveTime[] => (d ? [{ kind, date: dateKey(d), start: formatHM(d) }] : []);
	const tomorrow = free.filter((d) => dateKey(d) === tomorrowKey);
	return [
		...pick("today", free.find((d) => dateKey(d) === todayKey && d >= laterFrom && minutesOfDay(d) < evening)),
		...pick("evening", free.find((d) => dateKey(d) === todayKey && minutesOfDay(d) >= evening)),
		...pick("tomorrow", tomorrow.find((d) => minutesOfDay(d) < parseHM(PLAN_RULES.moveMorningUntil)) ?? tomorrow[0]),
		...pick("next", free[0]),
	];
}

/**
 * One free time a day for the days ahead, the one the planner would choose
 * that day (the student's energy first, then the earliest): what "Move to a
 * free gap" and "Add a block" offer on the phone (v2.1 part C). Every block
 * that isn't removed is in the way, suggested ones too.
 */
export function freeTimes(input: { now: Date; lectures: readonly Lecture[]; routine?: Pick<Routine, "commitments" | "energy">; quietHours: Profile["prefs"]["quietHours"]; blocks: readonly StudyBlock[]; minutes: number; days?: number }): { date: string; start: string }[] {
	const len = clampBlockMinutes(input.minutes);
	const busy = input.blocks.filter((b) => b.status !== "removed").map((b) => ({ ...b, status: "accepted" as const }));
	const plan: PlanInput = {
		week: input.now, now: input.now, lectures: input.lectures, ...(input.routine ? { routine: input.routine } : {}), quietHours: input.quietHours,
		targetMinutes: 0, blockMinutes: len, existing: busy, lastWeek: [], focus: [], newId: () => "",
	};
	const today = atTime(input.now, "00:00");
	const out: { date: string; start: string }[] = [];
	for (let i = 0; i < (input.days ?? PLAN_RULES.moveDays); i++) {
		const best = slotsOn(addDays(today, i), plan, len, new Set()).sort((a, b) => b.score - a.score || a.start.getTime() - b.start.getTime())[0];
		if (best) out.push({ date: dateKey(best.start), start: formatHM(best.start) });
	}
	return out;
}

// ─── moving a block by hand (v1.1, V-37) ────────────────────────────────────

export type PlacementProblem = "lecture" | "commitment" | "block" | "quiet" | "past-midnight";

export interface PlacementInput {
	block: Pick<StudyBlock, "id" | "date" | "start" | "minutes">;
	lectures: readonly Lecture[];
	commitments: Routine["commitments"];
	/** The student's other blocks (suggested, accepted or started); removed ones don't take up time. */
	blocks: readonly StudyBlock[];
	quietHours: Profile["prefs"]["quietHours"];
}

/**
 * Why a study block can't go where it was dropped, or null when it can: it
 * must not overlap a lecture or class, a routine commitment or another
 * block, must be inside the student's waking hours, and must end the same
 * day. Touching is fine: a block may start the minute a lecture ends (the
 * planner leaves a gap; a student moving it by hand needn't).
 */
export function placementProblem(input: PlacementInput): PlacementProblem | null {
	const { block } = input;
	const day = new Date(`${block.date}T12:00:00`);
	const start = atTime(day, block.start);
	const end = addMinutes(start, block.minutes);
	if (dateKey(new Date(end.getTime() - 1)) !== block.date) return "past-midnight";
	const overlaps = (s: Date, e: Date) => s < end && e > start;
	for (const l of input.lectures) {
		if (!l.start || !l.end || l.archived) continue;
		if (overlaps(new Date(l.start), new Date(l.end))) return "lecture";
	}
	for (const c of input.commitments) if (c.weekdays.includes(isoWeekday(day)) && overlaps(atTime(day, c.start), atTime(day, c.end))) return "commitment";
	for (const b of input.blocks) {
		if (b.id === block.id || b.status === "removed" || b.date !== block.date) continue;
		const bs = atTime(day, b.start);
		if (overlaps(bs, addMinutes(bs, b.minutes))) return "block";
	}
	const awake = wakingWindow(day, input.quietHours);
	if (start < awake.start || end > awake.end) return "quiet";
	return null;
}
