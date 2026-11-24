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
	/** v0.1 F-106: a session scoped to these concept-map nodes ("Quiz me on this idea"). */
	nodes?: string[];
	/** v0.1 F-112: question 1 was answered on the phone; the session continues at question 2. */
	seedAnswer?: { questionId: string; choice: number; correct: boolean; at: string; stem?: string; choiceLabel?: string };
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
	/** Internal (never sent to the browser): the engine just asked the teacher for the next question (TEACHER_RULES). */
	teacherNudged?: boolean;
	/** Machine-readable reason when status is "error". */
	error?: string;
	/** status "error" and the lecture has a question bank: "Use practice questions" can replace this session (T-6). */
	practiceAvailable?: boolean;
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

/** A module and its calendar (v0.1 V-18, spec §5.5). */
export interface ModuleInfo {
	code: string;
	name: string;
	/** The Monday of teaching week 1 (YYYY-MM-DD); unset until the student says which week it is. */
	weekOneStart?: string;
	/** Teaching-week numbers after which a reading week falls ([6] = a reading week between weeks 6 and 7). */
	readingWeeks?: number[];
}

/** V-10, F-118: Calm (default) animates only what explains a change; Full adds page transitions and the drifting background; Off removes everything (as does the system reduced-motion setting). */
export type MotionChoice = "calm" | "full" | "off";
export const MOTION_CHOICES: readonly MotionChoice[] = ["calm", "full", "off"];

export interface Profile {
	createdAt: string;
	modules: ModuleInfo[];
	/** "none": no calendar yet, modules typed by the student (v0.1 onboarding). */
	timetableSource: "sample" | "ics" | "none";
	/** When the timetable was last read, and what was read (R-7). */
	timetableRead?: { at: string; events: number; modules: string[] };
	prefs: {
		/** R-1, Q-9; v0.1 F-114: 0 = silent (laptop and phone); start from Today. */
		nudgesPerDay: 0 | 1 | 2;
		quietHours: { from: string; to: string };
		lock: LockStrictness;
		defaultMode: SessionMode;
		/** N-3's evening slot ("19:00"). */
		eveningTime: string;
	};
	/** `motion` replaced the v0.0 `reduceMotion` boolean (F-118); `migrateAppearance` reads old profiles. */
	appearance: { theme: string; accent: string; textSize: string; lineSpacing: string; motion: MotionChoice };
	/** The weekly plan (F-110, F-111, V-5). */
	plan?: { weeklyTargetMinutes: number | null; blockMinutes: number; sundayTime: string; focusScreen: boolean };
	/** From the setup chat or the plain form (F-109). */
	routine?: Routine;
	/** The student's IANA time zone, e.g. "Europe/London" (F-108): floating calendar times are read in it. */
	timeZone?: string;
	/** The AI connection at onboarding (v0.1 F-101). The live state is GET /api/companion/ai. */
	ai?: { provider: "chatgpt" | "anthropic" | "openai" | "openrouter" | null; connectedAt?: string };
}

/**
 * A timetabled lecture or event, or (v0.1 V-18) a **course unit**: the
 * same record without a time, made from the student's material. Units are
 * what sessions, misses, packs and the concept map key on; times are only
 * a signal for N-1 (spec §5.5).
 */
export interface Lecture {
	id: string;
	/** Module code: "HCI". */
	module: string;
	title: string;
	/** Teaching week; 0 = not known (a unit from material with no week on it). */
	week: number;
	/** Course order within the module, for the roadmap (INT-01-e). */
	order: number;
	/** Absent for a course unit made from material (V-18). */
	start?: string;
	end?: string;
	/** "event" = a timetabled commitment with no material (lab, seminar). */
	kind?: "lecture" | "event";
	/** A timetable event that disappeared from the calendar: kept for its history, hidden everywhere (F-104 merge). */
	archived?: boolean;
	/** Where a unit's material came from (F-104). */
	source?: { file: string; pages: [number, number] };
	/** Set false by "I wasn't there"; undefined means assume attended. */
	attended?: boolean;
	hasMaterials: boolean;
}

/**
 * A study block on a date (v0.1 F-110: generalised from v0.0's weekly
 * slots). The planner proposes; the student ticks, moves or removes. Only
 * accepted and started blocks are commitments (nudges, the active block).
 */
export interface StudyBlock {
	id: string;
	/** Local date, "YYYY-MM-DD". */
	date: string;
	/** "HH:MM" */
	start: string;
	minutes: number;
	/** The course unit to study (the pacing rule's pick, spec §5.5). */
	lectureId?: string;
	/** A bank question to start with (F-105). */
	firstTaskQuestionId?: string;
	/** "keep-up" or "gap": why this unit (spec §5.5). */
	reason?: "keep-up" | "gap";
	/** The weekday-and-time slot it repeats from last week (LIT-18 anchors), e.g. "2@14:00". */
	anchorOf?: string;
	status: "proposed" | "accepted" | "started" | "removed";
	source: "planner" | "student" | "phone";
	startedAt?: string;
}

/** What the setup chat learns (F-109, V-4). Confirmed by the student; never sets a Settings toggle. */
export interface Routine {
	energy: Array<"morning" | "afternoon" | "evening">;
	/** Private busy time: shifts, gym, commute. */
	commitments: Array<{ label: string; weekdays: number[]; start: string; end: string }>;
	/** Free text, never sensed (R-2). */
	places: string[];
	weeklyTargetMinutes: number;
	preferredBlockMinutes: number;
	confirmedAt: string;
}

/** N-5 (v0.1 F-111, F-114): the Sunday check-in. */
export type NudgeType = "N-1" | "N-2" | "N-3" | "N-4" | "N-5" | "block";
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
	/** v0.1 F-114: the notification title (N-1 v2: "HCI just finished. One question:"); `text` is its body. */
	title?: string;
	/** "Why now" (R-7): "after HCI · you're free until 15:00". */
	why?: string;
	/** N-1 v2: the bank question shown as the notification (its id; the payload goes to the phone, F-112). */
	questionId?: string;
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
	/** "Why now" (R-7, F-114). */
	why?: string;
	/** N-5 opens the week's check-in, not a session. */
	opens?: "session" | "checkin";
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
	// v0.1 F-101, F-102
	"ai_connected",
	"ai_disconnected",
	"ai_error",
	"engine_ready",
	// v0.1 F-104, V-18
	"materials_uploaded",
	"materials_proposed",
	"materials_saved",
	"materials_removed",
	"module_week_set",
	// v0.1 F-105, F-106
	"pack_started",
	"pack_stage",
	"pack_ready",
	"pack_failed",
	"explainer_opened",
	"map_node_clicked",
	// v0.1 F-108
	"calendar_connected",
	"calendar_refreshed",
	"calendar_error",
	// v0.1 F-109, F-110, F-111
	"plan_proposed",
	"plan_accepted",
	"plan_moved",
	"plan_removed",
	"setup_chat_started",
	"setup_chat_turn",
	"setup_chat_confirmed",
	"setup_chat_skipped",
	"setup_chat_fallback_form",
	"checkin_shown",
	"checkin_answered",
	"target_changed",
	"target_kept",
	// v0.1 F-112: the phone and the relay; replayed phone events keep their own type, with source "phone"
	"phone_paired",
	"phone_unpaired",
	"schedule_uploaded",
	"relay_error",
	"opened",
	"answered",
	"handover",
	"done_for_now",
	"snoozed",
	"dismissed",
	"plan_tick",
	"plan_move",
	"plan_remove",
	"checkin",
	"target_confirm",
	"focus_start",
	"focus_end",
	// v0.1 F-116
	"dictation_used",
	// v0.1 F-118
	"motion_changed",
	// v0.1 dry run: the teacher stopped before the budget and was asked to continue
	"teacher_nudged",
	// facilitator: a question sent to the phone now (T4 in a lab)
	"phone_send_now",
] as const;
export type CompanionEventType = (typeof COMPANION_EVENT_TYPES)[number];

/** Events the browser may log through POST /api/companion/events. */
export const CLIENT_EVENT_TYPES: readonly CompanionEventType[] = [
	"onboarding_step",
	"settings_changed",
	"block_started",
	"error",
	"explainer_opened",
	"map_node_clicked",
	"dictation_used",
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
