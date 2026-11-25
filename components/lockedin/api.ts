/**
 * The LockedIn app's client for /api/companion (docs/companion/API.md).
 * Types come from the core barrel, the only src module components may import.
 */

import type { AiStatus, CatalogModel, Explainer, PackMeta, CompanionSession, DetectedModule, KeyProvider, LearnItem, LearnTopic, Lecture, NudgeRecord, Profile, Routine, ScoreRange, SessionSpec, SessionView, SlotChoices, StudyBlock } from "@/src/core";

export class ApiError extends Error {
	constructor(readonly status: number, readonly code: string, message: string) {
		super(message);
	}
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; raw?: BodyInit; headers?: Record<string, string> } = {}): Promise<T> {
	const res = await fetch(`/api/companion${path}`, {
		method: init.method ?? (init.body !== undefined || init.raw !== undefined ? "POST" : "GET"),
		headers: init.raw !== undefined ? init.headers : init.body !== undefined ? { "content-type": "application/json" } : undefined,
		body: init.raw ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
		cache: "no-store",
	});
	if (res.status === 204) return undefined as T;
	const text = await res.text();
	const data = text ? JSON.parse(text) : null;
	if (!res.ok) throw new ApiError(res.status, data?.code ?? "error", data?.error ?? `Request failed (${res.status})`);
	return data as T;
}

/** The pairing panel: the QR code, the 6-digit code an iPhone's app asks for (null when the relay can't be reached), and the short address. */
export type PhonePairing = PhoneStatus & { url: string; qrSvg: string; code: string | null; codeExpiresAt: string | null; address: string };
export interface PhoneStatus { paired: boolean; relay: string; phoneSeenAt?: string | null; pushReady?: boolean; uploadedAt?: string | null; holds: string; reachable?: boolean }
export interface PlanData {
	week: string;
	target: number | null;
	blockMinutes: number;
	committedMinutes: number;
	proposedMinutes: number;
	/** `module`: the block's module (the student's choice, else its unit's), or null for free study (V-37). */
	blocks: (Omit<StudyBlock, "module"> & { focus: { title: string; module: string } | null; module: string | null; firstStep: string | null; canStart: boolean; mode: BlockMode | null })[];
	lectures: Lecture[];
	commitments: Routine["commitments"];
	quietHours: { from: string; to: string };
	modules: { code: string; name: string; hasMaterial: boolean }[];
}
/** A study block's two buttons (step 5): the suggested mode with its reason, and the other one. */
export interface BlockMode { study: "learn" | "practise"; label: string; other: { study: "learn" | "practise"; label: string } | null }
export interface LearnSheet {
	module: { code: string; name: string };
	connected: boolean;
	minutes: number;
	suggestion:
		| { type: "resume"; sessionId: string; lectureId: string; title: string; at: { index: number; total: number; title: string } | null }
		| { type: "next"; lectureId: string; title: string }
		| null;
	week: { week: number; lectureIds: string[] } | null;
	lectures: { id: string; title: string; week: number }[];
	topics: LearnTopic[];
}
export interface ChatTurnData { say: string; chips?: string[]; done?: boolean; draft?: Record<string, unknown>; fallback?: boolean }
export interface CheckinData { started: number; minutes: number; text: string; target: number | null; nextWeek: string; roomMinutes: number; feelings: Record<string, string> }
export interface PackData { meta: PackMeta | null; explainers: Explainer[]; questions: number; running: boolean }
export interface CourseModule { code: string; name: string; weekOneStart?: string; readingWeeks?: number[]; week: number | null; reading: boolean; units: LectureWithStatus[] }
export interface MaterialProposal {
	uploadId: string;
	files: { file: number; name: string; kind: "pdf" | "text"; pageCount: number; noText: number[]; units: { title: string; week: number; pages: [number, number]; chars: number }[]; via: "name" | "ai" | "fallback"; note: string | null }[];
}
export type AiFullStatus = AiStatus & { catalog: CatalogModel[] };
export interface FirstTaste { lectureId: string; title: string; module: string; sample: boolean; spec: SessionSpec }

/** Gaps by idea (V-39, V-43). */
export interface GapsData {
	ideas: number;
	modules: {
		code: string;
		name: string;
		ideas: {
			key: string; lectureId: string; nodeId: string; module: string; unit: string; title: string;
			missed: number; right: number; needed: number; confidentError: boolean; canPractise: boolean;
			questions: { id: string; text: string; chosen: string[]; reason: "wrong" | "dont-know" | "low-confidence"; correct: string[]; explanation: string | null; slide: number | null; at: string }[];
		}[];
	}[];
}
export type Banner = (NudgeRecord & { ready: boolean; startsAt: number }) | null;
export type LectureWithStatus = Lecture & { status: "answered" | "revisit" | "not-started"; revisit: number };

export interface TodayData {
	now: string;
	onboarded: boolean;
	tryNow: { lectureId: string; title: string; module: string; spec: SessionSpec } | null;
	lectures: LectureWithStatus[];
	nextBlock: { blockId: string; start: string; end: string; status: StudyBlock["status"]; canStart: boolean; firstStep: string | null; mode: BlockMode | null } | null;
	readyToRevisit: number;
	welcomeBack: { text: string; spec: SessionSpec; daysAway: number } | null;
	banner: Banner;
	activeSession: string | null;
	/** A session that was left, to pick up (R-5). */
	resume: { sessionId: string; module: string; title: string; answered: number; budget: number; text: string } | null;
	/** F-112: a phone is paired, so the phone gets the OS notifications and the laptop shows in-app cards only. */
	phonePaired: boolean;
	phoneAvailable: boolean;
}

/** One point on the learning-score chart: a day (week and month ranges) or a week (term range). */
export interface ProgressPoint {
	date: string;
	end: string;
	score: number;
	pace: number | null;
	gained: number;
	future: boolean;
	detail: { sessions: number; right: number; answered: number; secured: string[]; cameBack: string[]; blocks: number; modules: string[] };
	milestones: string[];
}
/** A "needs attention" line: the gap, and the one thing to do about it (a session to start, or a page to open). */
export interface ProgressAttention {
	kind: "module" | "fading" | "material";
	module: string | null;
	text: string;
	action: { label: string; session?: { kind: "post-lecture"; lectureId: string; nodes?: string[] }; href?: string };
}
/** Progress (v1.1, V-34 to V-36): the learning score, where it came from, what needs attention, and milestones. */
export interface ProgressData {
	score: { now: number; weekChange: number; series: Record<ScoreRange, ProgressPoint[]>; term: { start: string; end: string; target: number }; ideasSecured: number; ideasTotal: number; fading: number };
	ideas: Record<string, { title: string; unit: string; module: string }>;
	modules: { code: string; name: string; hasMaterial: boolean; lastActivity: string | null; shares: Record<ScoreRange, { points: number; minutes: number }> }[];
	attention: ProgressAttention[];
	milestones: { id: string; group: "learning" | "discipline" | "rounded"; title: string; how: string; earnedAt: string | null }[];
	week: { sessions: number; questionsAnswered: number; readyToRevisit: number };
	welcomeBack: TodayData["welcomeBack"];
}

export interface DemoState {
	now: string;
	clockOffsetMs: number;
	participant: string | null;
	engineOverride: "learnharness" | "scripted" | null;
	defaultEngine: "learnharness" | "scripted";
	onboarded: boolean;
	candidates: { type: string; key: string; text: string; lectureId: string | null; fireAt: string; fireBy: string; sessionId: string | null }[];
	banner: Banner;
	scenarios: string[];
}

export interface MissItem {
	id: string;
	lectureId: string;
	lectureTitle: string;
	module: string;
	questionText: string;
	correctLabels: string[];
	explanation: string | null;
	reason: "wrong" | "dont-know" | "low-confidence";
	createdAt: string;
	nextDue: string;
}

export interface SlideSection {
	number: number;
	title: string;
	body: string;
}

export interface ConceptMapData {
	lectureId: string;
	mermaid: string;
	source: "authored" | "headings";
	nodes: { id: string; title: string; slides: number[]; status: "solid" | "shaky" | "revisit" | "notyet"; answers: number }[];
	edges: { from: string; to: string }[];
}

export const lockedIn = {
	today: () => api<TodayData>("/today"),
	profile: () => api<{ profile: Profile | null }>("/profile").then((r) => r.profile),
	updateProfile: (patch: { prefs?: Partial<Profile["prefs"]>; appearance?: Partial<Profile["appearance"]> }) => api<Profile>("/profile", { method: "PUT", body: patch }),
	onboard: (body: { modules: string[]; timetableSource: "sample" | "ics"; nudgesPerDay: 1 | 2 }) => api<{ profile: Profile; tryNow: TodayData["tryNow"] }>("/onboarding", { body }),
	importIcs: (text: string) => api<{ added: number; unmapped: { summary: string }[] }>("/timetable/import", { raw: text, headers: { "content-type": "text/calendar" } }),
	subscribe: (url: string) => api<{ added: number; unmapped: { summary: string }[] }>("/timetable/subscribe", { body: { url } }),
	reads: () => api<{ source: string; label: string; events: number; lectures: number; modules: string[]; lastReadAt: string | null; location: string; link: string | null; refreshedAt: string | null; timeZone: string }>("/reads"),
	lectures: (q?: string) => api<{ lectures: LectureWithStatus[] }>(`/lectures${q ? `?q=${encodeURIComponent(q)}` : ""}`).then((r) => r.lectures),
	missed: (id: string, missed = true) => api<Lecture>(`/lectures/${encodeURIComponent(id)}/missed`, { body: { missed } }),
	roadmap: () => api<Record<string, LectureWithStatus[]>>("/roadmap"),
	/** The unit's slides as text, and whether it kept its PDF (then each page has a picture, V-21). */
	slides: (id: string) => api<{ slides: SlideSection[]; hasPdf: boolean }>(`/materials/${encodeURIComponent(id)}/slides`),
	map: (id: string) => api<ConceptMapData>(`/lectures/${encodeURIComponent(id)}/map`),
	progress: () => api<ProgressData>("/progress"),
	misses: (lectureId?: string) => api<{ misses: MissItem[] }>(`/misses${lectureId ? `?lectureId=${encodeURIComponent(lectureId)}` : ""}`).then((r) => r.misses),
	refreshCalendar: () => api<{ added: number }>("/timetable/refresh", { method: "POST" }),
	tick: () => api<{ nudge: Banner; prepared: string[] }>("/nudges/due"),
	nudge: (id: string, action: "open" | "snooze" | "dismiss" | "wasnt-there") => api<{ sessionId?: string; returnAt?: string; href?: string }>(`/nudges/${encodeURIComponent(id)}/${action}`, { method: "POST" }),
	/** Start a Practise round across a module (V-40): bank questions, no AI. */
	startPractise: (module: string, idea?: string) => api<{ sessionId: string; written: number }>("/practise", { body: { module, ...(idea ? { idea } : {}) } }),
	/** Gaps by idea (V-39): module, idea, the questions missed. */
	gaps: () => api<GapsData>("/gaps"),
	/** The module's Learn start sheet (step 5): one suggestion, this week, and the topics a typed goal is matched against. */
	learnSheet: (module: string) => api<LearnSheet>(`/learn?module=${encodeURIComponent(module)}`),
	/** Start Learn (V-47): a lecture, one part of it (`nodes`), or the module's lectures this week. */
	startLearn: (body: { lectureId: string; nodes?: string[]; goal?: string } | { module: string; week: true; goal?: string }) => api<{ sessionId: string }>("/learn", { body }),
	/** Say something to the tutor (V-54). With `questionId` it is answered beside the open question. */
	say: (id: string, body: { text: string; questionId?: string } | { say: "skipProbe" | "planOk" | "carryOn" }) => api<{ queued: boolean; answer: string | null }>(`/sessions/${encodeURIComponent(id)}/say`, { body }),
	finish: (id: string) => api(`/sessions/${encodeURIComponent(id)}/finish`, { method: "POST" }),
	steps: (id: string) => api<{ steps: LearnItem[][] }>(`/sessions/${encodeURIComponent(id)}/steps`).then((r) => r.steps),
	startSession: (spec: Partial<SessionSpec> & { kind: SessionSpec["kind"]; lectureId: string; questions?: number }) => api<{ sessionId: string }>("/sessions", { body: spec }),
	session: (id: string) => api<SessionView>(`/sessions/${encodeURIComponent(id)}`),
	answer: (id: string, body: { questionId: string; indices?: number[]; dontKnow?: boolean; confidence?: number; why?: string; text?: string }) => api<{ correct: boolean }>(`/sessions/${encodeURIComponent(id)}/answer`, { body }),
	hint: (id: string, questionId: string) => api<{ text: string }>(`/sessions/${encodeURIComponent(id)}/hint`, { body: { questionId } }),
	showMe: (id: string, questionId: string) => api(`/sessions/${encodeURIComponent(id)}/show-me`, { body: { questionId } }),
	more: (id: string) => api<{ budget: number }>(`/sessions/${encodeURIComponent(id)}/more`, { body: {} }),
	stop: (id: string) => api(`/sessions/${encodeURIComponent(id)}/stop`, { method: "POST" }),
	retry: (id: string) => api(`/sessions/${encodeURIComponent(id)}/retry`, { method: "POST" }),
	practiceInstead: (id: string) => api<{ sessionId: string }>(`/sessions/${encodeURIComponent(id)}/practice`, { method: "POST" }),
	blocks: () => api<{ blocks: StudyBlock[] }>("/blocks").then((r) => r.blocks),
	deleteAll: () => api("/data", { method: "DELETE" }),
	event: (type: string, data: Record<string, unknown> = {}) => api("/events", { body: { type, data } }).catch(() => undefined),
	// v0.1 the phone (F-112)
	phone: () => api<PhoneStatus>("/phone"),
	pairPhone: () => api<PhonePairing>("/phone/pair", { method: "POST" }),
	unpairPhone: () => api<{ paired: false }>("/phone/unpair", { method: "POST" }),
	syncPhone: () => api<{ uploaded: boolean; replayed: number }>("/phone/sync", { method: "POST" }),
	/** One question from the student's own study packs, on the phone within a minute (v1.0.4). */
	testPhone: () => api<{ nudgeId: string; title: string; body: string; arrivesWithinSeconds: number }>("/phone/test", { method: "POST" }),
	// v0.1 the week (F-109, F-110, F-111)
	plan: (week?: string) => api<PlanData>(`/plan${week ? `?week=${week}` : ""}`),
	proposePlan: (week?: string) => api<PlanData & { roomMinutes: number; fits: boolean; message: string | null }>("/plan", { body: week ? { week } : {} }),
	/** Start a study block (V-44): marks it started and opens its session, when there is material to open. */
	/** Start a block in the mode it suggests, or the one chosen (step 5). */
	startBlock: (id: string, study?: "learn" | "practise") => api<{ block: StudyBlock; sessionId: string | null }>(`/blocks/${encodeURIComponent(id)}/start`, { body: study ? { study } : {} }),
	updateBlock: (id: string, patch: { status?: StudyBlock["status"]; date?: string; start?: string; minutes?: number; module?: string | null }) => api<StudyBlock>(`/blocks/${encodeURIComponent(id)}`, { method: "PUT", body: patch }),
	acceptBlocks: (week: string) => api<PlanData>("/blocks/accept", { body: { week } }),
	planSettings: (patch: Partial<NonNullable<Profile["plan"]>>) => api<NonNullable<Profile["plan"]>>("/plan/settings", { method: "PUT", body: patch }),
	saveRoutine: (body: { routine: Partial<Routine>; source: "chat" | "form"; modules?: { code: string; week?: number; readingWeeks?: number[] }[] }) => api<{ routine: Routine; plan: PlanData & { message: string | null } }>("/routine", { body }),
	chatTurn: (messages: { role: "assistant" | "student"; text: string }[]) => api<ChatTurnData>("/setup-chat", { body: { messages } }),
	skipChat: () => api("/setup-chat", { body: { skip: true } }),
	checkin: () => api<CheckinData>("/checkin"),
	answerCheckin: (body: { feeling: string } | { target: number } | { keep: true }) => api<{ proposed?: number; current?: number; ask?: string | null; keepLabel?: string; target?: number; plan?: PlanData }>("/checkin", { body }),
	// v0.1 study packs (F-105)
	pack: (id: string) => api<PackData>(`/lectures/${encodeURIComponent(id)}/pack`),
	startPack: (id: string, fresh = false) => api<PackData>(`/lectures/${encodeURIComponent(id)}/pack`, { body: { fresh } }),
	cancelPack: (id: string) => api<PackData>(`/lectures/${encodeURIComponent(id)}/pack`, { method: "DELETE" }),
	// v0.1 course material and module weeks (F-104, V-18)
	course: () => api<CourseModule[]>("/course"),
	setUnitWeek: (lectureId: string, week: number) => api<Lecture>(`/lectures/${encodeURIComponent(lectureId)}/week`, { method: "PUT", body: { week } }),
	setModuleWeek: (code: string, body: { week: number | null; readingWeeks?: number[]; inReadingWeek?: boolean }) => api<CourseModule>(`/modules/${encodeURIComponent(code)}`, { method: "PUT", body }),
	proposeMaterials: (code: string, form: FormData) => api<MaterialProposal>(`/modules/${encodeURIComponent(code)}/materials`, { raw: form }),
	saveMaterials: (code: string, body: { uploadId: string; units: { file: number; title: string; week: number; pages: [number, number] }[] }) => api<{ units: Lecture[] }>(`/modules/${encodeURIComponent(code)}/materials`, { method: "PUT", body }),
	replaceMaterials: (lectureId: string, file: File) => { const f = new FormData(); f.append("file", file); return api<{ slideCount: number; needsCaption: number[] }>(`/materials/${encodeURIComponent(lectureId)}`, { raw: f }); },
	removeMaterials: (lectureId: string) => api(`/materials/${encodeURIComponent(lectureId)}`, { method: "DELETE" }),
	// v0.1 onboarding (J1′) and Connect your AI (F-101)
	calendarPreview: (body: { url: string } | { text: string }) => api<{ events: number; modules: DetectedModule[] }>("/onboarding/calendar", { body }),
	onboardV1: (body: { calendar: { kind: "sample" } | { kind: "none" } | { kind: "link"; url: string } | { kind: "file"; text: string }; modules?: { name: string; code?: string }[]; timeZone?: string }) =>
		api<{ profile: Profile; reads: Awaited<ReturnType<typeof lockedIn.reads>>; calendar: { added: number; unmapped: number } | null; firstTaste: FirstTaste | null }>("/onboarding", { body }),
	firstTaste: () => api<FirstTaste & { sessionId: string }>("/onboarding/first-taste", { method: "POST" }),
	ai: {
		status: () => api<AiFullStatus>("/ai"),
		chatgpt: (op: "login" | "cancel" | "logout" | "consent", enabled?: boolean) => api<{ browserAction?: string; error?: string; status: AiFullStatus }>("/ai/chatgpt", { body: { op, ...(enabled !== undefined ? { enabled } : {}) } }),
		key: (provider: KeyProvider, key: string) => api<AiFullStatus>("/ai/key", { body: { provider, key } }),
		setModels: (slots: SlotChoices) => api<AiFullStatus>("/ai/models", { method: "PUT", body: slots }),
		chooseForMe: (provider?: string) => api<AiFullStatus & { missing: string[]; saved: boolean }>("/ai/models/auto", { body: provider ? { provider } : {} }),
		voice: (key: string | null) => api<AiFullStatus>("/ai/voice", { body: { key } }),
		disconnect: (provider: string) => api<AiFullStatus>(`/ai?provider=${encodeURIComponent(provider)}`, { method: "DELETE" }),
	},
	demo: {
		state: () => api<DemoState>("/demo/state"),
		clock: (body: { set?: string; advanceMinutes?: number; jump?: string }) => api<DemoState>("/demo/clock", { body }),
		fire: (type: string, lectureId?: string) => api<NudgeRecord>("/demo/fire", { body: { type, lectureId } }),
		scenario: (name: string) => api<DemoState>("/demo/scenario", { body: { name } }),
		reset: () => api<DemoState>("/demo/reset", { method: "POST" }),
		participant: (participant: string | null) => api<DemoState>("/demo/participant", { body: { participant } }),
		engine: (engine: "learnharness" | "scripted" | null) => api<DemoState>("/demo/engine", { body: { engine } }),
	},
};

export type { CompanionSession, SessionView };
