/**
 * Companion (start layer + session engine) — the shared vocabulary.
 *
 * Pure types only: browser-safe, no IO. Every shape here is part of the
 * contract between the companion server code (src/server/companion), the
 * HTTP routes (app/api/companion) and the LockedIn screens
 * (components/lockedin, served at /app).
 *
 * Design: docs/companion/plan.md §5.4 and §7.1; v0.1 changes in
 * docs/companion/v0.1-spec.md §7.
 */

// ─── sessions ───────────────────────────────────────────────────────────────

export type EngineName = "learnharness" | "scripted";
export const ENGINE_NAMES: readonly EngineName[] = ["learnharness", "scripted"];

export type SessionKind = "post-lecture" | "missed-lecture" | "retest" | "try-now" | "block";
export const SESSION_KINDS: readonly SessionKind[] = ["post-lecture", "missed-lecture", "retest", "try-now", "block"];

export type SessionMode = "question-first" | "show-first";

export interface SessionBudget {
	questions: number;
	minutes: number;
	/** Missed-lecture sessions come in pieces (N-3: "three 5-minute pieces"). */
	parts?: number;
}

export interface SessionSpec {
	kind: SessionKind;
	lectureId: string;
	mode: SessionMode;
	budget: SessionBudget;
	/** Retests: the misses this session revisits, in the order asked. */
	missIds?: string[];
}

export type SessionStatus = "preparing" | "question" | "thinking" | "done" | "error";

/** One answer option in DISPLAY order. `index` is 1-based, matching
 *  LearnHarness's own answer records (QuestionAnswerData.options). */
export interface SessionOption {
	index: number;
	label: string;
}

export interface SessionQuestion {
	/** The LearnHarness toolCallId, or the scripted question id. */
	id: string;
	/** quiz = graded multiple choice; ask = ungraded choice (teacher's ask_user_question). */
	kind: "quiz" | "ask";
	stem: string;
	/** Extra context the question carries (LearnHarness `details`). */
	context?: string;
	options: SessionOption[];
	multi: boolean;
	role: "check" | "predict";
}

export interface SessionFeedback {
	/** The question this feedback belongs to. */
	questionId: string;
	correct: boolean;
	dontKnow: boolean;
	/** True when the answer was a "show me first" request, not an attempt. */
	shown: boolean;
	correctLabels: string[];
	explanation?: string;
	slideRefs: number[];
}

/** What the session screen renders. Never carries an unanswered question's
 *  correct answer or explanation. */
export interface SessionView {
	id: string;
	engine: EngineName;
	kind: SessionKind;
	mode: SessionMode;
	lecture: { id: string; title: string; module: string };
	/** "5 questions on Personas and scenarios, about 10 minutes" */
	goal: string;
	status: SessionStatus;
	/** What the engine is doing right now, for waits (AE2-2, AE2-4). */
	activity?: string;
	answered: number;
	budget: number;
	/** The teacher's latest text (Markdown) since the last answer. */
	prose?: string;
	question?: SessionQuestion;
	feedback?: SessionFeedback;
	canHint: boolean;
	/** status "done" because the engine stopped before the budget was used. */
	endedEarly?: boolean;
	/** Machine-readable reason when status is "error". */
	error?: string;
	/** Every (Slide n) referenced in prose + feedback, for the slide sheet. */
	slideRefs: number[];
}

/** The learner's answer as it arrives from the session screen. */
export interface AnswerInput {
	questionId: string;
	/** 1-based display indices (SessionOption.index). */
	indices?: number[];
	dontKnow?: boolean;
	/** One of CONFIDENCE_STOPS (0/30/50/70/90/100). Ignored with dontKnow. */
	confidence?: number;
	why?: string;
}

/** An answer, normalised across engines. Feeds the miss log and event log. */
export interface AnswerRecord {
	questionId: string;
	questionText: string;
	nodeId?: string;
	/** false for ungraded (ask) answers. */
	graded: boolean;
	correct: boolean;
	dontKnow: boolean;
	confidence?: number;
	/** A "show me first" request, not an attempt. */
	shown: boolean;
	correctLabels: string[];
	explanation?: string;
	why?: string;
	answeredAt: string;
}

// ─── scripted engine ────────────────────────────────────────────────────────

export interface ScriptedQuestion {
	id: string;
	/** One sentence before the question, citing a slide (the formatting rule). */
	leadIn?: string;
	stem: string;
	options: string[];
	/** 0-based indices into `options` as authored. */
	correct: number[];
	explanation: string;
	hint?: string;
	workedExample?: string;
	/** Questions sharing a nodeId test the same idea: retests use a sibling. */
	nodeId: string;
	/** Reserve this question for retests and "show me" follow-ups. */
	retestOnly?: boolean;
}

export interface ScriptedSet {
	lectureId: string;
	goal?: string;
	questions: ScriptedQuestion[];
}

export interface ScriptedState {
	/** Question ids in the order they will be asked. */
	queue: string[];
	/** Index into queue of the current question. */
	position: number;
	answers: AnswerRecord[];
	/** Question ids whose worked example has been shown. */
	examplesShown: string[];
	/** Question ids where the learner asked for a hint. */
	hinted: string[];
}

// ─── the start layer ────────────────────────────────────────────────────────

export type LockStrictness = "off" | "gentle" | "firm";

export interface Profile {
	createdAt: string;
	modules: { code: string; name: string }[];
	timetableSource: "sample" | "ics";
	/** When the timetable was last read, and what was read (R-7). */
	timetableRead?: { at: string; events: number; modules: string[] };
	prefs: {
		nudgesPerDay: 1 | 2;
		quietHours: { from: string; to: string };
		lock: LockStrictness;
		defaultMode: SessionMode;
		/** N-3's evening slot ("19:00"). */
		eveningTime: string;
	};
	appearance: { theme: string; accent: string; textSize: string; lineSpacing: string; reduceMotion: boolean };
}

export interface Lecture {
	id: string;
	/** Module code: "HCI". */
	module: string;
	title: string;
	week: number;
	/** Course order within the module, for the roadmap (INT-01-e). */
	order: number;
	start: string;
	end: string;
	/** "event" = a timetabled commitment with no material (lab, seminar). */
	kind?: "lecture" | "event";
	/** Set false by "I wasn't there"; undefined means assume attended. */
	attended?: boolean;
	hasMaterials: boolean;
}

export interface StudyBlock {
	id: string;
	/** ISO weekday: 1 = Monday … 7 = Sunday. */
	weekday: number;
	/** "HH:MM" */
	start: string;
	minutes: number;
	lectureId?: string;
	/** Local dates ("YYYY-MM-DD") this block is skipped (X-7). */
	skippedDates: string[];
}

export type NudgeType = "N-1" | "N-2" | "N-3" | "N-4" | "block";
export type NudgeAction = "open" | "snooze" | "dismiss" | "wasnt-there";
export const NUDGE_ACTIONS: readonly NudgeAction[] = ["open", "snooze", "dismiss", "wasnt-there"];

export interface NudgeRecord {
	id: string;
	type: NudgeType;
	/** Dedupe key: one nudge per key, ever. */
	key: string;
	firedAt: string;
	text: string;
	lectureId?: string;
	sessionId?: string;
	/** N-4: the snoozed nudge this returns. */
	returnOf?: string;
	/** Fired by the facilitator, outside the rules. */
	forced?: boolean;
	outcome?: "opened" | "snoozed" | "dismissed" | "wasnt-there";
	outcomeAt?: string;
}

/** A nudge the rules say may fire. Pure output of the nudge engine. */
export interface NudgeCandidate {
	type: NudgeType;
	key: string;
	text: string;
	spec: SessionSpec;
	lectureId?: string;
	/** An existing session to open (N-4) or the pre-warmed one. */
	sessionId?: string;
	returnOf?: string;
	/** When pre-warming may start. */
	prepareFrom: string;
	/** Earliest firing time (if the session is ready). */
	fireAt: string;
	/** Fire at this time even if the session is still preparing. */
	fireBy: string;
}

export type CompanionSessionState = "preparing" | "ready" | "active" | "done" | "stopped" | "error";

export interface CompanionSession {
	id: string;
	engine: EngineName;
	spec: SessionSpec;
	/** LearnHarness chat id (learnharness engine only). */
	chatId?: string;
	/** Scripted engine state (scripted engine only). */
	scripted?: ScriptedState;
	/** The nudge key this session was pre-warmed for. */
	nudgeKey?: string;
	/** The live question budget (raised by "keep going"). */
	budget: number;
	answered: number;
	createdAt: string;
	readyAt?: string;
	openedAt?: string;
	endedAt?: string;
	lastActivityAt?: string;
	state: CompanionSessionState;
	error?: string;
	/** Question ids already logged as shown (question_shown events). */
	shownQuestionIds?: string[];
	/** When the current question was first shown (time-on-question in the event log). */
	questionShownAt?: string;
	/** Question ids the learner asked a hint on (answers there are "assisted"). */
	hintedQuestionIds?: string[];
	/** Engine fallback happened (learnharness → scripted). */
	fellBackFrom?: EngineName;
}

export type MissReason = "wrong" | "dont-know" | "low-confidence";

export interface Miss {
	id: string;
	lectureId: string;
	sessionId: string;
	questionId: string;
	nodeId?: string;
	questionText: string;
	correctLabels: string[];
	explanation?: string;
	confidence?: number;
	reason: MissReason;
	status: "open" | "solid";
	timesSeen: number;
	nextDue: string;
	createdAt: string;
	solidAt?: string;
}

export const COMPANION_EVENT_TYPES = [
	"onboarding_step",
	"onboarding_done",
	"nudge_fired",
	"nudge_opened",
	"nudge_snoozed",
	"nudge_dismissed",
	"wasnt_there",
	"session_prepare_started",
	"session_prepared",
	"session_opened",
	"question_shown",
	"answer",
	"hint",
	"show_me",
	"keep_going",
	"session_done",
	"session_stopped",
	"block_started",
	"app_open_blocked",
	"lock_override",
	"settings_changed",
	"engine_fallback",
	"error",
] as const;
export type CompanionEventType = (typeof COMPANION_EVENT_TYPES)[number];

/** Events the browser may log through POST /api/companion/events. */
export const CLIENT_EVENT_TYPES: readonly CompanionEventType[] = [
	"onboarding_step",
	"settings_changed",
	"block_started",
	"error",
];

export interface EventLogEntry {
	/** Clock time (real or demo). */
	t: string;
	/** Real wall time. */
	wall: string;
	participant?: string;
	type: CompanionEventType;
	data: Record<string, unknown>;
}

/** Everything the pure rules read. */
export interface CompanionState {
	profile: Profile | null;
	lectures: Lecture[];
	blocks: StudyBlock[];
	sessions: CompanionSession[];
	misses: Miss[];
	nudges: NudgeRecord[];
}
