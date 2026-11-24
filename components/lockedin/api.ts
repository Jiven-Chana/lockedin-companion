/**
 * The LockedIn app's client for /api/companion (docs/companion/API.md).
 * Types come from the core barrel, the only src module components may import.
 */

import type { AiStatus, CatalogModel, Explainer, PackMeta, CompanionSession, DetectedModule, KeyProvider, Lecture, NudgeRecord, Profile, Routine, SessionSpec, SessionView, SlotChoices, StudyBlock } from "@/src/core";

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

export interface PhoneStatus { paired: boolean; relay: string; phoneSeenAt?: string | null; pushReady?: boolean; uploadedAt?: string | null; holds: string; reachable?: boolean }
export interface PlanData {
	week: string;
	target: number | null;
	blockMinutes: number;
	committedMinutes: number;
	proposedMinutes: number;
	blocks: (StudyBlock & { focus: { title: string; module: string } | null })[];
	lectures: Lecture[];
	commitments: Routine["commitments"];
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

export type Banner = (NudgeRecord & { ready: boolean }) | null;
export type LectureWithStatus = Lecture & { status: "answered" | "revisit" | "not-started"; revisit: number };

export interface TodayData {
	now: string;
	onboarded: boolean;
	tryNow: { lectureId: string; title: string; module: string; spec: SessionSpec } | null;
	lectures: LectureWithStatus[];
	nextBlock: { blockId: string; start: string; end: string } | null;
	readyToRevisit: number;
	welcomeBack: { text: string; spec: SessionSpec; daysAway: number } | null;
	banner: Banner;
	activeSession: string | null;
	/** F-112: a phone is paired, so the phone gets the OS notifications and the laptop shows in-app cards only. */
	phonePaired: boolean;
	phoneAvailable: boolean;
}

export interface ProgressData {
	week: { sessions: number; questionsAnswered: number; readyToRevisit: number };
	welcomeBack: TodayData["welcomeBack"];
	roadmap: Record<string, LectureWithStatus[]>;
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
	startSession: (spec: Partial<SessionSpec> & { kind: SessionSpec["kind"]; lectureId: string; questions?: number }) => api<{ sessionId: string }>("/sessions", { body: spec }),
	session: (id: string) => api<SessionView>(`/sessions/${encodeURIComponent(id)}`),
	answer: (id: string, body: { questionId: string; indices?: number[]; dontKnow?: boolean; confidence?: number; why?: string }) => api<{ correct: boolean }>(`/sessions/${encodeURIComponent(id)}/answer`, { body }),
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
	pairPhone: () => api<PhoneStatus & { url: string; qrSvg: string }>("/phone/pair", { method: "POST" }),
	unpairPhone: () => api<{ paired: false }>("/phone/unpair", { method: "POST" }),
	syncPhone: () => api<{ uploaded: boolean; replayed: number }>("/phone/sync", { method: "POST" }),
	// v0.1 the week (F-109, F-110, F-111)
	plan: (week?: string) => api<PlanData>(`/plan${week ? `?week=${week}` : ""}`),
	proposePlan: (week?: string) => api<PlanData & { roomMinutes: number; fits: boolean; message: string | null }>("/plan", { body: week ? { week } : {} }),
	updateBlock: (id: string, patch: { status?: StudyBlock["status"]; date?: string; start?: string; minutes?: number }) => api<StudyBlock>(`/blocks/${encodeURIComponent(id)}`, { method: "PUT", body: patch }),
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
