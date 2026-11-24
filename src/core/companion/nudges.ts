/**
 * The nudge engine (plan §7.6): pure functions over CompanionState and a
 * clock time. No IO, so every rule is table-testable
 * (tests/companion-nudges.test.ts).
 *
 *   nudgeCandidates(state, now)   every nudge whose slot is open today
 *   dueNudges(state, now)         what fires now: global rules, readiness, priority (max 1)
 *   prewarmCandidates(state, now) what to prepare now so question 1 is ready on tap (§6.3)
 *   forcedCandidate(...)          the facilitator's "fire now", outside the rules
 *
 * Global rules, in order (§7.6):
 *   1. never inside a timetabled event or study block (a block's own start
 *      nudge excepted), never in quiet hours;
 *   2. daily cap = prefs.nudgesPerDay; N-4 never counts (R-5), blocks per
 *      NUDGE_RULES.blockCountsTowardCap (open decision 6);
 *   3. N-2 only when N-1 has not fired today (and none is still due today);
 *   4. priority: block, N-4, N-1, N-3, N-2; one at a time;
 *   5. no nudge text references an ignored nudge.
 */

import { NUDGE_RULES, NUDGE_TEXT, SCHEDULE_RULES, SESSION_BUDGETS, WHY_TEXT } from "./policy.ts";
import {
	addDays,
	addMinutes,
	atTime,
	dateKey,
	formatHM,
	inQuietHours,
	isoWeekday,
	minutesBetween,
	sameDay,
	wakingWindow,
	weekdayName,
} from "./time.ts";
import { isTimed, type TimedLecture } from "./timetable.ts";
import { pacedUnits, type UnitStatus } from "./plan-week.ts";
import type {
	CompanionSession,
	CompanionState,
	Lecture,
	Miss,
	NudgeCandidate,
	NudgeType,
	Profile,
	SessionKind,
	SessionSpec,
	StudyBlock,
} from "./types.ts";

// ─── specs and goals ────────────────────────────────────────────────────────

export function specFor(
	kind: SessionKind,
	lectureId: string,
	prefs: Pick<Profile["prefs"], "defaultMode"> | undefined,
	missIds?: string[],
): SessionSpec {
	const mode = kind === "missed-lecture" ? "show-first" : kind === "retest" ? "question-first" : (prefs?.defaultMode ?? "question-first");
	return {
		kind,
		lectureId,
		mode,
		budget: { ...SESSION_BUDGETS[kind] },
		...(missIds && missIds.length > 0 ? { missIds: [...missIds] } : {}),
	};
}

/**
 * The kind of session a nudge opens. N-4 returns to a session that already
 * exists, whose own budget the session screen shows; for the Today card it
 * counts as a post-lecture session.
 */
export function sessionKindForNudge(type: NudgeType): SessionKind {
	switch (type) {
		case "N-2":
			return "retest";
		case "N-3":
			return "missed-lecture";
		case "block":
			return "block";
		default:
			return "post-lecture";
	}
}

/** The goal line on the session screen (R-4: the goal is on screen). */
export function goalFor(spec: SessionSpec, lecture: Pick<Lecture, "title">, budget = spec.budget.questions): string {
	const minutes = Math.round((spec.budget.minutes * budget) / Math.max(1, spec.budget.questions));
	if (spec.kind === "retest") return `${budget} questions on what you missed, about ${minutes} minutes`;
	if (spec.kind === "missed-lecture" && spec.budget.parts)
		return `${lecture.title} in ${spec.budget.parts} short pieces, about ${spec.budget.minutes} minutes`;
	return `${budget} questions on ${lecture.title}, about ${minutes} minutes`;
}

// ─── the timetable as intervals ─────────────────────────────────────────────

export interface Commitment {
	id: string;
	kind: "lecture" | "event" | "block";
	start: Date;
	end: Date;
}

/** A block is a commitment on its own date once accepted (or started); proposals and removed blocks aren't (F-110). */
export function blockOccursOn(block: StudyBlock, day: Date): boolean {
	return block.date === dateKey(day) && (block.status === "accepted" || block.status === "started");
}

/** Every timetabled event and study block on the given local day, by start. */
export function commitmentsOn(state: Pick<CompanionState, "lectures" | "blocks">, day: Date): Commitment[] {
	const out: Commitment[] = [];
	for (const l of state.lectures) {
		if (!isTimed(l)) continue;
		const start = new Date(l.start);
		if (sameDay(start, day)) out.push({ id: l.id, kind: l.kind ?? "lecture", start, end: new Date(l.end) });
	}
	for (const b of state.blocks) {
		if (!blockOccursOn(b, day)) continue;
		const start = atTime(day, b.start);
		out.push({ id: b.id, kind: "block", start, end: addMinutes(start, b.minutes) });
	}
	return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** The commitment `now` falls inside, if any. */
export function commitmentAt(state: Pick<CompanionState, "lectures" | "blocks">, now: Date): Commitment | null {
	return commitmentsOn(state, now).find((c) => c.start <= now && now < c.end) ?? null;
}

/** Free gaps of a day inside the waking window (outside quiet hours). */
export function freeGapsOn(
	state: Pick<CompanionState, "lectures" | "blocks">,
	day: Date,
	quiet: Profile["prefs"]["quietHours"],
): { start: Date; end: Date }[] {
	const { start: wake, end: sleep } = wakingWindow(day, quiet);
	const gaps: { start: Date; end: Date }[] = [];
	let cursor = wake;
	for (const c of commitmentsOn(state, day)) {
		if (c.end <= cursor) continue;
		if (c.start > cursor) gaps.push({ start: cursor, end: c.start < sleep ? c.start : sleep });
		if (c.end > cursor) cursor = c.end;
		if (cursor >= sleep) break;
	}
	if (cursor < sleep) gaps.push({ start: cursor, end: sleep });
	return gaps.filter((g) => g.end > g.start);
}

/** The free gap containing `now`, or null when now is busy or quiet. */
export function freeGapAt(state: CompanionState, now: Date): { start: Date; end: Date } | null {
	if (!state.profile) return null;
	return freeGapsOn(state, now, state.profile.prefs.quietHours).find((g) => g.start <= now && now < g.end) ?? null;
}

/** The start of the next commitment at or after t on t's day, else the start of quiet hours. */
function nextCommitmentStart(state: CompanionState, t: Date): Date {
	const quiet = state.profile?.prefs.quietHours ?? { from: "22:00", to: "08:00" };
	const sleep = wakingWindow(t, quiet).end;
	const next = commitmentsOn(state, t).find((c) => c.start >= t);
	return next && next.start < sleep ? next.start : sleep;
}

// ─── helpers over records ───────────────────────────────────────────────────

function sessionForKey(state: CompanionState, key: string): CompanionSession | undefined {
	return state.sessions.filter((s) => s.nudgeKey === key).at(-1);
}

function firedWithKey(state: CompanionState, key: string): boolean {
	return state.nudges.some((n) => n.key === key);
}

function firedToday(state: CompanionState, now: Date, type?: NudgeType) {
	return state.nudges.filter((n) => sameDay(n.firedAt, now) && (type === undefined || n.type === type));
}

const LIVE_STATES = new Set(["preparing", "ready", "active"]);

export function isSessionReady(s: CompanionSession | undefined): boolean {
	return !!s && (s.state === "ready" || s.state === "active" || s.state === "done");
}

/** An N-1 for this lecture would make sense: a timetabled lecture the student was at, with something to study after it. */
function n1Eligible(l: Lecture, state?: Pick<CompanionState, "lectures">): l is TimedLecture {
	if (!isTimed(l) || (l.kind ?? "lecture") !== "lecture" || l.attended === false) return false;
	return l.hasMaterials || (!!state && state.lectures.some((u) => u.module === l.module && u.hasMaterials && !u.archived));
}

/**
 * What an N-1 after this lecture teaches (V-18, spec §5.5): the lecture's own
 * material when it has some; otherwise the module's current-week unit by the
 * pacing rule, so it works whether or not slides were attached to that slot.
 */
export function n1Target(state: CompanionState, l: Lecture, now: Date): string {
	if (l.hasMaterials) return l.id;
	const mod = state.profile?.modules.find((m) => m.code === l.module) ?? { code: l.module };
	const status = (id: string): UnitStatus["status"] =>
		state.misses.some((m) => m.lectureId === id && m.status === "open") ? "revisit" : state.sessions.some((s) => s.spec.lectureId === id && s.state === "done") ? "answered" : "not-started";
	const units: UnitStatus[] = state.lectures.filter((u) => u.module === l.module && u.hasMaterials && !u.archived).map((u) => ({ id: u.id, module: u.module, week: u.week, order: u.order, hasMaterials: true, status: status(u.id) }));
	const [first] = pacedUnits({ modules: [mod], units, now, blocks: 1 });
	return first?.lectureId ?? units.sort((a, b) => b.week - a.week || b.order - a.order)[0]?.id ?? l.id;
}

/** "you're free until 15:00" from a free gap's end, or null at the end of the day. */
function untilText(state: CompanionState, end: Date): string | null {
	const quiet = state.profile?.prefs.quietHours ?? { from: "22:00", to: "08:00" };
	return end.getTime() >= wakingWindow(end, quiet).end.getTime() ? null : formatHM(end);
}

/** The most recent lecture with material that has ended (the default focus). */
export function latestEndedLecture(lectures: Lecture[], now: Date): Lecture | undefined {
	return lectures
		.filter((l): l is TimedLecture => isTimed(l) && (l.kind ?? "lecture") === "lecture" && l.hasMaterials && new Date(l.end) <= now)
		.sort((a, b) => new Date(b.end).getTime() - new Date(a.end).getTime())[0];
}

// ─── candidate builders ─────────────────────────────────────────────────────

function n1Candidate(state: CompanionState, l: Lecture, at?: Date): NudgeCandidate {
	// A forced N-1 may name an untimed course unit (V-18): it fires at `at`.
	const end = new Date(l.end ?? at ?? 0);
	const target = n1Target(state, l, at ?? end);
	const spec = specFor("post-lecture", target, state.profile?.prefs);
	return {
		type: "N-1",
		key: at ? `forced:N-1:${l.id}:${at.getTime()}` : `N-1:${l.id}`,
		text: NUDGE_TEXT.n1(l.module, spec.budget.questions, spec.budget.minutes),
		why: WHY_TEXT.afterLecture(l.module, l.end ? untilText(state, nextCommitmentStart(state, end)) : null),
		spec,
		lectureId: target,
		prepareFrom: (at ?? end).toISOString(),
		fireAt: (at ?? addMinutes(end, NUDGE_RULES.n1DelayMinutes)).toISOString(),
		fireBy: (at ?? addMinutes(end, NUDGE_RULES.n1FireByMinutes)).toISOString(),
	};
}

function n2Candidate(state: CompanionState, misses: Miss[], slot: Date, key: string, forced = false): NudgeCandidate {
	const spec = specFor("retest", misses[0]!.lectureId, state.profile?.prefs, misses.map((m) => m.id));
	return {
		type: "N-2",
		key,
		text: NUDGE_TEXT.n2(weekdayName(misses[0]!.createdAt), spec.budget.questions, spec.budget.minutes),
		spec,
		lectureId: misses[0]!.lectureId,
		prepareFrom: slot.toISOString(),
		fireAt: slot.toISOString(),
		fireBy: (forced ? slot : addMinutes(slot, NUDGE_RULES.fireGraceMinutes)).toISOString(),
	};
}

function n3Candidate(state: CompanionState, l: Lecture, slot: Date, forced = false): NudgeCandidate {
	return {
		type: "N-3",
		key: forced ? `forced:N-3:${l.id}:${slot.getTime()}` : `N-3:${l.id}`,
		text: NUDGE_TEXT.n3(weekdayName(l.start ?? slot.toISOString())),
		spec: specFor("missed-lecture", l.id, state.profile?.prefs),
		lectureId: l.id,
		prepareFrom: (forced ? slot : addMinutes(slot, -NUDGE_RULES.n3PrepareLeadMinutes)).toISOString(),
		fireAt: slot.toISOString(),
		fireBy: (forced ? slot : addMinutes(slot, NUDGE_RULES.fireGraceMinutes)).toISOString(),
	};
}

function n4Candidate(session: CompanionSession, snoozedId: string, at: Date, forced = false): NudgeCandidate {
	const left = Math.max(1, session.budget - session.answered);
	const perQuestion = session.spec.budget.minutes / Math.max(1, session.spec.budget.questions);
	return {
		type: "N-4",
		key: forced ? `forced:N-4:${snoozedId}:${at.getTime()}` : `N-4:${snoozedId}`,
		text: NUDGE_TEXT.n4(left, Math.max(1, Math.ceil(left * perQuestion))),
		spec: session.spec,
		lectureId: session.spec.lectureId,
		sessionId: session.id,
		returnOf: snoozedId,
		prepareFrom: at.toISOString(),
		fireAt: at.toISOString(),
		fireBy: at.toISOString(),
	};
}

function blockCandidate(state: CompanionState, b: StudyBlock, start: Date, now: Date, forced = false): NudgeCandidate | null {
	const focus = b.lectureId ?? latestEndedLecture(state.lectures, now)?.id ?? state.lectures.find((l) => l.hasMaterials)?.id;
	if (!focus) return null;
	return {
		type: "block",
		key: forced ? `forced:block:${b.id}:${start.getTime()}` : `block:${b.id}:${dateKey(start)}`,
		text: NUDGE_TEXT.block(b.minutes),
		spec: specFor("block", focus, state.profile?.prefs),
		lectureId: focus,
		prepareFrom: start.toISOString(),
		fireAt: start.toISOString(),
		fireBy: start.toISOString(),
	};
}

// ─── per-type rules ─────────────────────────────────────────────────────────

/** N-1: a lecture with material ended today, ≥ 45 min free after it, the
 *  student was there, and no N-1 yet today. Valid until the next commitment. */
function postLectureCandidates(state: CompanionState, now: Date): NudgeCandidate[] {
	if (firedToday(state, now, "N-1").length > 0) return [];
	const out: NudgeCandidate[] = [];
	for (const l of state.lectures) {
		if (!n1Eligible(l, state)) continue;
		const end = new Date(l.end);
		if (!sameDay(end, now) || end > now) continue;
		const gapEnd = nextCommitmentStart(state, end);
		if (minutesBetween(end, gapEnd) < NUDGE_RULES.n1MinGapMinutes || now >= gapEnd) continue;
		if (minutesBetween(end, now) >= NUDGE_RULES.n1ValidMinutes) continue;
		const key = `N-1:${l.id}`;
		if (firedWithKey(state, key)) continue;
		// Already studying this lecture since it ended: no need to nudge.
		const studying = state.sessions.some(
			(s) => s.spec.lectureId === l.id && s.nudgeKey !== key && s.openedAt && new Date(s.openedAt) >= end,
		);
		if (studying) continue;
		out.push(n1Candidate(state, l));
	}
	// Most recently ended first.
	return out.sort((a, b) => b.prepareFrom.localeCompare(a.prepareFrom)).slice(0, 1);
}

/** Is an N-1 still expected later today? N-2 must not spend the cap first. */
function n1ExpectedLater(state: CompanionState, now: Date): boolean {
	if (firedToday(state, now, "N-1").length > 0) return false;
	return state.lectures.some((l) => {
		// With the state: a lecture whose module has material in course units earns an N-1 too (V-18). Without it,
		// a retest in the morning spent the day's one notification before the lecture had even started (v1.0.4).
		if (!n1Eligible(l, state)) return false;
		const end = new Date(l.end);
		if (!sameDay(end, now)) return false;
		// A lecture that has just ended still has its N-1 to come (it waits n1DelayMinutes), until it has fired or its
		// hour has passed. Without this, a retest due at the minute the lecture ended went out first (v1.0.4).
		if (end <= now && (minutesBetween(end, now) >= NUDGE_RULES.n1ValidMinutes || firedWithKey(state, `N-1:${l.id}`))) return false;
		return minutesBetween(end, nextCommitmentStart(state, end)) >= NUDGE_RULES.n1MinGapMinutes;
	});
}

/** N-2: misses are due, a free gap with ≥ 30 min left, and no N-1 today. */
function retestCandidates(state: CompanionState, now: Date): NudgeCandidate[] {
	if (firedToday(state, now, "N-1").length > 0 || n1ExpectedLater(state, now)) return [];
	const key = `N-2:${dateKey(now)}`;
	if (firedWithKey(state, key)) return [];
	const due = dueMissesForRetest(state.misses, now);
	if (due.length === 0) return [];
	const gap = freeGapAt(state, now);
	if (!gap || minutesBetween(now, gap.end) < NUDGE_RULES.n2MinGapMinutes) return [];
	return [n2Candidate(state, due, gap.start, key)];
}

/** Up to `budget` open, due misses from one lecture (the one whose miss is most overdue). */
export function dueMissesForRetest(misses: Miss[], now: Date, includeNotDue = false): Miss[] {
	const open = misses
		.filter((m) => m.status === "open" && (includeNotDue || new Date(m.nextDue) <= now))
		.sort((a, b) => a.nextDue.localeCompare(b.nextDue) || a.createdAt.localeCompare(b.createdAt));
	if (open.length === 0) return [];
	const lectureId = open[0]!.lectureId;
	return open.filter((m) => m.lectureId === lectureId).slice(0, SESSION_BUDGETS.retest.questions);
}

/** N-3: a lecture marked missed in the last week, with slides; at most once a week; evening slot. */
function missedLectureCandidates(state: CompanionState, now: Date): NudgeCandidate[] {
	const profile = state.profile;
	if (!profile) return [];
	const cooldownStart = addDays(now, -NUDGE_RULES.n3CooldownDays);
	if (state.nudges.some((n) => n.type === "N-3" && new Date(n.firedAt) > cooldownStart)) return [];
	const slot = atTime(now, profile.prefs.eveningTime);
	if (now < addMinutes(slot, -NUDGE_RULES.n3PrepareLeadMinutes)) return [];
	if (now >= wakingWindow(now, profile.prefs.quietHours).end) return [];
	const lookback = addDays(now, -NUDGE_RULES.n3LookbackDays);
	const missed = state.lectures
		.filter((l): l is TimedLecture => {
			if (!isTimed(l) || (l.kind ?? "lecture") !== "lecture" || l.attended !== false || !l.hasMaterials) return false;
			const end = new Date(l.end);
			if (end > now || end < lookback) return false;
			if (firedWithKey(state, `N-3:${l.id}`)) return false;
			return !state.sessions.some((s) => s.spec.lectureId === l.id && s.state === "done");
		})
		.sort((a, b) => b.end.localeCompare(a.end));
	const l = missed[0];
	return l ? [n3Candidate(state, l, slot)] : [];
}

/** When a snoozed nudge comes back: the next free gap ≥ 15 min starting at
 *  least an hour later today, else the same time tomorrow (behaviour-change §5, N-4). */
export function snoozeReturnTime(state: CompanionState, snoozedAt: Date): Date {
	const quiet = state.profile?.prefs.quietHours ?? { from: "22:00", to: "08:00" };
	const earliest = addMinutes(snoozedAt, NUDGE_RULES.snoozeMinDelayMinutes);
	for (const gap of freeGapsOn(state, snoozedAt, quiet)) {
		const start = gap.start > earliest ? gap.start : earliest;
		if (minutesBetween(start, gap.end) >= NUDGE_RULES.snoozeMinGapMinutes) return start;
	}
	// Tomorrow at the same point; if that is busy, the first free moment after it.
	const tomorrow = addDays(snoozedAt, 1);
	for (const gap of freeGapsOn(state, tomorrow, quiet)) {
		if (gap.end <= tomorrow) continue;
		return gap.start > tomorrow ? gap.start : tomorrow;
	}
	return tomorrow;
}

/** N-4: a snoozed nudge returns at its return time, resuming the same session. */
function snoozeReturnCandidates(state: CompanionState, now: Date): NudgeCandidate[] {
	const out: NudgeCandidate[] = [];
	for (const n of state.nudges) {
		if (n.outcome !== "snoozed" || !n.sessionId || !n.outcomeAt) continue;
		if (firedWithKey(state, `N-4:${n.id}`)) continue;
		const session = state.sessions.find((s) => s.id === n.sessionId);
		if (!session || !LIVE_STATES.has(session.state) || session.answered >= session.budget) continue;
		const at = snoozeReturnTime(state, new Date(n.outcomeAt));
		const until = state.profile ? wakingWindow(at, state.profile.prefs.quietHours).end : addMinutes(at, 120);
		if (now < at || now >= until) continue;
		out.push(n4Candidate(session, n.id, at));
	}
	return out.slice(0, 1);
}

/** Study block start: the block screen, within 10 minutes of its start. */
function blockCandidates(state: CompanionState, now: Date): NudgeCandidate[] {
	const out: NudgeCandidate[] = [];
	for (const b of state.blocks) {
		if (!blockOccursOn(b, now)) continue;
		const start = atTime(now, b.start);
		if (now < start || now >= addMinutes(start, NUDGE_RULES.fireGraceMinutes)) continue;
		const c = blockCandidate(state, b, start, now);
		if (c && !firedWithKey(state, c.key)) out.push(c);
	}
	return out;
}

// ─── composition ────────────────────────────────────────────────────────────

const PRIORITY: Record<NudgeType, number> = { block: 0, "N-4": 1, "N-1": 2, "N-5": 3, "N-3": 4, "N-2": 5 };

/**
 * N-5 (F-111, F-114): once on Sunday at the student's chosen time, when a
 * weekly target is set; opens the check-in. Counts as that day's nudge.
 */
function sundayCandidates(state: CompanionState, now: Date): NudgeCandidate[] {
	const plan = state.profile?.plan;
	if (!plan?.weeklyTargetMinutes || isoWeekday(now) !== 7) return [];
	const at = atTime(now, plan.sundayTime || "19:00");
	if (now < at || minutesBetween(at, now) > NUDGE_RULES.bannerTtlMinutes) return [];
	const key = `N-5:${dateKey(now)}`;
	if (firedWithKey(state, key)) return [];
	return [n5Candidate(state, at, key)];
}

function n5Candidate(state: CompanionState, at: Date, key: string): NudgeCandidate {
	const monday = addDays(atTime(at, "00:00"), 8 - isoWeekday(at));
	const quiet = state.profile?.prefs.quietHours ?? { from: "22:00", to: "08:00" };
	let lectures = 0;
	let gaps = 0;
	for (let i = 0; i < 7; i++) {
		const day = addDays(monday, i);
		lectures += state.lectures.filter((l) => isTimed(l) && (l.kind ?? "lecture") === "lecture" && sameDay(l.start, day)).length;
		gaps += freeGapsOn(state, day, quiet).filter((g) => minutesBetween(g.start, g.end) >= (state.profile?.plan?.blockMinutes ?? 50)).length;
	}
	return {
		type: "N-5",
		key,
		text: NUDGE_TEXT.n5(lectures, gaps),
		why: WHY_TEXT.sunday,
		spec: specFor("block", "", state.profile?.prefs),
		opens: "checkin",
		prepareFrom: at.toISOString(),
		fireAt: at.toISOString(),
		fireBy: at.toISOString(),
	};
}

/** Every nudge whose slot is open now, before the global rules. Each carries
 *  the id of its pre-warmed session when one exists. */
export function nudgeCandidates(state: CompanionState, now: Date): NudgeCandidate[] {
	if (!state.profile) return [];
	const all = [
		...blockCandidates(state, now),
		...snoozeReturnCandidates(state, now),
		...postLectureCandidates(state, now),
		...missedLectureCandidates(state, now),
		...retestCandidates(state, now),
		...sundayCandidates(state, now),
	];
	return all
		.map((c) => (c.sessionId ? c : { ...c, sessionId: sessionForKey(state, c.key)?.id }))
		.sort((a, b) => PRIORITY[a.type] - PRIORITY[b.type]);
}

function countsTowardCap(type: NudgeType): boolean {
	if (type === "N-4") return false; // R-5: a deferred notification is not a spent one
	if (type === "block") return NUDGE_RULES.blockCountsTowardCap;
	return true;
}

function capReached(state: CompanionState, now: Date): boolean {
	const cap = Math.min(NUDGE_RULES.maxPerDay, state.profile?.prefs.nudgesPerDay ?? 1);
	return firedToday(state, now).filter((n) => countsTowardCap(n.type)).length >= cap;
}

function passesGlobalRules(state: CompanionState, now: Date, c: NudgeCandidate): boolean {
	const profile = state.profile;
	if (!profile) return false;
	if (inQuietHours(now, profile.prefs.quietHours)) return false;
	// 0 a day (F-114): laptop and phone are silent; the student starts from Today.
	if (profile.prefs.nudgesPerDay === 0) return false;
	const busy = commitmentAt(state, now);
	if (busy && !(c.type === "block" && busy.kind === "block")) return false;
	if (countsTowardCap(c.type) && capReached(state, now)) return false;
	return true;
}

/** What fires now: at most one candidate, after the global rules and readiness. `assumeReady` plans ahead (scheduleWeek). */
export function dueNudges(state: CompanionState, now: Date, opts: { assumeReady?: boolean } = {}): NudgeCandidate[] {
	return nudgeCandidates(state, now)
		.filter((c) => now >= new Date(c.fireAt))
		.filter((c) => {
			const session = c.sessionId ? state.sessions.find((s) => s.id === c.sessionId) : undefined;
			return opts.assumeReady || c.type === "N-4" || c.type === "block" || c.type === "N-5" || isSessionReady(session) || now >= new Date(c.fireBy);
		})
		.filter((c) => passesGlobalRules(state, now, c))
		.slice(0, 1);
}

/** Sessions to start preparing now, so question 1 is waiting when the nudge is tapped. */
export function prewarmCandidates(state: CompanionState, now: Date): NudgeCandidate[] {
	const profile = state.profile;
	if (!profile || inQuietHours(now, profile.prefs.quietHours) || profile.prefs.nudgesPerDay === 0) return [];
	const preparedToday = state.sessions.filter((s) => s.nudgeKey && sameDay(s.createdAt, now)).length;
	const room = NUDGE_RULES.maxPrewarmPerDay - preparedToday;
	if (room <= 0) return [];
	return nudgeCandidates(state, now)
		.filter((c) => c.type !== "N-4" && c.type !== "block" && c.type !== "N-5" && !c.sessionId)
		.filter((c) => !capReached(state, now))
		.slice(0, room);
}

/** The facilitator's "fire now" (§7.10): build a nudge of the given type
 *  outside the timing rules. Returns a reason string when nothing fits. */
export function forcedCandidate(
	state: CompanionState,
	now: Date,
	type: NudgeType,
	opts: { lectureId?: string } = {},
): NudgeCandidate | string {
	const pick = (pred: (l: Lecture) => boolean) =>
		opts.lectureId ? state.lectures.find((l) => l.id === opts.lectureId) : state.lectures.filter((l): l is TimedLecture => isTimed(l) && pred(l)).sort((a, b) => b.end.localeCompare(a.end))[0];
	switch (type) {
		case "N-1": {
			const l = pick((l) => n1Eligible(l) && new Date(l.end!) <= now) ?? state.lectures.find((l) => l.hasMaterials);
			return l ? n1Candidate(state, l, now) : "no lecture with materials";
		}
		case "N-2": {
			const misses = dueMissesForRetest(state.misses, now, true);
			return misses.length > 0 ? n2Candidate(state, misses, now, `forced:N-2:${now.getTime()}`, true) : "no open misses to retest";
		}
		case "N-3": {
			const l =
				pick((l) => l.attended === false && l.hasMaterials && new Date(l.end!) <= now) ??
				latestEndedLecture(state.lectures, now) ??
				state.lectures.find((l) => l.hasMaterials);
			return l ? n3Candidate(state, l, now, true) : "no lecture with materials";
		}
		case "N-4": {
			const snoozed = [...state.nudges].reverse().find((n) => {
				const s = n.sessionId ? state.sessions.find((x) => x.id === n.sessionId) : undefined;
				return n.outcome === "snoozed" && s && LIVE_STATES.has(s.state);
			});
			const session = snoozed && state.sessions.find((s) => s.id === snoozed.sessionId);
			return snoozed && session ? n4Candidate(session, snoozed.id, now, true) : "no snoozed nudge with a live session";
		}
		case "block": {
			const block: StudyBlock = state.blocks.find((b) => blockOccursOn(b, now)) ?? { id: "demo-block", date: dateKey(now), start: "00:00", minutes: 25, status: "accepted", source: "student" };
			return blockCandidate(state, block, now, now, true) ?? "no lecture to focus the block on";
		}
		case "N-5":
			return n5Candidate(state, now, `forced:N-5:${now.getTime()}`);
	}
}

// ─── the week ahead for the phone (F-112, F-114) ───────────────────────────

/** A question as the phone shows it: everything needed with no network call at tap time (spec §5.2). */
export interface NudgeQuestion {
	id: string;
	lectureId: string;
	stem: string;
	options: [string, string, string];
	correct: 0 | 1 | 2;
	explanation: string;
	slides: number[];
}

export interface ScheduledNudge {
	/** The nudge's key: stable, so a re-upload of the same plan is the same nudge. */
	id: string;
	fireAt: string;
	kind: NudgeType;
	title: string;
	/** ≤ 90 characters (a notification body). */
	body: string;
	why?: string;
	lectureId?: string;
	/** N-1: the module whose lecture just ended ("HCI"). */
	module?: string;
	opens: "session" | "checkin" | "question";
	question?: NudgeQuestion;
	/** The phone's "later" fires this (counted when the laptop planned it, R-5). */
	snoozeFireAt: string;
	expiresAt: string;
}

/**
 * The next `days` days of nudges, planned with the same rules as the live
 * tick (cap, quiet hours, priorities, busy times): simulate the clock in
 * SCHEDULE_RULES.stepMinutes steps, assuming each session is ready on
 * time, and record each nudge as fired so the cap holds across the week.
 * N-1 carries a bank question when one is ready (N-1 v2); `questionFor`
 * returns one for a unit, skipping ids already used.
 */
export function scheduleWeek(
	state: CompanionState,
	now: Date,
	opts: { questionFor?: (lectureId: string, used: ReadonlySet<string>) => NudgeQuestion | undefined; days?: number } = {},
): ScheduledNudge[] {
	if (!state.profile || state.profile.prefs.nudgesPerDay === 0) return [];
	const step = SCHEDULE_RULES.stepMinutes;
	const start = new Date(Math.ceil(now.getTime() / (step * 60_000)) * step * 60_000);
	const end = addDays(now, opts.days ?? SCHEDULE_RULES.days);
	const sim: CompanionState = { ...state, nudges: [...state.nudges] };
	const used = new Set(state.nudges.map((n) => n.questionId).filter((q): q is string => !!q));
	const out: ScheduledNudge[] = [];
	for (let t = start; t < end; t = addMinutes(t, step)) {
		const [c] = dueNudges(sim, t, { assumeReady: true });
		if (!c || c.type === "N-4") continue;
		const unitModule = state.lectures.find((l) => l.id === c.lectureId)?.module;
		const question = c.type === "N-1" && c.lectureId ? opts.questionFor?.(c.lectureId, used) : undefined;
		if (question) used.add(question.id);
		const lectureModule = c.key.startsWith("N-1:") ? state.lectures.find((l) => `N-1:${l.id}` === c.key)?.module : unitModule;
		out.push({
			id: c.key,
			fireAt: t.toISOString(),
			kind: c.type,
			title: question && lectureModule ? NUDGE_TEXT.n1Title(lectureModule) : c.type === "N-5" ? NUDGE_TEXT.n5Title : "LockedIn",
			body: question ? question.stem : c.text,
			...(c.why ? { why: c.why } : {}),
			...(c.lectureId ? { lectureId: c.lectureId } : {}),
			...(c.type === "N-1" && lectureModule ? { module: lectureModule } : {}),
			opens: question ? "question" : c.opens === "checkin" ? "checkin" : "session",
			...(question ? { question } : {}),
			snoozeFireAt: snoozeReturnTime(sim, t).toISOString(),
			expiresAt: addMinutes(t, NUDGE_RULES.bannerTtlMinutes).toISOString(),
		});
		sim.nudges.push({ id: `sched-${out.length}`, type: c.type, key: c.key, firedAt: t.toISOString(), text: c.text, ...(c.lectureId ? { lectureId: c.lectureId } : {}) });
	}
	return out;
}
