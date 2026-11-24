/**
 * The learning score (v1.1, V-34): one number that builds up as you learn,
 * worked out from the history the app already keeps. Pure: the server hands
 * in the event log, the study blocks and what each question is about.
 *
 * - A right answer earns points, more for a harder question.
 * - The first right answer on an idea secures it; a right answer on an
 *   idea waiting in "to revisit" brings it back. Both earn a bonus.
 * - A wrong answer or "I don't know" earns nothing and loses nothing.
 * - Starting a planned study block earns a little.
 * - An idea secured and not got right again for SCORE_RULES.fadeAfterDays
 *   is fading: the score dips by fadePoints until one right answer.
 *
 * The same replay gives the chart's series, what each module contributed,
 * the steady-pace line and what happened on each day.
 */

import { SCORE_RULES } from "./policy.ts";
import { addDays, dateKey, startOfDay, startOfWeek } from "./time.ts";
import type { EventLogEntry, Lecture, StudyBlock } from "./types.ts";

/** What a question is about, when the study pack knows it. */
export interface QuestionInfo {
	difficulty?: number;
	nodeId?: string;
}

/** One idea in a study pack: the steady-pace target counts them, and "a whole unit secured" needs them. */
export interface PackIdea {
	lectureId: string;
	nodeId: string;
	title: string;
}

export interface ScoreInput {
	events: readonly EventLogEntry[];
	blocks: readonly StudyBlock[];
	lectures: readonly Pick<Lecture, "id" | "module" | "title">[];
	ideas: readonly PackIdea[];
	questionInfo: (questionId: string, lectureId: string) => QuestionInfo | undefined;
	now: Date;
}

export type GainKind = "right" | "secured" | "came-back" | "block";

/** One thing that earned points (or, for an answer that earned none, that happened). */
export interface ScoredMoment {
	at: Date;
	kind: "answer" | "block";
	points: number;
	module: string;
	lectureId: string | null;
	/** `${lectureId}#${nodeId}`: the idea an answer was about. */
	ideaKey: string | null;
	correct?: boolean;
	secured?: boolean;
	cameBack?: boolean;
	source?: "phone";
	/** Minutes this moment stands for: time on the question, or the block's length. */
	minutes: number;
}

export interface IdeaState {
	key: string;
	lectureId: string;
	nodeId: string;
	module: string;
	secured: boolean;
	securedAt: Date | null;
	lastRight: Date | null;
	toRevisit: boolean;
}

export interface ScoreReplay {
	moments: ScoredMoment[];
	ideas: Map<string, IdeaState>;
	/** When each idea was last got right, in order: what fading is worked out from. */
	rights: { key: string; at: Date }[];
}

const GENERAL = "(general)";
const ideaKey = (lectureId: string, nodeId: string | undefined) => `${lectureId}#${nodeId || GENERAL}`;

/** When a logged thing happened: on the phone it is when the phone did it, not when the laptop heard. */
function eventTime(e: EventLogEntry): Date {
	const phoneAt = (e.data as { phoneAt?: unknown }).phoneAt;
	return new Date(typeof phoneAt === "string" && !Number.isNaN(Date.parse(phoneAt)) ? phoneAt : e.t);
}

/** Replay the history in order: every scored moment, and where each idea stands at the end. */
export function replayScore(input: ScoreInput): ScoreReplay {
	const moduleOf = new Map(input.lectures.map((l) => [l.id, l.module]));
	const ideas = new Map<string, IdeaState>();
	const rights: ScoreReplay["rights"] = [];
	const raw: { at: Date; run: () => ScoredMoment | null }[] = [];

	for (const e of input.events) {
		const d = e.data as Record<string, unknown>;
		// A session answer on the laptop, or the phone's answer to a notification's question.
		const laptop = e.type === "answer";
		const phone = e.type === "answered" && d.source === "phone";
		if (!laptop && !phone) continue;
		const lectureId = typeof d.lectureId === "string" ? d.lectureId : null;
		const questionId = typeof d.questionId === "string" ? d.questionId : null;
		if (!lectureId || !questionId) continue;
		if (laptop && d.graded !== true) continue;
		const at = eventTime(e);
		raw.push({
			at,
			run: () => {
				const info = input.questionInfo(questionId, lectureId);
				const key = ideaKey(lectureId, typeof d.nodeId === "string" && d.nodeId ? d.nodeId : info?.nodeId);
				const module = moduleOf.get(lectureId) ?? "";
				const idea = ideas.get(key) ?? { key, lectureId, nodeId: key.slice(lectureId.length + 1), module, secured: false, securedAt: null, lastRight: null, toRevisit: false };
				ideas.set(key, idea);
				const ms = typeof d.msOnQuestion === "number" ? d.msOnQuestion : 0;
				const minutes = Math.min(SCORE_RULES.maxMinutesPerAnswer, Math.max(0, ms / 60_000));
				const base = { at, kind: "answer" as const, module, lectureId, ideaKey: key, minutes, ...(phone ? { source: "phone" as const } : {}) };
				if (d.correct !== true || d.dontKnow === true) {
					// Wrong, or "I don't know": nothing earned, nothing lost. The idea waits in "to revisit".
					idea.toRevisit = true;
					return { ...base, points: 0, correct: false };
				}
				const difficulty = info?.difficulty ?? SCORE_RULES.defaultDifficulty;
				let points = SCORE_RULES.rightAnswer[difficulty] ?? SCORE_RULES.rightAnswer[SCORE_RULES.defaultDifficulty]!;
				const cameBack = idea.toRevisit;
				const secured = !cameBack && !idea.secured;
				if (cameBack) points += SCORE_RULES.cameBack;
				else if (secured) points += SCORE_RULES.ideaSecured;
				idea.toRevisit = false;
				if (!idea.secured) {
					idea.secured = true;
					idea.securedAt = at;
				}
				idea.lastRight = at;
				rights.push({ key, at });
				return { ...base, points, correct: true, ...(secured ? { secured: true } : {}), ...(cameBack ? { cameBack: true } : {}) };
			},
		});
	}

	// A study block the student started (not the "your block starts now" notification, which shares an event name).
	for (const b of input.blocks) {
		if (b.status !== "started" || !b.startedAt) continue;
		const at = new Date(b.startedAt);
		const module = b.module ?? (b.lectureId ? (moduleOf.get(b.lectureId) ?? "") : "");
		raw.push({ at, run: () => ({ at, kind: "block", points: SCORE_RULES.blockStarted, module, lectureId: b.lectureId ?? null, ideaKey: null, minutes: b.minutes }) });
	}

	raw.sort((a, b) => a.at.getTime() - b.at.getTime());
	const moments: ScoredMoment[] = [];
	for (const r of raw) {
		const m = r.run();
		if (m) moments.push(m);
	}
	return { moments, ideas, rights };
}

/** The ideas fading at `at`: secured, and not got right again for fadeAfterDays. */
export function fadingAt(replay: ScoreReplay, at: Date): string[] {
	const last = new Map<string, Date>();
	for (const r of replay.rights) {
		if (r.at > at) break;
		last.set(r.key, r.at);
	}
	const limit = at.getTime() - SCORE_RULES.fadeAfterDays * 86_400_000;
	return [...last].filter(([, t]) => t.getTime() < limit).map(([key]) => key);
}

/** The score at a moment: everything earned by then, less the ideas fading then. */
export function scoreAt(replay: ScoreReplay, at: Date): number {
	let earned = 0;
	for (const m of replay.moments) {
		if (m.at > at) break;
		earned += m.points;
	}
	return Math.max(0, earned - fadingAt(replay, at).length * SCORE_RULES.fadePoints);
}

/** What one idea is worth to the steady-pace line: got right once at the usual difficulty, and secured. */
export const IDEA_WORTH = SCORE_RULES.rightAnswer[SCORE_RULES.defaultDifficulty]! + SCORE_RULES.ideaSecured;

export interface Term {
	start: Date;
	end: Date;
	/** What the whole course is worth: every idea in the study packs, secured once. 0 when there are no packs. */
	target: number;
}

/**
 * The term the steady-pace line spans: from the first day anything was
 * scored (today, when nothing has been) to the last timetabled lecture, or
 * termWeeksWithoutTimetable later when there is no timetable.
 */
export function termFor(replay: ScoreReplay, input: { ideas: readonly PackIdea[]; lastLecture: Date | null; now: Date }): Term {
	const start = startOfDay(replay.moments[0]?.at ?? input.now);
	const fallback = addDays(start, SCORE_RULES.termWeeksWithoutTimetable * 7);
	const end = input.lastLecture && input.lastLecture > start ? input.lastLecture : fallback;
	return { start, end, target: input.ideas.length * IDEA_WORTH };
}

/** Where the steady-pace line is at `at`: a straight climb from 0 at the term's start to the target at its end. */
export function paceAt(term: Term, at: Date): number | null {
	if (term.target <= 0) return null;
	const span = term.end.getTime() - term.start.getTime();
	if (span <= 0) return term.target;
	return Math.round(term.target * Math.min(1, Math.max(0, (at.getTime() - term.start.getTime()) / span)));
}

export type ScoreRange = "week" | "month" | "term";

export interface DayDetail {
	sessions: number;
	right: number;
	answered: number;
	/** Idea keys secured, and brought back, in the period. */
	secured: string[];
	cameBack: string[];
	blocks: number;
	modules: string[];
}

export interface ScorePoint {
	/** The period's first day, "YYYY-MM-DD". */
	date: string;
	/** The period ends here (the point's place on the time axis). */
	end: string;
	score: number;
	pace: number | null;
	/** Points earned in the period (never negative: fading is not a gain). */
	gained: number;
	detail: DayDetail;
	/** True for periods after today: the pace line runs on, the score does not. */
	future: boolean;
}

function detailOf(moments: readonly ScoredMoment[]): DayDetail {
	const answers = moments.filter((m) => m.kind === "answer");
	return {
		sessions: 0,
		right: answers.filter((m) => m.correct).length,
		answered: answers.length,
		secured: answers.filter((m) => m.secured).map((m) => m.ideaKey!),
		cameBack: answers.filter((m) => m.cameBack).map((m) => m.ideaKey!),
		blocks: moments.filter((m) => m.kind === "block").length,
		modules: [...new Set(moments.map((m) => m.module).filter(Boolean))],
	};
}

/**
 * The chart's points. Week: the 7 days of this week. Month: the last 30
 * days. Term: one point a week from the term's start to its end. A period
 * after today has the pace line's value and no score.
 */
export function scoreSeries(replay: ScoreReplay, term: Term, range: ScoreRange, now: Date): ScorePoint[] {
	const periods: { from: Date; to: Date }[] = [];
	if (range === "week") {
		const monday = startOfWeek(now);
		for (let i = 0; i < 7; i++) periods.push({ from: addDays(monday, i), to: addDays(monday, i + 1) });
	} else if (range === "month") {
		const first = addDays(startOfDay(now), -29);
		for (let i = 0; i < 30; i++) periods.push({ from: addDays(first, i), to: addDays(first, i + 1) });
	} else {
		const first = startOfWeek(term.start);
		const last = term.end > now ? term.end : now;
		for (let from = first; from < last; from = addDays(from, 7)) periods.push({ from, to: addDays(from, 7) });
	}
	return periods.map(({ from, to }) => {
		const future = from > now;
		// Today's (or this week's) point is the score now, not at a midnight that hasn't come.
		const at = to > now ? now : new Date(to.getTime() - 1);
		const inPeriod = replay.moments.filter((m) => m.at >= from && m.at < to);
		return {
			date: dateKey(from),
			end: dateKey(new Date(to.getTime() - 1)),
			score: future ? 0 : scoreAt(replay, at),
			pace: paceAt(term, new Date(to.getTime() - 1)),
			gained: inPeriod.reduce((n, m) => n + m.points, 0),
			detail: detailOf(inPeriod),
			future,
		};
	});
}

export interface ModuleShare {
	module: string;
	points: number;
	minutes: number;
	/** The last time anything was scored in this module, ever. */
	lastActivity: Date | null;
}

/**
 * What each module contributed between `from` and `to`: points, and time.
 * Time is the study blocks started plus the time on questions answered
 * outside a started block (inside one, the block's length already counts).
 */
export function moduleShares(replay: ScoreReplay, modules: readonly string[], from: Date, to: Date): ModuleShare[] {
	const windows = replay.moments.filter((m) => m.kind === "block").map((m) => ({ from: m.at.getTime(), to: m.at.getTime() + m.minutes * 60_000 }));
	const inBlock = (at: Date) => windows.some((w) => at.getTime() >= w.from && at.getTime() <= w.to);
	return modules.map((module) => {
		const mine = replay.moments.filter((m) => m.module === module);
		const inRange = mine.filter((m) => m.at >= from && m.at < to);
		return {
			module,
			points: inRange.reduce((n, m) => n + m.points, 0),
			minutes: Math.round(inRange.reduce((n, m) => n + (m.kind === "block" || !inBlock(m.at) ? m.minutes : 0), 0)),
			lastActivity: mine.at(-1)?.at ?? null,
		};
	});
}
