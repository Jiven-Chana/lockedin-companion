/**
 * Companion policy: every tunable number and every user-facing nudge string
 * in one place, each with the evidence it answers to. Change a knob here,
 * not inline in the rules, so design changes are one-line diffs with a
 * reviewable rationale.
 *
 * Nudge wording is verbatim from define/behaviour-change.md §5 and must
 * stay under 90 characters (Android and iOS truncate around there; R-4).
 */

import type { LearnScope, Profile, SessionBudget, SessionKind } from "./types.ts";

export const NUDGE_MAX_CHARS = 90;

/** Default session budgets per kind (Appendix B of the plan). */
export const SESSION_BUDGETS: Record<SessionKind, SessionBudget> = {
	"post-lecture": { questions: 5, minutes: 10 }, // N-1 wording; Q-4 (attention drifts within 20 min)
	block: { questions: 5, minutes: 10 },
	"missed-lecture": { questions: 6, minutes: 15, parts: 3 }, // N-3: three 5-minute pieces, 2 questions each
	retest: { questions: 3, minutes: 4 }, // N-2 wording
	"try-now": { questions: 3, minutes: 3 }, // J1: taste before setup
	practise: { questions: 5, minutes: 3 }, // V-40: a quick round across a module (PRACTISE_RULES)
	learn: { questions: 0, minutes: 50 }, // V-47: no question count; as long as a study block (LEARN_RULES)
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
	/** The laptop says how question 1 went on the phone (lo-fi task 1; AFF-H). */
	toast: (more: number, correct = true) => (correct ? `Question 1 answered on your phone ✓ ${more} more ready.` : `Question 1: not quite. It comes back in your next Practise. ${more} more ready.`),
	title: "From your phone",
	/** Today's card for a session that is waiting: which question it opens on. */
	ready: (question: number) => (question > 1 ? `Ready now · picks up at question ${question}` : "Ready now · question 1 is waiting"),
	/** The phone's "N more on your laptop": the post-lecture budget minus the phone's question. */
	more: () => SESSION_BUDGETS["post-lecture"].questions - 1,
	relayHolds: "Lecture names and times, your phone's questions and answers, your study block times. Never your location, slides, notes or AI key.",
} as const;

/**
 * Me → Phone on the laptop (v1.0.3): one panel with the QR code, three
 * steps, the 6-digit code, and a status line that changes by itself.
 */
export const PHONE_PAIR_COPY = {
	title: "Get questions on your phone",
	steps: ["Scan this with your phone's camera", "Add LockedIn to your Home Screen and open it", "Type this code into it:"],
	/** "482915" → "482 915": read aloud in two groups, as the phone shows it back. */
	code: (code: string) => `${code.slice(0, 3)} ${code.slice(3)}`,
	noCode: "Can't reach the phone relay to get a code. Check your connection.",
	android: "On Android there is nothing to add or type: scan, then allow notifications.",
	cantScan: "Can't scan?",
	openAddress: (address: string) => `Open ${address} in your phone's browser instead.`,
	waiting: "Waiting for your phone…",
	opened: "Your phone opened it. Finish there.",
	paired: "✓ Paired. Questions reach your phone, even when this laptop is closed.",
	start: "Get questions on your phone",
	showAgain: "Pair a phone again",
} as const;

/**
 * The learning score on Progress (v1.1, V-34): points build up as you learn
 * and are never taken away for being wrong. Learning earns far more than
 * discipline. The one way the score dips is an idea left untouched too long.
 */
export const SCORE_RULES = {
	/** A right answer, by the question's difficulty (1 to 3). */
	rightAnswer: { 1: 10, 2: 15, 3: 20 } as Record<number, number>,
	/** Difficulty assumed for a question the teacher wrote (no bank difficulty). */
	defaultDifficulty: 2,
	/** The first right answer on an idea. */
	ideaSecured: 20,
	/** A right answer on an idea that was waiting in "to revisit". */
	cameBack: 25,
	/** Starting a study block you planned. */
	blockStarted: 5,
	/** An idea you secured and haven't got right again for this long is fading… */
	fadeAfterDays: 21,
	/** …and takes this much off the score while it is. One right answer brings it back. */
	fadePoints: 5,
	/** Term length for the steady-pace line when there is no timetable to read its end from. */
	termWeeksWithoutTimetable: 12,
	/** "Needs attention" compares modules over this many days (a week is too short for a module taught once a week). */
	attentionDays: 14,
	/** One answer counts for at most this much time (a tab left open is not study). */
	maxMinutesPerAnswer: 10,
} as const;

/** Progress: the wording of the score, its chart and "needs attention" (v1.1). Never "behind", never a deficit number. */
export const PROGRESS_COPY = {
	score: "Learning score",
	steadyPace: "Steady pace",
	steadyPaceHelp: "A straight line to securing every idea in your study packs by the end of term.",
	ranges: { week: "Week", month: "Month", term: "Term" },
	thisWeek: (points: number) => `${points >= 0 ? "+" : "−"}${Math.abs(points)} this week`,
	whereFrom: "Where it came from",
	attention: "Needs attention",
	nothingNeeds: "Nothing needs attention. Every module with material has had some of your time.",
	nothingOn: (module: string, days: number | null) => (days === null ? `Nothing on ${module} yet` : `Nothing on ${module} for ${days} ${days === 1 ? "day" : "days"}`),
	leastOn: (module: string) => `Least on ${module} in the last two weeks`,
	questionsOn: (n: number, unit: string) => `${n} questions on ${unit}`,
	fading: (n: number, module: string) => `${n} ${n === 1 ? "idea" : "ideas"} fading in ${module}`,
	getBack: (n: number) => (n === 1 ? "Get it back" : "Get them back"),
	noMaterial: (modules: readonly string[]) => `No slides or notes yet for ${modules.length > 1 ? `${modules.slice(0, -1).join(", ")} and ${modules.at(-1)}` : modules[0]}`,
	addMaterial: "Add material",
	milestones: "Milestones",
	earned: (n: number, of: number) => `${n} of ${of}`,
} as const;

/**
 * Milestones (v1.1, V-35): earned from real history, dated, kept for good.
 * None needs an unbroken chain: "three full weeks" is any three. `how` is
 * what the student reads on one not earned yet.
 */
export const MILESTONES = [
	{ id: "first-idea", group: "learning", title: "First idea secured", how: "Get a question right on an idea for the first time." },
	{ id: "ideas-10", group: "learning", title: "10 ideas secured", how: "Secure 10 ideas across your course." },
	{ id: "ideas-25", group: "learning", title: "25 ideas secured", how: "Secure 25 ideas across your course." },
	{ id: "ideas-50", group: "learning", title: "50 ideas secured", how: "Secure 50 ideas across your course." },
	{ id: "unit-secured", group: "learning", title: "A whole unit secured", how: "Secure every idea in one unit's study pack." },
	{ id: "came-back", group: "learning", title: "Came back", how: "Get an idea right after it went to “to revisit”." },
	{ id: "comebacks-10", group: "learning", title: "10 comebacks", how: "Get 10 ideas back from “to revisit”." },
	{ id: "first-block", group: "discipline", title: "First study block kept", how: "Start a study block you planned." },
	{ id: "full-week", group: "discipline", title: "A full week kept", how: "Start every study block you accepted in one week." },
	{ id: "full-weeks-3", group: "discipline", title: "Three full weeks kept", how: "Keep three full weeks. Any three: they needn't be in a row." },
	{ id: "first-checkin", group: "discipline", title: "First Sunday check-in", how: "Answer the Sunday check-in." },
	{ id: "first-phone", group: "discipline", title: "First question on your phone", how: "Answer a question from a notification." },
	{ id: "two-modules", group: "rounded", title: "Two modules in one week", how: "Earn points in two modules in the same week." },
	{ id: "all-modules", group: "rounded", title: "Every module in one week", how: "Earn points in every module you have material for, in the same week." },
	{ id: "all-material", group: "rounded", title: "Material for every module", how: "Add slides or notes for every one of your modules." },
] as const;

export type MilestoneId = (typeof MILESTONES)[number]["id"];
export const MILESTONE_GROUPS = { learning: "Learning", discipline: "Discipline", rounded: "Well-rounded" } as const;

/** The Week timetable (v1.1, V-37): why a study block can't go where it was dropped. */
export const PLACEMENT_COPY = {
	lecture: "That overlaps a lecture or class.",
	commitment: "That overlaps something in your routine.",
	block: "Another study block is already there.",
	quiet: "That's in your quiet hours.",
	"past-midnight": "A study block has to end the same day.",
	freeStudy: "Free study",
	/** Dragging snaps to this many minutes. */
	snapMinutes: 15,
} as const;

/** Me → Phone: "Send a test question to my phone" (v1.0.4), so a student can see their phone works without waiting for a lecture. */
export const PHONE_TEST_COPY = {
	button: "Send a test question to my phone",
	/** The notification's title. Not "… just finished": nothing has. */
	title: "A test question from LockedIn",
	sent: "Sent. It arrives within a minute. Lock your phone to see it arrive.",
	nothing: "There's no question to send yet: a test question comes from your own study packs. Add your slides or notes in the Library first.",
} as const;

/** Spacing for retests: due 1 day later, then 3, then 7 (§6.8). */
export const MISS_SPACING_DAYS = [1, 3, 7] as const;
/** A correct answer at or above this confidence in a retest makes a miss solid. */
export const SOLID_CONFIDENCE = 70;
/** A correct answer at or below this confidence is a fragile, lucky answer (AE2-6). */
export const LOW_CONFIDENCE = 30;

/** Study blocks (§7.7). */
/** How sure you are, as four taps (lo-fi v8; design log 23 Nov). The values are the engine's own confidence stops. */
export const CONFIDENCE_TAPS = [
	{ label: "Guess", value: 0 },
	{ label: "Unsure", value: 30 },
	{ label: "Fairly sure", value: 70 },
	{ label: "Certain", value: 100 },
] as const;

/**
 * Gaps by idea (V-39, V-43). An idea leaves the list after `rightAnswers`
 * right answers on different questions, on different days, each at
 * `sureConfidence` or above ("Fairly sure" or "Certain"). `newQuestions` is how
 * many the AI writes for "Practise this idea".
 */
export const GAP_RULES = { rightAnswers: 2, sureConfidence: 70, newQuestions: 5, minUsable: 3 } as const;

/** Gaps by idea, in words. Nothing is dated or called overdue (R-6): a gap is something ready to grow (V-49). */
export const GAP_COPY = {
	title: "Ideas to revisit",
	empty: "Nothing to revisit. Anything you get wrong, or right but unsure, shows up here by idea.",
	ideas: (n: number) => `${n} ${n === 1 ? "idea" : "ideas"}`,
	missed: (n: number) => `${n} missed`,
	/** How far an idea is towards leaving the list (V-43). */
	progress: (right: number, needed: number) => (right === 0 ? `Leaves this list after ${needed} right answers, on different days, when you're fairly sure or certain.` : `${right} of ${needed} right answers towards leaving this list. One more, on another day.`),
	practise: "Practise this idea",
	/** While the AI writes questions around the gap (AFF-H: say what is happening during a wait). */
	writing: (n: number) => `Writing ${n} new questions on this…`,
	/** Every question from a study pack is written by the AI from the student's slides, and says so (X-9). */
	writtenByAi: (slide: number | null) => (slide ? `Written by AI from slide ${slide}` : "Written by AI from your slides"),
	youChose: "You chose",
	dontKnow: "You said you didn't know",
	unsure: "Right, but you weren't sure",
	answer: "Answer",
	wholeUnit: (unit: string) => `${unit} (in general)`,
	noQuestions: "No more questions on this idea for now.",
} as const;

/**
 * Practise (V-40): a round's size, and how much of it may go to repair.
 * `gapShare` keeps a round mixed: at most this share goes to ideas with a gap
 * or fading while other ideas are available.
 */
export const PRACTISE_RULES = { questions: 5, minutes: 3, more: 3, gapShare: 0.6 } as const;

/** Practise, in words (V-50: on screen the mode is "Practise"). */
export const PRACTISE_COPY = {
	mode: "Practise",
	learnMode: "Learn",
	button: "Practise this module",
	thisButton: "Practise this",
	noQuestions: "No questions for this module yet. Add its slides or notes and they'll be written for you.",
	noMore: "That's every question this module has for now.",
} as const;

/** A session you left is offered again on Today for this long (R-5). */
/**
 * Learn (V-47, V-54): the tutor teaching, loose on top of the probe, learn,
 * predict, check loop. The opening questions are sized to what the student
 * asked for (the plan's section 3: a week up to 4, a lecture up to 2, one
 * section 1); a sitting is as long as a study block and never ends by itself.
 */
export const LEARN_RULES = {
	probe: { week: 4, lecture: 2, section: 1 } as Record<LearnScope, number>,
	/** The plan is sized to the time: about one idea per this many minutes, and never fewer or more than these. */
	minutesPerIdea: 10,
	minIdeas: 2,
	maxIdeas: 8,
	/** A sitting started outside a block lasts the student's usual block length; this when they have none set. */
	defaultMinutes: 50,
	/** Slides sent in the opening message, in estimated tokens. The tutor reads the rest from the file as the plan reaches it. */
	slideTokenBudget: 8_000,
	/** A typed goal: how many matching topics the start sheet offers. */
	suggestions: 3,
	/** A typed goal is at most this long. */
	goalMax: 300,
	/** What the student types to the tutor is at most this long. */
	sayMax: 2_000,
	/** Nothing running and the tutor's turn still not started after this long: the student can carry on themselves. */
	stalledMs: 20_000,
} as const;

/** What LockedIn sends the tutor on the student's behalf. The tutor's instructions (companion/seed/prompts) name these exact lines. */
export const LEARN_SAYS = {
	skipProbe: "Skip, just teach me.",
	planOk: "Looks good.",
	carryOn: "Carry on.",
} as const;

export const LEARN_COPY = {
	button: "Learn this",
	moduleButton: "Learn",
	ideaButton: "Learn this idea",
	/** The label on a question that is never marked (LIT-26, LIT-30; AE2-9: opening questions read as a test). */
	guess: "Have a guess · nothing is marked",
	check: "Check",
	yourTurn: "In your own words",
	skipProbe: "Skip, just teach me",
	planOk: "Looks good",
	carryOn: "Carry on",
	finish: "Finish",
	say: "Ask or say something…",
	saySpeak: "Ask or say something… (or press Speak)",
	sent: "Sent. Your tutor picks it up at its next pause.",
	you: "You",
	planTitle: "The plan for this session",
	planTab: "Plan",
	slideTab: "Slide",
	earlier: (n: number) => `Earlier in this session (${n})`,
	/** The line under the title: where you are and what is next (INT-02-c). */
	position: (index: number, total: number, title: string, next?: string) => `Idea ${index} of ${total} · ${title}${next ? ` → next: ${next}` : ""}`,
	before: (total: number) => `${total} ${total === 1 ? "idea" : "ideas"} on the plan`,
	finding: "Finding where to start",
	minutesLeft: (n: number) => `${n} min`,
	timeUp: (minutes: number) => `That's your ${minutes} minutes. Stop here or keep going.`,
	goal: (minutes: number) => `About ${minutes} minutes · stop any time, it is saved with its plan`,
	reading: (module: string) => `Reading your ${module} slides…`,
	writing: "Your tutor is writing…",
	making: { visual: "Drawing this for you, about a minute. Carry on.", demo: "Building something you can try, about a minute. Carry on.", research: "Looking this up. Carry on." },
	failed: { visual: "The picture didn't work this time.", demo: "The demo didn't work this time.", research: "The look-up didn't come back." },
	madeBy: "Made by your AI tutor",
	sources: "Sources",
	guessed: "Your guess",
	guessAnswer: "The answer",
	covered: (ideas: readonly string[]) => (ideas.length ? `You covered: ${ideas.join(", ")}.` : "You made a start."),
	doneTitle: (title: string) => `Done: ${title}.`,
	savedAt: (at: { index: number; total: number; title: string } | undefined) => (at && at.index > 0 ? `Saved at ${at.title}, idea ${at.index} of ${at.total}. Pick up any time. Nothing is marked missed.` : "Saved where you stopped. Pick up any time. Nothing is marked missed."),
	pickUp: "Pick up where you stopped",
	/** A study block's two buttons (step 5): the suggested mode with its reason, and the other one, smaller. */
	blockWhy: { unfinished: "pick up where you stopped", "not-yet": "you haven't yet", learned: "you've learned it", "no-ai": "your AI isn't connected" },
	blockMode: (study: "learn" | "practise", why: "unfinished" | "not-yet" | "learned" | "no-ai") => `${study === "learn" ? "Learn this" : "Practise this"} · ${LEARN_COPY.blockWhy[why]}`,
	instead: (study: "learn" | "practise") => (study === "learn" ? "Learn instead" : "Practise instead"),
	notConnected: "Learn needs your AI connected. Practise works without it.",
	connect: "Connect",
	/** The module's start sheet (AFF-K: one small step; INT-02-b: no menu of choices). */
	sheetTitle: (module: string) => `Learn · ${module}`,
	start: (title: string) => `Start: ${title}`,
	nextInCourse: (minutes: number) => `next in your course · about ${minutes} min`,
	stoppedIn: (lecture: string, at: { index: number; total: number } | null) => (at && at.index > 0 ? `${lecture} · idea ${at.index} of ${at.total}` : lecture),
	orSay: "or say what you want to cover",
	sayPlaceholder: "e.g. mixed strategies, I've seen it but can't do the maths",
	thisWeek: (n: number) => `This week (${n} ${n === 1 ? "lecture" : "lectures"})`,
	allLectures: "All lectures",
	noMatch: (module: string) => `Nothing in your ${module} material matches that yet. Pick a lecture:`,
	nothingToLearn: "No slides or notes for this module yet. Add them in the Library and Learn opens up.",
	nothingThisWeek: "No lectures with slides for this week yet.",
	weekTitle: (week: number, lectures: number) => `Week ${week} · ${lectures} lectures`,
} as const;

/**
 * What LockedIn knows about you (V-52, V-53). The first-time card is one
 * card, once per module (AE2-P14: a short questionnaire felt like sixty
 * questions). The notes are short enough to hand the tutor every session.
 */
export const NOTE_RULES = {
	howWords: 120,
	whereWords: 250,
	moreMax: 300,
	/** "Where you are" is rewritten on the cheap model, so the tutor's own turn stays fast. */
	slot: "cheap",
} as const;

/** The first-time card's rows. Each choice is said to the tutor in the words on the right. */
export const HOW_ROWS = [
	{ key: "start", label: "Start with", options: [{ value: "examples", label: "Examples", says: "Start each idea with a worked example." }, { value: "questions", label: "Questions", says: "Start each idea with a question for me to try." }, { value: "explanations", label: "Explanations", says: "Explain each idea first, then ask." }] },
	{ key: "steps", label: "Steps", options: [{ value: "small", label: "Small steps", says: "Small steps." }, { value: "big", label: "Bigger jumps", says: "Bigger jumps: don't spell out what I can see." }] },
	{ key: "check", label: "Check me", options: [{ value: "often", label: "Often", says: "Check me often." }, { value: "end", label: "Only at the end of an idea", says: "Check me only at the end of an idea." }] },
] as const;

export const NOTE_COPY = {
	askTitle: (module: string) => `How do you like to learn ${module}?`,
	askOnce: "Asked once. You can change it later.",
	more: "Anything else? Type or say it…",
	same: "Same as my other modules",
	skip: "Skip",
	start: "Start",
	link: "What LockedIn knows",
	title: (module: string) => `What LockedIn knows about you in ${module}`,
	how: "How you learn it",
	where: "Where you are",
	last: "Last session",
	noHow: "Nothing yet. Your tutor uses its usual way: a guess, the explanation, then a check.",
	noWhere: "Nothing yet. It is written after your first Learn session in this module.",
	noLast: "No Learn session in this module yet.",
	stoppedAt: (index: number, total: number, title: string, lecture: string) => (index > 0 ? `${lecture}: stopped at idea ${index} of ${total}, ${title}.` : `${lecture}: stopped before the first idea.`),
	finishedAt: (lecture: string) => `${lecture}: finished.`,
	updated: (when: string) => `updated ${when}`,
	byYou: "edited by you",
	edit: "Edit",
	save: "Save",
	cancel: "Cancel",
	readBy: "Your tutor reads these at the start of every session. \"Delete all my data\" in Me removes them.",
	tooLong: (words: number) => `Keep it under ${words} words.`,
} as const;

export const RESUME_RULES = { offerDays: 7, minutesPerQuestion: 2 } as const;

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
	/** A failed stage is tried again after each of these waits (V-23). */
	retryDelaysMs: [10_000, 30_000, 90_000],
	/** While the AI connection is down, look again this often. Waiting doesn't use up a try. */
	connectionCheckMs: 30_000,
} as const;

/** What the lecture page says about a study pack that isn't being written right now (v1.0 T-4, T-5). */
export const PACK_COPY = {
	queued: "Waiting its turn.",
	retrying: (seconds: number) => `Your AI was busy. Trying again in ${seconds} seconds.`,
	waitingForConnection: "Waiting for your AI connection.",
	failed: (tries: number) => `Your AI didn't answer after ${tries} tries.`,
	tooShort: "There's too little here to study from. Add more material.",
	noMaterial: "This unit has no slides or notes yet.",
	tryAgain: "Try again",
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
	/** Starting a block (V-44). */
	start: "Start",
	startedNote: "Started ✓",
	notToday: "A block starts on its own day. Move it to today to start it now.",
	/** The block's tiny first step (S-67): the slide its first question comes from. */
	firstStep: (slide: number | null) => (slide ? `First step: slide ${slide}, one question` : "First step: one question"),
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
	/**
	 * A calendar event whose title has one of these words is a deadline, never
	 * a lecture (v1.0 K-1, V-28): a Canvas "HCI coursework due" at 23:00 must
	 * not send "HCI just finished". Not "quiz" or "test": those can be taught.
	 */
	deadlineWords: ["due", "deadline", "assignment", "coursework", "submission", "hand-in", "hand in"],
} as const;

/** The AI connection check on the Connect screen and Me (v1.0 D-1): it never sits on "Checking…" for good. */
export const CONNECT_RULES = {
	statusTimeoutMs: 15_000,
} as const;
export const CONNECT_COPY = {
	checking: "Checking your AI connection…",
	slow: "Checking your AI connection is taking longer than usual.",
	failed: "Couldn't check your AI connection.",
	tryAgain: "Try again",
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
	/** A unit needs at least this much text to be saved or to get a study pack (V-24): a pack is at least 2 ideas and 12 questions. */
	minUnitChars: 500,
	/** The slide panel's picture of a PDF page (V-21): sharp on a laptop screen, a few hundred KB a page. */
	pageImageDpi: 120,
	/** Above this many slides the panel hides its row of dots (a long deck would be a strip of 80). */
	maxSlideDots: 20,
} as const;

/** A unit whose material doesn't say which week it belongs to has week 0. It never reads "Week 0" (v1.0 V-25). */
export const WEEK_COPY = {
	week: (n: number) => `Week ${n}`,
	notSet: "Week not set",
	set: "Set week",
} as const;

/** The upload screen's wording (v1.0 S-4, T-5). */
export const MATERIALS_COPY = {
	drop: "Drop all your slides and notes here. Several files at once is fine.",
	/** Was "Week 1: …", which invited typing a week label on its own. */
	pastePlaceholder: "Paste your notes here",
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
	/** The block's notification names its tiny first step when there is one (S-67, V-44). */
	block: (minutes: number, firstStep?: string | null) => (firstStep ? `Your study block starts now. ${firstStep}.` : `Your study block starts now. ${minutes} minutes, at your own pace.`),
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
	/** Where you are in the set: the question you are on, not how many are behind you (lo-fi task 1). */
	position: (n: number, total: number) => `Question ${n} of ${total}`,
	/** The done screen (R-6; design log 23 Nov): no score. It names what comes back, and the next block. */
	doneTitle: (n: number, title: string) => `Done: ${n} ${n === 1 ? "question" : "questions"} on ${title}.`,
	comingBack: (ideas: readonly string[]) => (ideas.length ? `Coming back in your next Practise: ${ideas.join(", ")}.` : "Nothing to come back to from this one."),
	noScore: "No streak, no score to keep up.",
	nextBlock: (when: string) => `Next: ${when} block, already in your week.`,
	/** The end of a set (INT-03-c, S-69): a break is offered here and never mid-question. */
	setFinished: "Set finished. Good place to stop for a bit.",
	setFinishedShort: "Set finished",
	breakRule: "Breaks only come at the end of a set, never mid-question.",
	takeBreak: (minutes: number) => `Take a ${minutes}-min break`,
	moreQuestions: (n: number) => `${n} more questions`,
	finish: "Finish for today",
	onBreak: (until: string) => `On a break until ${until}.`,
	breakNote: "One buzz when it's over, and nothing is lost if you take longer.",
	breakOverButton: "Break's over",
	breakEnded: "Break's over. Ready when you are.",
	/** Leaving a session (R-5): where it was saved, on Today's card. */
	savedAt: (question: number) => `Saved at question ${question}. Pick up any time. Nothing is marked missed.`,
	left: (questions: number, minutes: number) => `${questions} ${questions === 1 ? "question" : "questions"} left, about ${minutes} ${minutes === 1 ? "minute" : "minutes"}`,
	/** How sure you are: four taps, none preselected (design log 23 Nov; AE2-5, AE2-8). */
	confidenceAsk: "How sure are you?",
	confidenceRevisitHint: "An idea leaves your list when you get it right and are fairly sure or certain.",
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
	/** A study block's first step (V-44): the teacher opens on it. */
	firstStepLine: (stem: string, slide: number | null) => `First step of this study block: open with a question on the same point as "${stem}"${slide ? ` (Slide ${slide})` : ""}.`,
	noRepliesLine: "The learner can't type replies here: after your feedback, ask the next question in the same turn.",
	continueText: "Next question, please.",
} as const;
