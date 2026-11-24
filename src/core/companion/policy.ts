/**
 * Companion policy: every tunable number and every user-facing nudge string
 * in one place, each with the evidence it answers to. Change a knob here,
 * not inline in the rules, so design changes are one-line diffs with a
 * reviewable rationale.
 *
 * Nudge wording is verbatim from define/behaviour-change.md §5 and must
 * stay under 90 characters (Android and iOS truncate around there; R-4).
 */

import type { Profile, SessionBudget, SessionKind } from "./types.ts";

export const NUDGE_MAX_CHARS = 90;

/** Default session budgets per kind (Appendix B of the plan). */
export const SESSION_BUDGETS: Record<SessionKind, SessionBudget> = {
	"post-lecture": { questions: 5, minutes: 10 }, // N-1 wording; Q-4 (attention drifts within 20 min)
	block: { questions: 5, minutes: 10 },
	"missed-lecture": { questions: 6, minutes: 15, parts: 3 }, // N-3: three 5-minute pieces, 2 questions each
	retest: { questions: 3, minutes: 4 }, // N-2 wording
	"try-now": { questions: 3, minutes: 3 }, // J1: taste before setup
};

/** "Keep going" adds this many questions (§6.7). */
export const KEEP_GOING_QUESTIONS = 3;

export const NUDGE_RULES = {
	/** R-1: hard cap; the student picks 1 (default) or 2. */
	maxPerDay: 2,
	/** N-1 fires this long after the lecture ends… */
	n1DelayMinutes: 5,
	/** …and by this long after, even if the session is still preparing (§6.3). */
	n1FireByMinutes: 15,
	/** N-1 needs this much free time after the lecture (behaviour-change §5). */
	n1MinGapMinutes: 45,
	/** "…just finished" stops being true: N-1 is not sent later than this after the end. */
	n1ValidMinutes: 60,
	/** N-2 needs a free gap with at least this much left. */
	n2MinGapMinutes: 30,
	/** N-2/N-3 may fire this long after their slot opens if not yet ready. */
	fireGraceMinutes: 10,
	/** N-3 pre-warms this long before the evening slot. */
	n3PrepareLeadMinutes: 10,
	/** N-3 only offers lectures missed within this many days. */
	n3LookbackDays: 7,
	/** N-3 fires at most once per this many days. */
	n3CooldownDays: 7,
	/** N-4: the earliest return is this long after the snooze… */
	snoozeMinDelayMinutes: 60,
	/** …in a free gap at least this long; otherwise the same time tomorrow. */
	snoozeMinGapMinutes: 15,
	/** A fired-but-untouched nudge stays on screen this long. */
	bannerTtlMinutes: 120,
	/** Pre-warmed sessions cost a pair of model turns each; cap them per day (§13 cost). */
	maxPrewarmPerDay: 3,
	/**
	 * Open decision 6 (§14): does a study-block start count toward the daily
	 * cap? Default no — the student scheduled it — until the group decides.
	 */
	blockCountsTowardCap: false,
} as const;

/** "Why now" on every nudge (R-7, F-114). Short, factual, never guilt. */
export const WHY_TEXT = {
	afterLecture: (module: string, until: string | null) => `after ${module}${until ? ` · you're free until ${until}` : ""}`,
	freeGap: (until: string | null) => (until ? `you're free until ${until}` : "you're free now"),
	evening: "your evening slot",
	snooze: "you asked me to come back",
	block: "your study block",
	sunday: "Sunday: planning next week",
} as const;

/** The 7-day schedule for the phone relay (F-112, F-114). */
export const SCHEDULE_RULES = {
	days: 7,
	/** Simulation step. Nudges land on this grid (N-1 at end + 5 lands exactly). */
	stepMinutes: 5,
} as const;

/** The phone hand-off (F-112, spec Appendix A). */
export const HANDOFF_COPY = {
	toast: (more: number) => `Question 1 answered on your phone ✓ ${more} more ready.`,
	title: "From your phone",
	/** The phone's "N more on your laptop": the post-lecture budget minus the phone's question. */
	more: () => SESSION_BUDGETS["post-lecture"].questions - 1,
	relayHolds: "Lecture names and times, your phone's questions and answers, your study block times. Never your location, slides, notes or AI key.",
} as const;

/** Spacing for retests: due 1 day later, then 3, then 7 (§6.8). */
export const MISS_SPACING_DAYS = [1, 3, 7] as const;
/** A correct answer at or above this confidence in a retest makes a miss solid. */
export const SOLID_CONFIDENCE = 70;
/** A correct answer at or below this confidence is a fragile, lucky answer (AE2-6). */
export const LOW_CONFIDENCE = 30;

/** Study blocks (§7.7). */
export const BLOCK_RULES = {
	maxBlocks: 2,
	minMinutes: 10,
	maxMinutes: 120,
	defaultMinutes: 25,
	/** Pomodoro: apps reopen for breakMinutes after every focusMinutes. */
	focusMinutes: 25,
	breakMinutes: 5,
	/** "Firm" lock lets the student through for this long after they say why. */
	overrideMinutes: 2,
} as const;

/** Study packs (F-105). Slots per stage: open decision O-13, built with the spec's proposed default. */
export const PACK_RULES = {
	/** A bank stem must fit a phone notification body (N-1 v2). */
	stemMax: 90,
	explanationMax: 140,
	explainerWords: 120,
	bankMin: 12,
	bankMax: 20,
	maxNodes: 10,
	/** Explainers per pack: one per map node, at most this many. */
	maxExplainers: 8,
	/** Which of the student's model slots writes each stage (O-13). */
	slots: { map: "strong", explainers: "strong", bank: "cheap" } as const,
	/** Slides text sent to the model, in estimated tokens (~4 characters each). */
	slideTokenBudget: 12_000,
} as const;

/**
 * The weekly plan (F-110, V-5) and the pacing rule (spec §5.5, V-18).
 * Defaults chosen in the build (DECISIONS.md V-18), open to the group.
 */
export const PLAN_RULES = {
	defaultBlockMinutes: 50,
	minBlockMinutes: 25,
	maxBlockMinutes: 90,
	maxBlocksPerDay: 2,
	maxBlocksPerWeek: 10,
	/** Gap kept free either side of a lecture, event or commitment. */
	bufferMinutes: 10,
	/** Block starts are rounded to this many minutes. */
	slotStepMinutes: 15,
	/** Energy windows, local times. */
	energy: { morning: ["08:00", "12:00"], afternoon: ["12:00", "17:00"], evening: ["17:00", "22:00"] } as const,
	/** Pacing: catch-up on older weak units gets at most this share of the week's blocks… */
	gapShare: 1 / 3,
	/** …and only units at most this many weeks behind the current week. */
	maxGapWeeksBack: 6,
	/** "Keep up" covers the current week and this many before it. */
	keepUpWeeksBack: 1,
} as const;

export const DEFAULT_PLAN: NonNullable<Profile["plan"]> = {
	weeklyTargetMinutes: null,
	blockMinutes: 50,
	sundayTime: "19:00",
	focusScreen: false,
};

/** "Plan my week with me" (F-109, J8): about 6 turns, short turns, on a fast slot. */
export const SETUP_CHAT_RULES = { maxTurns: 6, maxWords: 60, slot: "cheap" } as const;

/** Sunday check-in (F-111, V-5): the target moves in these steps, within these bounds. */
export const CHECKIN_RULES = { stepMinutes: 30, minTargetMinutes: 30 } as const;

/** Wording for the plan and the check-in (spec Appendix A, draft, group to confirm). Never "missed", "overdue", "behind". */
export const PLAN_COPY = {
	hours: (minutes: number) => {
		const h = Math.floor(minutes / 60);
		const m = minutes % 60;
		return h && m ? `${h} h ${m}` : h ? `${h} h` : `${m} min`;
	},
	weekTooFull: (minutes: number) => `Your week only has room for ${PLAN_COPY.hours(minutes)}. I've planned that.`,
	checkin: (started: number, minutes: number) =>
		`Last week: ${started} ${started === 1 ? "block" : "blocks"} started, ${PLAN_COPY.hours(minutes).replace(/ h (\d+)$/, " h $1 min")}. How did it feel?`,
	feelings: { "too-much": "Too much", "about-right": "About right", "too-little": "Too little" } as const,
	targetProposal: (minutes: number) => `Try ${PLAN_COPY.hours(minutes)} next week?`,
	keepTarget: (minutes: number) => `Keep ${PLAN_COPY.hours(minutes)}`,
	yes: "Yes",
} as const;

/** Calendars in (F-108). */
export const CALENDAR_RULES = {
	/** A subscribed link is re-read when the app opens and at least this often while it runs. */
	refreshHours: 6,
	/** Events read from this many days back to this many days ahead. */
	lookbackDays: 28,
	lookaheadDays: 120,
} as const;

/** Onboarding step 2's "Where do I find my link?" (decided 24 Nov; the Birmingham route was found 24 Nov). */
export const CALENDAR_COPY = {
	findLinkLabel: "Where do I find my link?",
	findLink: [
		"University of Birmingham: in the myUoB app, open Calendar → Go to event → Download, then copy the link it gives you.",
		"Google, Outlook or Apple: use the calendar's “secret iCal address” or “publish” link.",
		"Keep it private: anyone with it can see your timetable.",
	],
} as const;

/** Course material (F-104, V-18). */
export const MATERIALS_RULES = {
	/** Per file, as v0.0's upload. */
	maxFileBytes: 25 * 1024 * 1024,
	maxFilesPerUpload: 20,
	/** Below this many pages a file with no week in its name stays one unit (not worth an AI call). */
	aiSplitMinPages: 12,
	/** Pasted text or a notes file is cut into pages of about this many characters when it has no headings. */
	textPageChars: 2_500,
	/** A proposal waits this long for the student to confirm it. */
	pendingUploadHours: 24,
} as const;

/** Five days away or more earns a "welcome back" (J6, R-6). */
export const WELCOME_BACK_DAYS = 5;

/** Session preparation (§6.3). */
export const PREPARE_RULES = {
	/** Mark the session `error` if question 1 has not appeared by then. */
	readyTimeoutMs: 60_000,
	pollMs: 500,
	/** Opening-message slide budget, in estimated tokens (~4 chars each). */
	slideTokenBudget: 8_000,
	/** After the teacher is asked for question 1 (V-22), wait at least this long for it. */
	afterNudgeMs: 30_000,
} as const;

/**
 * A session that failed says what happened and offers one main action
 * (v1.0 T-6). `sessionFailure` maps an engine code to one of these.
 */
export const SESSION_FAILURES = {
	no_question: { says: "The teacher didn't ask a question.", action: "retry" },
	timeout: { says: "Writing the question took too long.", action: "retry" },
	no_answer: { says: "Your AI didn't answer. Check your internet connection.", action: "retry" },
	not_connected: { says: "Your AI isn't connected.", action: "connect" },
	other: { says: "Something went wrong on our side.", action: "retry" },
} as const;

export const SESSION_FAILURE_ACTIONS = {
	retry: "Try again",
	connect: "Connect",
	practice: "Use practice questions",
	another: "Pick another lecture",
} as const;

export type SessionFailureKind = keyof typeof SESSION_FAILURES;

const FAILURE_KIND: Record<string, SessionFailureKind> = {
	no_question: "no_question",
	probe_not_done: "no_question",
	timeout: "timeout",
	turn_failed: "no_answer",
	engine_error: "no_answer",
	chat_missing: "no_answer",
	models_not_configured: "not_connected",
	provider_key_missing: "not_connected",
	not_connected: "not_connected",
	engine_unavailable: "not_connected",
};

/** The plain reason and main action for a session error code. A code that isn't a known one (a provider's own message) reads as "your AI didn't answer". */
export function sessionFailure(code: string | undefined): (typeof SESSION_FAILURES)[SessionFailureKind] & { kind: SessionFailureKind } {
	const kind: SessionFailureKind = !code ? "other" : (FAILURE_KIND[code] ?? (/^[a-z_:]+$/.test(code) ? "other" : "no_answer"));
	return { kind, ...SESSION_FAILURES[kind] };
}

export const NUDGE_TEXT = {
	n1: (module: string, questions: number, minutes: number) =>
		`${module} just finished. ${questions} questions on it, about ${minutes} minutes?`,
	n2: (weekday: string, questions: number, minutes: number) =>
		`The one you missed on ${weekday}. ${questions} questions, about ${minutes} minutes.`,
	n3: (weekday: string) => `Missed ${weekday}'s lecture? Here it is in three 5-minute pieces.`,
	n4: (left: number, minutes: number) =>
		`Picking up where you left off. ${left} ${left === 1 ? "question" : "questions"} left, about ${minutes} minutes.`,
	// Not in behaviour-change.md §5: draft wording, confirm with the group (O-14: kept as the draft).
	block: (minutes: number) => `Your study block starts now. ${minutes} minutes, at your own pace.`,
	// v0.1 F-114 (spec Appendix A, T20 v2 N-1, N-5)
	/** N-1 v2: the title; the body is the bank question's stem (≤ 90). `n1` above is the fallback when no question is ready. */
	n1Title: (module: string) => `${module} just finished. One question:`,
	n5: (lectures: number, gaps: number) => `Next week: ${lectures} ${lectures === 1 ? "lecture" : "lectures"}, ${gaps} free ${gaps === 1 ? "gap" : "gaps"}. Set your study blocks?`,
	n5Title: "Your week",
} as const;

export const DEFAULT_PREFS: Profile["prefs"] = {
	nudgesPerDay: 1, // R-1
	quietHours: { from: "22:00", to: "08:00" },
	lock: "off", // X-6, INT-01-b: off by default
	defaultMode: "question-first",
	eveningTime: "19:00",
};

export const DEFAULT_APPEARANCE: Profile["appearance"] = {
	theme: "system",
	accent: "blue",
	textSize: "medium",
	lineSpacing: "normal",
	motion: "calm",
};

/**
 * Motion timings (F-118, V-10). Interactions take 150 to 300 ms; only the
 * working indicator loops inside a session; the Full-only background drift
 * is slow (a cycle of 20 s or more) and never runs in a session.
 */
export const MOTION = {
	/** Fades, the soft check, a block sliding into its gap. */
	shortMs: 180,
	/** The explanation sliding in, the hand-off card, a cross-fade. */
	mediumMs: 260,
	/** The focus ring filling. */
	ringMs: 300,
	/** Map nodes and pack stages appear one after another, this far apart. */
	staggerMs: 60,
	/** Full only: page transitions. */
	pageMs: 150,
	/** Full only: one cycle of the time-of-day background drift. */
	driftSeconds: 24,
} as const;

/**
 * Screen copy that states a session's size (F-120). The figures always come
 * from SESSION_BUDGETS, so changing a budget changes every screen that
 * describes it.
 */
export const SESSION_COPY = {
	/** What the session screen says while it waits. */
	reading: (module: string) => `Reading your ${module} slides → writing question 1`,
	writing: (n: number) => `Writing question ${n}…`,
	/** Try-now card (J1). */
	tryNow: () => {
		const b = SESSION_BUDGETS["try-now"];
		return `${b.questions} questions on your last lecture, about ${b.minutes} minutes`;
	},
	/** The first taste in onboarding (J1′, O-3): the bundled sample lecture. */
	firstTaste: () => {
		const b = SESSION_BUDGETS["try-now"];
		return `${b.questions} questions on a sample lecture, about ${b.minutes} minutes`;
	},
	/** "Quiz me" on today's lecture. */
	quizMe: () => {
		const b = SESSION_BUDGETS["post-lecture"];
		return `${b.questions} questions, about ${b.minutes} minutes`;
	},
	/** Welcome back (J6): runs a try-now-sized session. */
	welcomeBackQuestion: () => `${SESSION_BUDGETS["try-now"].questions} questions on last week?`,
	welcomeBack: () => `Welcome back. ${SESSION_COPY.welcomeBackQuestion()}`,
	/** Onboarding: when nudges never arrive. */
	nudgeLimits: (quiet: Profile["prefs"]["quietHours"]) =>
		`Never during a lecture, never between ${quiet.from} and ${quiet.to}.`,
} as const;

/**
 * The first taste (spec J1′ step 3, open decision O-3, decided 23 Nov): 3
 * questions on this bundled sample lecture, prepared while the student is
 * still on the modules screen. It has real authored slides, so it works
 * for any student before they add their own.
 */
export const FIRST_TASTE_LECTURE = "hci-w3-personas";

/**
 * The declared fallback (F-102, V-16, option C's condition): when the
 * student's AI isn't ready, sessions run on the scripted engine and Today
 * says so plainly.
 */
export const AI_COPY = {
	fallback: "Not connected to your AI. Sessions use LockedIn's built-in practice questions until you reconnect.",
	fallbackAction: "Connect",
} as const;

/** The text sent as the "why" when the learner taps "Show me first" (§6.7). */
export const SHOW_ME_THINKING = "Show me a worked example first, then ask me again.";
export const HINT_REQUEST = "Give me a one-sentence hint for this question. Don't give the answer.";
export const keepGoingText = (n: number) => `Keep going: ${n} more questions on the same lecture.`;
/**
 * Keeping the real teacher going (dry run, 23 Nov): the session screen has no
 * text reply, so the opening message says so; and if a teacher still ends its
 * turn with feedback but no question before the budget, LockedIn sends the
 * continuation once, as the student would in LearnHarness. A second stop ends
 * the session.
 */
/** The laptop's phone link (F-112): upload at least every 30 min, pull events every minute; the facilitator's "send now" question. */
export const PHONE_RULES = {
	uploadEveryMs: 30 * 60_000,
	pullEveryMs: 60_000,
	timeoutMs: 10_000,
	replayedMemory: 1_000,
	/** Facilitator "send a question now": "Later" brings it back after 10 min; it expires after an hour. */
	sendNowSnoozeMs: 10 * 60_000,
	sendNowExpiresMs: 60 * 60_000,
} as const;

export const TEACHER_RULES = {
	noRepliesLine: "The learner can't type replies here: after your feedback, ask the next question in the same turn.",
	continueText: "Next question, please.",
} as const;
