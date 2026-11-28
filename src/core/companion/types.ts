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

export type SessionKind = "post-lecture" | "missed-lecture" | "retest" | "try-now" | "block" | "practise" | "learn";
export const SESSION_KINDS: readonly SessionKind[] = ["post-lecture", "missed-lecture", "retest", "try-now", "block", "practise", "learn"];
/**
 * The two ways to study (V-40, V-50). Practise is fast questions from the
 * question bank, with no AI. Learn is the tutor teaching. On screen they are
 * "Practise" and "Learn".
 */
export type StudyMode = "learn" | "practise";

export type SessionMode = "question-first" | "show-first";

/**
 * How much a Learn session covers (V-47): one lecture, a module's lectures
 * for one teaching week, or one section of a lecture (a typed goal that
 * matched particular ideas). The opening questions are sized to it.
 */
export type LearnScope = "lecture" | "week" | "section";

/** A Learn session (V-47, V-54): the tutor teaching, as long as a study block. */
export interface LearnSpec {
	scope: LearnScope;
	/** What the student typed or said they want to cover, in their words. */
	goal?: string;
	/** A week in one session: every unit taught, in course order. The first is the session's `lectureId`. */
	lectureIds?: string[];
	/** The student's choice on the first step (v3.1): true = "Check what I know first", false = "Skip, start teaching". Absent: a session from before v3.1. */
	check?: boolean;
	/** The module's other units (v3.1), in course order: the tutor may read one when what the student wants is in it. Their ideas are written `m1-<slug>`, `m2-<slug>`. */
	reach?: string[];
	/** How long the sitting is meant to be: the block's length, or the student's usual block length. */
	minutes: number;
}

export interface SessionBudget {
	questions: number;
	minutes: number;
	/** Missed-lecture sessions come in pieces (N-3: "three 5-minute pieces"). */
	parts?: number;
}

/** An answer already given on the phone, which the laptop session starts from (F-112). */
export interface SeedAnswer { questionId: string; choice: number; correct: boolean; at: string; stem?: string; choiceLabel?: string }

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
	seedAnswer?: SeedAnswer;
	/** v2.1: every answer given on the phone before the hand-off ("Keep going here", V-46), in the round's order. Used in place of `seedAnswer`. */
	seedAnswers?: SeedAnswer[];
	/** A study block's first step (V-44): the session opens on this bank question. */
	firstQuestionId?: string;
	/** Practise on one unit (v3.1): the questions chosen for this round from the student's history, in the order to ask them. The round fills up from the unit's set after them. */
	order?: string[];
	/** Learn or Practise (V-40). Absent means Learn. */
	study?: StudyMode;
	/** Learn (V-47): set on every session the tutor teaches. */
	learn?: LearnSpec;
	/** A Practise round across a module (V-40): the questions chosen for it, in the order asked. */
	practise?: { module: string; picks: { lectureId: string; questionId: string }[]; /** "Practise this idea" (V-39): the idea the round stays on, as `lectureId#nodeId`. */ idea?: string };
}

/**
 * "reply": Learn only. The tutor has said its piece and is waiting for the student.
 * "ask": Learn only. The module's first Learn session: "How do you like to learn this?" comes first (V-52).
 */
export type SessionStatus = "ask" | "preparing" | "question" | "thinking" | "reply" | "done" | "error";

/** One answer option in DISPLAY order. `index` is 1-based, matching
 *  LearnHarness's own answer records (QuestionAnswerData.options). */
export interface SessionOption {
	index: number;
	label: string;
}

export interface SessionQuestion {
	/** The LearnHarness toolCallId, or the scripted question id. */
	id: string;
	/** quiz = multiple choice with a right answer; ask = a choice with no right answer; write = answered in the student's own words. */
	kind: "quiz" | "ask" | "write";
	/** A "have a guess" (V-47): an opening question or a prediction. Never marked wrong, never a gap. */
	guess?: boolean;
	/** ask: the student may type something else instead of picking. */
	other?: boolean;
	stem: string;
	/** Extra context the question carries (LearnHarness `details`). */
	context?: string;
	options: SessionOption[];
	multi: boolean;
	role: "check" | "predict";
	/** The slides this question comes from, when the question bank knows them: the slide panel opens on the first. */
	slides?: number[];
	/** The unit this question comes from, when a round mixes units: the slide panel shows that unit's slides. */
	lectureId?: string;
	/** Written by the AI from the student's slides: the screen says so, with the slide (X-9). */
	ai?: boolean;
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
	/** Learn or Practise (V-40). Set by the service on every view; absent means Learn. */
	study?: StudyMode;
	/** Practise across a module: the module's name, for the header. */
	practiseOf?: string;
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
	/** status "done": the ideas this session will bring back, by name (no score is shown: R-6). */
	comingBack?: string[];
	/** status "done": when the next study block starts (ISO), if one is planned. */
	nextBlockAt?: string | null;
	/** Learn (V-47): the step on screen, the plan, and the clock. */
	learn?: LearnView;
	/** status "ask" (V-52): the module being asked about, and whether another module's answer can be reused. */
	ask?: { module: string; name: string; canCopy: boolean };
	/** Learn (v3.1): the files attached to this session, sent to the tutor or still waiting to go with the next message. */
	attachments?: SessionAttachment[];
	/** status "ask" (v3.1): the first step of a Learn session, "What do you want from this session?". Nothing has been sent to the AI yet. */
	intent?: { name: string; suggestions: (IntentSuggestion & { sessionId?: string })[] };
}

// ─── what LockedIn knows about you (V-52, V-53) ─────────────────────────────

/** The taps on the first-time card. Every row is optional. */
export interface HowPrefs {
	start?: "examples" | "questions" | "explanations";
	steps?: "small" | "big";
	check?: "often" | "end";
	/** Anything else, typed or spoken. */
	more?: string;
}

/**
 * The notes LockedIn keeps per module (V-53). The student sees every one and
 * can edit them; the tutor reads them at the start of a session; "Delete all
 * my data" removes them. The third note, the last session's plan, is read
 * from that session and is not stored here.
 */
export interface ModuleNotes {
	/** The first-time card has been answered or skipped (V-52): it is never shown again for this module. */
	asked?: boolean;
	/** How you learn it. */
	how?: { text: string; prefs?: HowPrefs; at: string };
	/** Where you are in it: rewritten after each Learn session, or by the student. */
	where?: { text: string; at: string; by: "ai" | "you" };
}

/** The three notes as the Library shows them. */
export interface ModuleNotesView {
	module: { code: string; name: string };
	asked: boolean;
	how: { text: string; at: string } | null;
	where: { text: string; at: string; by: "ai" | "you" } | null;
	last: { sessionId: string; lecture: string; at: string; index: number; total: number; title: string; plan: { title: string; state: "done" | "current" | "todo" }[]; finished: boolean } | null;
}

/** One idea on a Learn session's plan, as the screen draws it (V-33: LockedIn draws it from the tutor's data). */
export interface LearnPlanNode {
	id: string;
	title: string;
	state: "done" | "current" | "todo";
}

export interface LearnPlanView {
	nodes: LearnPlanNode[];
	edges: { from: string; to: string }[];
	/** The current idea's id, when there is one. */
	currentId?: string;
	/** Which idea the session is on, counting from 1; 0 before the first one. */
	index: number;
	total: number;
	/** The current idea's title, and the one after it (INT-02-c: progress points at what is next). */
	current?: string;
	next?: string;
}

/**
 * One thing in a Learn step, in the order it happened. A step is everything
 * since the student's last answer, so the screen shows one step at a time
 * (AE-5, AFF-C) and never a chat log (AE2-3).
 */
export type LearnItem =
	| { type: "tutor"; id: string; text: string }
	| { type: "you"; id: string; text: string }
	| {
			type: "answered"; id: string; stem: string; guess: boolean;
			options: { label: string; picked: boolean; answer: boolean }[];
			/** What the student wrote, for a written answer or "something else". */
			written?: string;
			dontKnow: boolean;
			/** Set only for a Check with a right answer. A guess is never marked. */
			correct?: boolean;
			/** A written check (v3.1): how the tutor marked it, once it has replied. */
			verdict?: Verdict;
			explanation?: string;
			why?: string;
		}
	/** The plan, shown once, in the step where the tutor proposed it. */
	| { type: "plan"; id: string }
	/** Something the tutor asked for is being made in the background (AFF-H). */
	| { type: "making"; id: string; kind: LearnArtifactKind; title?: string }
	| { type: "failed"; id: string; kind: LearnArtifactKind }
	| { type: "visual"; id: string; svg: string; notes?: string }
	| { type: "demo"; id: string; title: string; html: string }
	| { type: "research"; id: string; brief: string; sources: { title: string; url: string }[] }
	/** A question asked beside an open question, and its answer. The open question stays. */
	| { type: "aside"; id: string; ask: string; answer: string };

export type LearnArtifactKind = "visual" | "demo" | "research";

/** A file attached to a Learn session (v3.1). `text`: what was read from it; `images`: how many pictures of it are kept beside the session. `sent`: the tutor has been given it. */
export interface SessionAttachment { id: string; name: string; kind: "text" | "pdf" | "image"; chars: number; images: number; at: string; sent?: boolean }

/** How the tutor marked a written check (v3.1). */
export type Verdict = "right" | "partly" | "notyet";
/** A written check and its mark (v3.1), for the student's record. */
export interface WrittenMark { questionId: string; nodeId?: string; questionText: string; written: string; committed: string; verdict: Verdict; answeredAt: string }

export type WhereLevel = "solid" | "shaky" | "notyet" | "unchecked";
/** A step of the plan with what the check found for it (v3.1.1). `checked`: the name the check used for the idea, which a change is sent under. */
export type LeveledStep = LearnPlanNode & { level?: WhereLevel; note?: string; corrected?: boolean; checked?: string };
/** Where a Learn session is (v3.1.1): finding the student's level, agreeing the plan, then for each idea a guess, the teaching, a check. */
export type LearnStage = "level" | "plan" | "guess" | "learn" | "check";
/** One block of "Where you are" (v3.1). `corrected`: the student changed it. */
export interface LearnWhere { title: string; level: WhereLevel; note?: string; corrected?: boolean }
/** A suggestion on the first step of a Learn session (v3.1): tapping it fills in the goal. `attach`: it is about a file the student adds. */
export interface IntentSuggestion { id: "unit" | "stopped" | "week" | "revisit" | "sheet"; label: string; goal: string; attach?: boolean }

export interface LearnView {
	/** Where the loop is: the opening guesses, the plan being agreed, or teaching. */
	phase: "probe" | "plan" | "teach";
	step: LearnItem[];
	/** How many steps came before this one ("Earlier"). */
	earlier: number;
	plan?: LearnPlanView;
	minutes: number;
	/** When this sitting's time is up (ISO). The session never ends by itself. */
	endsAt?: string;
	timeUp: boolean;
	/** The plan's last idea has been checked: "Finish" is offered. */
	finished: boolean;
	/** status "done": the ideas this session covered, by name. */
	covered?: string[];
	/** A week in one session: the unit the current idea belongs to. The slide panel shows its slides. */
	unit?: { id: string; title: string };
	/** The slide to show beside this step (v3.1): the open question's own, else the latest one the tutor cited. */
	slideAt?: number;
	/** "Where you are" (v3.1): each idea the goal needs, basic first, once the check is over (or skipped). */
	where?: LearnWhere[];
	/** Every written check the tutor has marked in this session (v3.1). The service records each once. */
	marks?: WrittenMark[];
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
	/** A written answer, or "something else" on a question with options. */
	text?: string;
}

/** An answer, normalised across engines. Feeds the miss log and event log. */
export interface AnswerRecord {
	questionId: string;
	questionText: string;
	nodeId?: string;
	/** The unit the question came from, when it differs from the session's (a mixed Practise round). */
	lectureId?: string;
	/** false for answers that are not marked: a choice with no right answer, a written answer, and a guess. */
	graded: boolean;
	/** A "have a guess" (an opening question or a prediction): it never makes a gap and never closes one. */
	guess?: boolean;
	/** What the student wrote, when the answer was in their own words. */
	written?: string;
	correct: boolean;
	dontKnow: boolean;
	confidence?: number;
	/** A "show me first" request, not an attempt. */
	shown: boolean;
	correctLabels: string[];
	/** What the student chose (V-39): the labels of the options picked. Empty for "I don't know". */
	chosen?: string[];
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
	/** The slides it comes from (study-pack bank questions carry them). */
	slides?: number[];
	/** The unit it comes from, when a round mixes units (Practise). */
	lectureId?: string;
	/** Written by the AI from the student's slides (a study pack's bank), not by a person. */
	ai?: boolean;
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
	/** This module's share of the week's blocks (V-63). Unset = normal. */
	share?: "less" | "more";
	/** The colour the student picked for this module (v3.0), one of MODULE_COLOUR_CHOICES. Unset = by its place in the list. */
	colour?: string;
}

/** A module's share of the week as the student sets it: one tap, never hours (V-63). */
export type WeekShare = "less" | "normal" | "more";
export const WEEK_SHARES: readonly WeekShare[] = ["less", "normal", "more"];

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
	/**
	 * The first run (v2.0, V-45): the step reached, so a closed tab reopens
	 * there, and the week its blocks were suggested for. Absent on a profile
	 * made before v2.0 or by a facilitator scenario: that student is set up.
	 */
	setup?: { step: number; week?: string; doneAt?: string };
}

// ─── the first run (v2.0 step 7, V-45) ──────────────────────────────────────

/** One line per module in setup's slides step: "7 chapters found · preparing". */
export interface SetupModuleLine {
	code: string;
	name: string;
	units: number;
	/** Units whose study pack is still being written, and those whose pack is written. */
	preparing: number;
	ready: number;
	list: { id: string; title: string; week: number }[];
}
export interface SetupWeek {
	energy: EnergyTime[];
	/** Minutes a week. */
	target: number;
	/** The Monday of the week the blocks are in. */
	week: string;
	blocks: { id: string; date: string; start: string; minutes: number; module: string | null; title: string | null; why: string | null }[];
	/** "Your week only has room for …", when the total doesn't fit. */
	message: string | null;
}
/** Where setup ends: the student's own first unit, to learn. Null with no slides yet. */
export interface SetupEnd { lectureId: string; module: string; title: string }
export interface SetupView {
	/** False until the timetable step has made the profile. */
	started: boolean;
	done: boolean;
	/** 1 sign in, 2 timetable, 3 slides, 4 week, 5 phone. */
	step: number;
	phone: { available: boolean; paired: boolean };
	calendar: boolean;
	modules: SetupModuleLine[];
	week: SetupWeek | null;
	end: SetupEnd | null;
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
	/** The last week a unit covers, when it covers more than one (v3.1.1): "Weeks 7 to 9". Absent for one week. */
	weekTo?: number;
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
	/** The module this block is for (v1.1, V-37): the unit's module when the planner picked one, or the student's own choice. Unset = free study. */
	module?: string;
	/** A bank question to start with (F-105). */
	firstTaskQuestionId?: string;
	/** "keep-up" or "gap": why this unit (spec §5.5). */
	reason?: "keep-up" | "gap";
	/** The weekday-and-time slot it repeats from last week (LIT-18 anchors), e.g. "2@14:00". */
	anchorOf?: string;
	/** What put the planner's block at this time (V-45: every block says why it is where it is). Gone once the student moves it. */
	placed?: BlockPlaced;
	status: "proposed" | "accepted" | "started" | "removed";
	source: "planner" | "student" | "phone";
	startedAt?: string;
}

export type EnergyTime = "morning" | "afternoon" | "evening";
export const ENERGY_TIMES: readonly EnergyTime[] = ["morning", "afternoon", "evening"];
export type BlockPlaced = { by: "anchor" } | { by: "energy"; when: EnergyTime } | { by: "after-lecture"; module: string } | { by: "gap" };

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
	/** Learn: questions asked beside an open question, with the tutor's answers. */
	asides?: { questionId: string; ask: string; answer: string; at: string }[];
	/** Learn: where the plan stood at the last look, for the pick-up card and the plan note (V-53). */
	learnAt?: { index: number; total: number; title: string; covered: string[]; plan?: { title: string; state: "done" | "current" | "todo" }[] };
	/** Learn: the module's first-time question (V-52) has not been answered yet, so the tutor has not been started. */
	awaitingHow?: boolean;
	/** Written checks whose mark has been recorded (v3.1), by question id. */
	marked?: string[];
	/** Files the student attached to this session (v3.1): a problem sheet, a worked solution, a photo of working. Kept with the session only. */
	attachments?: SessionAttachment[];
	/** A Learn session whose first step is still to be answered (v3.1): what the student wants, and whether to be checked first. */
	awaitingIntent?: boolean;
	/** Learn: when the clock for this sitting started. Reset when a stopped session is picked up. */
	sittingFrom?: string;
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
	/** What the student chose, and the reason they gave (V-39): what new questions on this idea are written around. */
	chosen?: string[];
	why?: string;
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
	"break_started",
	"break_ended",
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
	// v1.0: a unit's own week (V-25) and the sample timetable giving way to real content (V-26)
	"unit_week_set",
	"sample_hidden",
	// v0.1 F-105, F-106
	"pack_started",
	"pack_stage",
	"pack_retry",
	"pack_ready",
	"pack_failed",
	"pack_checked", // v3.1: the small second check of a unit's questions { lectureId, asked, unanswerable, disagreed, model }
	"pack_check_skipped", // v3.1: that check failed, so the questions that passed the rules were kept { lectureId, error }
	"questions_rewrite", // v3.1: "Rewrite questions" on a module { module, units }
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
	// v2.2: "Re-plan the rest of my week" and its Undo
	"plan_replanned",
	"plan_replan_undone",
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
	// v2.2 part C: the place picked on a block's start ("Where are you?"). Logged for the test record; nothing reads it.
	"block_where",
	// v0.1 F-116
	"dictation_used",
	// v3.2: a guess made on a picture (right, another block, or "show me"), and a picture stepped to its end. Nothing reads them; they are for the study's records.
	"picture_gap",
	"picture_done",
	// v0.1 F-118
	"motion_changed",
	// v0.1 dry run: the teacher stopped before the budget and was asked to continue
	"teacher_nudged",
	// facilitator: a question sent to the phone now (T4 in a lab)
	"phone_send_now",
	"phone_test_sent",
	// v1.1: Progress and the Week timetable (V-34 to V-37)
	"milestone_earned",
	"plan_module_set",
	"gap_closed",
	"gap_questions_written",
	"gap_questions_failed",
	// v2.0 step 5: Learn. What the student said is never logged, only that they did and how long it was.
	"learn_said",
	// v2.0 step 6: the first-time question and the notes (V-52, V-53). The notes' words are never logged.
	"how_answered",
	"learn_attached", // v3.1: a file attached to a Learn session { sessionId, kind, chars, images }
	"learn_intent", // v3.1: the first step answered { sessionId, module, suggestion: id|null, typed, check, attached }
	"note_edited",
	"note_rewritten",
	"note_rewrite_failed",
	// v2.0 step 7: the first run (V-45), modules added by hand (V-64) and a module's share of the week (V-63)
	"setup_timetable",
	"setup_week",
	"module_added",
	"module_share_changed",
	// v3.0: a module's colour picked in Me
	"module_colour_changed",
	"unit_renamed",
] as const;
export type CompanionEventType = (typeof COMPANION_EVENT_TYPES)[number];

/** Events the browser may log through POST /api/companion/events. */
export const CLIENT_EVENT_TYPES: readonly CompanionEventType[] = [
	"onboarding_step",
	"settings_changed",
	"break_started",
	"break_ended",
	"block_started",
	"error",
	"explainer_opened",
	"map_node_clicked",
	"dictation_used",
	"picture_gap",
	"picture_done",
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
	/** Units with at least one answer given on the phone (v2.3 part D): such a unit is not "not started". */
	phoneAnswered?: string[];
}
