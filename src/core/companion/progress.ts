/**
 * Forgiving progress (plan §7.8, R-6, INT-01-i): what was done this week and
 * what is ready to revisit. Never "overdue", never a streak, never a red
 * number. After a week away: "Welcome back".
 */

import { openMisses } from "./misses.ts";
import { latestEndedLecture, specFor } from "./nudges.ts";
import { SESSION_COPY, WELCOME_BACK_DAYS } from "./policy.ts";
import { addDays, dateKey, startOfWeek } from "./time.ts";
import { isTimed, type TimedLecture } from "./timetable.ts";
import type { CompanionSession, CompanionState, EventLogEntry, Lecture, Miss, SessionSpec } from "./types.ts";

export type LectureStatus = "answered" | "revisit" | "not-started";

/** `phoneAnswered`: units answered on the phone (v2.3). An answer there is an answer: the unit is no longer "not started". */
export function lectureStatus(lectureId: string, sessions: CompanionSession[], misses: Miss[], phoneAnswered: readonly string[] = []): LectureStatus {
	if (openMisses(misses, lectureId).length > 0) return "revisit";
	return phoneAnswered.includes(lectureId) || sessions.some((s) => s.spec.lectureId === lectureId && s.answered > 0) ? "answered" : "not-started";
}

/**
 * What was answered on the phone on the day of `now` (v2.3 part D): how many
 * questions, and their modules in the order first answered. The day is the
 * one the phone answered on, not the one the laptop heard about it. Right
 * and wrong count the same, and neither is reported (R-6).
 */
export function phoneToday(events: readonly EventLogEntry[], lectures: readonly Pick<Lecture, "id" | "module">[], now: Date): { questions: number; modules: string[] } {
	const today = dateKey(now);
	const moduleOf = new Map(lectures.map((l) => [l.id, l.module]));
	const modules: string[] = [];
	let questions = 0;
	for (const e of events) {
		if (e.type !== "answered" || e.data.source !== "phone") continue;
		const phoneAt = e.data.phoneAt;
		if (dateKey(new Date(typeof phoneAt === "string" && !Number.isNaN(Date.parse(phoneAt)) ? phoneAt : e.t)) !== today) continue;
		questions++;
		const m = typeof e.data.lectureId === "string" ? moduleOf.get(e.data.lectureId) : undefined;
		if (m && !modules.includes(m)) modules.push(m);
	}
	return { questions, modules };
}

export interface LectureWithStatus extends Lecture {
	status: LectureStatus;
	revisit: number;
}

export function lecturesWithStatus(state: Pick<CompanionState, "lectures" | "sessions" | "misses" | "phoneAnswered">): LectureWithStatus[] {
	return state.lectures
		.filter((l) => (l.kind ?? "lecture") === "lecture")
		.map((l) => ({ ...l, status: lectureStatus(l.id, state.sessions, state.misses, state.phoneAnswered), revisit: openMisses(state.misses, l.id).length }));
}

/** Course order per module (the roadmap, INT-01-e). */
export function roadmap(state: Pick<CompanionState, "lectures" | "sessions" | "misses" | "phoneAnswered">): Record<string, LectureWithStatus[]> {
	const out: Record<string, LectureWithStatus[]> = {};
	for (const l of lecturesWithStatus(state)) (out[l.module] ??= []).push(l);
	for (const list of Object.values(out)) list.sort((a, b) => a.order - b.order);
	return out;
}

export function lastActivity(sessions: CompanionSession[]): Date | null {
	let latest: number | null = null;
	for (const s of sessions) {
		for (const t of [s.openedAt, s.lastActivityAt, s.endedAt]) {
			if (!t) continue;
			const ms = new Date(t).getTime();
			if (latest === null || ms > latest) latest = ms;
		}
	}
	return latest === null ? null : new Date(latest);
}

export interface WelcomeBack {
	text: string;
	spec: SessionSpec;
	daysAway: number;
}

/** After WELCOME_BACK_DAYS+ away, offer 3 questions on last week. Nothing has decayed. */
export function welcomeBack(state: CompanionState, now: Date): WelcomeBack | null {
	const last = lastActivity(state.sessions);
	if (!last) return null;
	const daysAway = Math.floor((now.getTime() - last.getTime()) / 86_400_000);
	if (daysAway < WELCOME_BACK_DAYS) return null;
	const lastWeekStart = addDays(startOfWeek(now), -7);
	const candidates = state.lectures.filter((l): l is TimedLecture => isTimed(l) && l.hasMaterials && (l.kind ?? "lecture") === "lecture" && new Date(l.end) <= now);
	const lecture =
		candidates.filter((l) => new Date(l.start) >= lastWeekStart).sort((a, b) => b.end.localeCompare(a.end))[0] ??
		latestEndedLecture(state.lectures, now);
	if (!lecture) return null;
	return { text: SESSION_COPY.welcomeBack(), spec: specFor("try-now", lecture.id, state.profile?.prefs), daysAway };
}

export interface WeekSummary {
	sessions: number;
	questionsAnswered: number;
	readyToRevisit: number;
}

export function weekSummary(state: CompanionState, now: Date): WeekSummary {
	const weekStart = startOfWeek(now);
	const thisWeek = state.sessions.filter((s) => s.openedAt && new Date(s.openedAt) >= weekStart);
	return {
		sessions: thisWeek.filter((s) => s.answered > 0).length,
		questionsAnswered: thisWeek.reduce((n, s) => n + s.answered, 0),
		readyToRevisit: openMisses(state.misses).length,
	};
}

/** J1's "Try it now" card: the most recent lecture with material, else the first one in course order. */
export function tryNowLecture(state: Pick<CompanionState, "lectures">, now: Date): Lecture | undefined {
	return (
		latestEndedLecture(state.lectures, now) ??
		state.lectures.filter((l) => l.hasMaterials && (l.kind ?? "lecture") === "lecture").sort((a, b) => a.order - b.order)[0]
	);
}

/** Lecture search over titles and slide titles (INT-01-f). */
export function searchLectures(lectures: Lecture[], query: string, slideTitles: (id: string) => string[]): Lecture[] {
	const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (terms.length === 0) return lectures;
	return lectures.filter((l) => {
		const haystack = [l.title, l.module, ...slideTitles(l.id)].join(" ").toLowerCase();
		return terms.every((t) => haystack.includes(t));
	});
}
