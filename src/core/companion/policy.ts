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
} as const;

export const NUDGE_TEXT = {
	n1: (module: string, questions: number, minutes: number) =>
		`${module} just finished. ${questions} questions on it, about ${minutes} minutes?`,
	n2: (weekday: string, questions: number, minutes: number) =>
		`The one you missed on ${weekday}. ${questions} questions, about ${minutes} minutes.`,
	n3: (weekday: string) => `Missed ${weekday}'s lecture? Here it is in three 5-minute pieces.`,
	n4: (left: number, minutes: number) =>
		`Picking up where you left off. ${left} ${left === 1 ? "question" : "questions"} left, about ${minutes} minutes.`,
	// Not in behaviour-change.md §5: draft wording, confirm with the group.
	block: (minutes: number) => `Your study block starts now. ${minutes} minutes, at your own pace.`,
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
	reduceMotion: false,
};

/**
 * Screen copy that states a session's size (F-120). The figures always come
 * from SESSION_BUDGETS, so changing a budget changes every screen that
 * describes it.
 */
export const SESSION_COPY = {
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
