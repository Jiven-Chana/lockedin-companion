/**
 * The companion service: every start-layer operation behind
 * app/api/companion/*. Routes stay thin wrappers (plan §9); this class owns
 * the orchestration and the event log (§12.3), and delegates the rules to
 * the pure core (src/core/companion) and sessions to a SessionEngine.
 *
 * Dependencies are injected (store, clock, engines, PDF converter), so the
 * whole start layer runs in tests with a manual clock and fake engines.
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { activeBlock, lockDecision, validateBlocks } from "../../core/companion/blocks.ts";
import { eventsToCsv } from "../../core/companion/csv.ts";
import { applyRetestAnswer, mergeMisses, missFromAnswer } from "../../core/companion/misses.ts";
import {
	commitmentsOn,
	dueMissesForRetest,
	dueNudges,
	forcedCandidate,
	goalFor,
	isSessionReady,
	nudgeCandidates,
	prewarmCandidates,
	snoozeReturnTime,
	specFor,
} from "../../core/companion/nudges.ts";
import { buildOpeningMessage } from "../../core/companion/opening-message.ts";
import { BLOCK_RULES, CALENDAR_RULES, DEFAULT_APPEARANCE, DEFAULT_PLAN, HANDOFF_COPY, NUDGE_TEXT, PLAN_COPY, DEFAULT_PREFS, FIRST_TASTE_LECTURE, KEEP_GOING_QUESTIONS, NUDGE_RULES, PREPARE_RULES } from "../../core/companion/policy.ts";
import { codeFromName, detectModules, MODULE_CODE_RE } from "../../core/companion/module-detect.ts";
import { CompanionAi, type AiPort, type KeyVerifier } from "./ai.ts";
import { CourseMaterials, type UploadedFile } from "./materials.ts";
import { StudyPacks } from "./study-pack.ts";
import { SetupChat } from "./setup-chat.ts";
import { PhoneLink, RelayClient } from "./phone.ts";
import { clampBlockMinutes, pacedUnits, proposeWeek } from "../../core/companion/plan-week.ts";
import { scheduleWeek, type NudgeQuestion } from "../../core/companion/nudges.ts";
import { FEELINGS, lastWeekSummary, proposeTarget, type Feeling } from "../../core/companion/checkin.ts";
import { validateRoutine } from "../../core/companion/routine.ts";
import type { Generate } from "./generate.ts";
import { checkProposal, currentWeek, weekOneStartFor, type ProposedUnit } from "../../core/companion/units.ts";
import { lecturesWithStatus, roadmap, searchLectures, tryNowLecture, weekSummary, welcomeBack } from "../../core/companion/progress.ts";
import { assembleSlidesMarkdown, parseSlideRefs, parseSlides, slideTitles, type SlidePage } from "../../core/companion/slides.ts";
import { nodeStatuses, splitNodeLabel, starterMap, type MapEvidence, type MapNode } from "../../core/companion/concept-map.ts";
import { parseMermaidPlan } from "../../agent/tools/mermaid-plan.ts";
import { addDays, addMinutes, atTime, dateKey, isoWeekday, isValidHM, sameDay } from "../../core/companion/time.ts";
import { icsToLectures, isTimed, materializeSampleTimetable, mergeTimetable, parseIcs, readsSummary, scenarioClock, type TimedLecture } from "../../core/companion/timetable.ts";
import {
	CLIENT_EVENT_TYPES,
	COMPANION_EVENT_TYPES,
	ENGINE_NAMES,
	NUDGE_ACTIONS,
	SESSION_KINDS,
	type AnswerInput,
	type CompanionEventType,
	type CompanionSession,
	type EngineName,
	type AnswerRecord,
	type Lecture,
	type NudgeAction,
	type NudgeCandidate,
	type NudgeRecord,
	type NudgeType,
	type Profile,
	type SessionSpec,
	type SessionView,
	type StudyBlock,
} from "../../core/companion/types.ts";
import { CONFIDENCE_STOPS } from "../../core/question-core.ts";
import type { Clock } from "./clock.ts";
import type { CompanionContent } from "./content.ts";
import type { SessionEngine } from "./engines/types.ts";
import { badRequest, CompanionError, conflict, notFound } from "./errors.ts";
import { assertSafeId, type CompanionStore } from "./store.ts";

export type PdfConverter = (data: Uint8Array) => Promise<SlidePage[] | "too-long" | "unreadable">;

export interface CompanionServiceDeps {
	store: CompanionStore;
	content: CompanionContent;
	clock: Clock;
	/** Moves the demo clock (facilitator). */
	clockControl: { set(target: Date): void; reset(): void };
	engines: Record<EngineName, SessionEngine>;
	defaultEngine: EngineName;
	/** On a LearnHarness prepare failure, retry the session on the scripted engine. */
	autoFallback?: boolean;
	readyTimeoutMs?: number;
	convertPdf?: PdfConverter;
	/** Fetches a calendar link (network guards live in the default implementation). */
	fetchCalendar?: (url: string) => Promise<string>;
	/**
	 * v0.1 F-102: when set, sessions default to this engine whenever the
	 * student's AI is ready (connected, three slots set, background use on).
	 * Unset: `defaultEngine` always (an explicit COMPANION_ENGINE, tests).
	 */
	engineWhenAiReady?: EngineName;
	/** Connect your AI (F-101): engine access and the key check. */
	ai?: { port: AiPort; verifyKey: KeyVerifier };
	/** One-shot structured generation (spec §5.4): the course split, packs, the setup chat. */
	generate?: Generate;
	/** LockedIn's own generation prompts (companion/prompts). */
	promptsDir?: string;
	/** The phone relay (F-112): COMPANION_RELAY_URL. No relay, no phone; the laptop works on its own. */
	relay?: { url: string; fetch?: typeof fetch };
	/** Is the LearnHarness engine usable (models + key)? For /health. */
	engineStatus?: () => Record<string, unknown>;
	newId?: (prefix: string) => string;
}

export interface OnboardingInput {
	modules?: string[];
	timetableSource?: "sample" | "ics";
	nudgesPerDay?: 0 | 1 | 2;
}

const MODULE_CODE = /^[A-Za-z0-9 _-]{1,32}$/;

export class CompanionService {
	private readonly preparing = new Map<string, Promise<void>>();
	private aiReady = false;
	/** Connect your AI (F-101). Null when the engine isn't wired (tests). */
	readonly ai: CompanionAi | null;

	/** Course material in any shape (F-104, V-18). */
	readonly courseMaterials: CourseMaterials;
	/** Study packs per unit (F-105). Null without generate() (tests that don't need it). */
	readonly packs: StudyPacks | null;
	/** The phone link (F-112). Null without a relay URL. */
	readonly phone: PhoneLink | null;

	constructor(private readonly deps: CompanionServiceDeps) {
		this.courseMaterials = new CourseMaterials({
			dataDir: deps.store.dir,
			promptsDir: deps.promptsDir ?? "companion/prompts",
			...(deps.convertPdf ? { pdfToPages: deps.convertPdf } : {}),
			...(deps.generate ? { generate: deps.generate } : {}),
			aiReady: async () => (this.ai ? this.ai.ready() : false),
			...(deps.newId ? { newId: () => deps.newId!("up") } : {}),
		});
		this.packs = deps.generate
			? new StudyPacks({
					dir: (id) => deps.store.materialsDir(id),
					slidesMarkdown: (id) => deps.content.slidesMarkdown(id),
					mapSource: (id) => deps.content.conceptMapSource(id),
					generate: deps.generate,
					promptsDir: deps.promptsDir ?? "companion/prompts",
					log: (type, data) => this.log(type, data),
					now: () => this.now(),
				})
			: null;
		this.phone = deps.relay ? new PhoneLink(this, deps.store, new RelayClient(deps.relay.url, deps.relay.fetch)) : null;
		this.ai = deps.ai
			? new CompanionAi(deps.ai.port, deps.ai.verifyKey, (type, data) => this.log(type, data), (ready) => this.noteAiReady(ready))
			: null;
	}

	private noteAiReady(ready: boolean) {
		if (ready && !this.aiReady && this.deps.engineWhenAiReady) this.log("engine_ready", { engine: this.deps.engineWhenAiReady });
		this.aiReady = ready;
	}

	/** The engine new sessions use (F-102): the student's AI when it's ready, otherwise the declared fallback. */
	defaultEngine(): EngineName {
		return this.deps.engineWhenAiReady && this.aiReady ? this.deps.engineWhenAiReady : this.deps.defaultEngine;
	}

	requireAi(): CompanionAi {
		if (!this.ai) throw new CompanionError("ai_unavailable", 501, "AI connection is not available here");
		return this.ai;
	}

	/** A lecture by id: the timetable's, or the bundled first-taste lecture (O-3) for students who don't take it. */
	private lectureById(id: string): Lecture | undefined {
		const own = this.store.allLectures().find((l) => l.id === id);
		if (own || id !== FIRST_TASTE_LECTURE) return own;
		const sample = this.content.sampleTimetable();
		return materializeSampleTimetable(sample, this.now(), { hasMaterials: (lid) => this.content.hasMaterials(lid) }).find((l) => l.id === id);
	}

	private get store() {
		return this.deps.store;
	}
	private get content() {
		return this.deps.content;
	}
	now(): Date {
		return this.deps.clock.now();
	}
	private id(prefix: string): string {
		return this.deps.newId ? this.deps.newId(prefix) : `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
	}

	// ─── event log (§12.3) ──────────────────────────────────────────────────

	log(type: CompanionEventType, data: Record<string, unknown> = {}): void {
		const participant = this.store.demo().participant;
		this.store.appendEvent({ t: this.now().toISOString(), wall: new Date().toISOString(), ...(participant ? { participant } : {}), type, data });
	}

	logClientEvents(raw: unknown): { logged: number } {
		const list = Array.isArray(raw) ? raw : [raw];
		if (list.length > 50) throw badRequest("at most 50 events per request");
		let logged = 0;
		for (const e of list) {
			const ev = e as { type?: unknown; data?: unknown };
			if (typeof ev?.type !== "string" || !(CLIENT_EVENT_TYPES as readonly string[]).includes(ev.type))
				throw badRequest(`event type must be one of: ${CLIENT_EVENT_TYPES.join(", ")}`);
			const data = ev.data && typeof ev.data === "object" && !Array.isArray(ev.data) ? (ev.data as Record<string, unknown>) : {};
			if (JSON.stringify(data).length > 4_000) throw badRequest("event data too large");
			this.log(ev.type as CompanionEventType, { ...data, source: "client" });
			logged++;
		}
		return { logged };
	}

	eventsCsv(): string {
		return eventsToCsv(this.store.events());
	}

	async health() {
		const demo = this.store.demo();
		const ai = this.ai ? await this.ai.status().catch(() => null) : null;
		return {
			ok: true,
			ai: ai ? { connected: ai.provider !== null, provider: ai.provider, modelsReady: ai.modelsReady, ready: ai.ready, blocker: ai.blocker } : null,
			defaultEngine: this.defaultEngine(),
			engineOverride: demo.engineOverride ?? null,
			autoFallback: !!this.deps.autoFallback,
			onboarded: this.store.profile() !== null,
			lectures: this.store.lectures().length,
			now: this.now().toISOString(),
			engines: this.deps.engineStatus?.() ?? {},
			eventTypes: COMPANION_EVENT_TYPES.length,
		};
	}

	// ─── profile and onboarding ─────────────────────────────────────────────

	profile(): Profile | null {
		return this.store.profile();
	}

	private requireProfile(): Profile {
		const p = this.store.profile();
		if (!p) throw new CompanionError("not_onboarded", 409, "finish onboarding first");
		return p;
	}

	updateProfile(raw: unknown): Profile {
		const current = this.requireProfile();
		const patch = (raw ?? {}) as { prefs?: Partial<Profile["prefs"]>; appearance?: Partial<Profile["appearance"]> };
		const prefs = { ...current.prefs };
		const p = patch.prefs ?? {};
		if (p.nudgesPerDay !== undefined) {
			if (p.nudgesPerDay !== 0 && p.nudgesPerDay !== 1 && p.nudgesPerDay !== 2) throw badRequest("nudgesPerDay must be 0, 1 or 2");
			prefs.nudgesPerDay = p.nudgesPerDay;
		}
		if (p.quietHours !== undefined) {
			if (!isValidHM(p.quietHours?.from) || !isValidHM(p.quietHours?.to)) throw badRequest("quietHours must be {from: HH:MM, to: HH:MM}");
			prefs.quietHours = { from: p.quietHours.from, to: p.quietHours.to };
		}
		if (p.lock !== undefined) {
			if (!["off", "gentle", "firm"].includes(p.lock)) throw badRequest("lock must be off, gentle or firm");
			prefs.lock = p.lock;
		}
		if (p.defaultMode !== undefined) {
			if (!["question-first", "show-first"].includes(p.defaultMode)) throw badRequest("defaultMode must be question-first or show-first");
			prefs.defaultMode = p.defaultMode;
		}
		if (p.eveningTime !== undefined) {
			if (!isValidHM(p.eveningTime)) throw badRequest("eveningTime must be HH:MM");
			prefs.eveningTime = p.eveningTime;
		}
		const appearance = { ...current.appearance };
		for (const [k, v] of Object.entries(patch.appearance ?? {})) {
			if (!(k in DEFAULT_APPEARANCE)) throw badRequest(`unknown appearance setting ${k}`);
			const expected = typeof DEFAULT_APPEARANCE[k as keyof Profile["appearance"]];
			if (typeof v !== expected || (typeof v === "string" && v.length > 40)) throw badRequest(`appearance.${k} must be a ${expected}`);
			(appearance as Record<string, unknown>)[k] = v;
		}
		const next = { ...current, prefs, appearance };
		this.store.saveProfile(next);
		const changed = [
			...Object.keys(p).map((k) => `prefs.${k}`),
			...Object.keys(patch.appearance ?? {}).map((k) => `appearance.${k}`),
		];
		if (changed.length > 0) this.log("settings_changed", { changed, prefs: next.prefs });
		return next;
	}

	onboard(input: OnboardingInput) {
		const now = this.now();
		const sample = this.content.sampleTimetable();
		const source = input.timetableSource ?? "sample";
		if (source !== "sample" && source !== "ics") throw badRequest("timetableSource must be sample or ics");
		const nudgesPerDay = input.nudgesPerDay ?? DEFAULT_PREFS.nudgesPerDay;
		if (nudgesPerDay !== 0 && nudgesPerDay !== 1 && nudgesPerDay !== 2) throw badRequest("nudgesPerDay must be 0, 1 or 2");
		const codes = input.modules && input.modules.length > 0 ? input.modules : sample.modules.map((m) => m.code);
		if (!codes.every((c) => typeof c === "string" && MODULE_CODE.test(c))) throw badRequest("invalid module code");
		const modules = codes.map((code) => sample.modules.find((m) => m.code === code) ?? { code, name: code });
		const lectures =
			source === "sample"
				? materializeSampleTimetable(sample, now, { modules: codes, hasMaterials: (id) => this.content.hasMaterials(id) })
				: [];
		const profile: Profile = {
			createdAt: now.toISOString(),
			modules,
			timetableSource: source,
			...(source === "sample" ? { timetableRead: { at: now.toISOString(), events: lectures.length, modules: codes } } : {}),
			prefs: { ...DEFAULT_PREFS, nudgesPerDay },
			appearance: { ...DEFAULT_APPEARANCE },
		};
		this.store.saveProfile(profile);
		this.store.saveLectures(lectures);
		this.log("onboarding_done", { modules: codes, source, nudgesPerDay, lectures: lectures.length });
		const tryNow = tryNowLecture({ lectures }, now);
		return {
			profile,
			reads: this.reads(),
			tryNow: tryNow ? { lectureId: tryNow.id, title: tryNow.title, module: tryNow.module, spec: specFor("try-now", tryNow.id, profile.prefs) } : null,
		};
	}

	// ─── onboarding v0.1: calendar first, then modules (J1′, V-17) ──────────

	/** POST /onboarding: the v0.1 body has `calendar`; the v0.0 body (scenarios, tests) doesn't. */
	async onboarding(body: unknown) {
		if (body && typeof body === "object" && "calendar" in body) return this.onboardFlow(body);
		return this.onboard(body as OnboardingInput);
	}

	private calendarEvents(text: string) {
		if (!text.includes("BEGIN:VCALENDAR")) throw badRequest("not an iCalendar file");
		const now = this.now();
		return parseIcs(text, { from: addDays(now, -CALENDAR_RULES.lookbackDays), to: addDays(now, CALENDAR_RULES.lookaheadDays) }, 500, { timeZone: this.timeZone() });
	}

	/** Read a calendar (link or file text) without saving anything, and propose its modules. */
	async calendarPreview(body: unknown) {
		const b = (body ?? {}) as { url?: unknown; text?: unknown };
		const text = b.url !== undefined ? (await this.fetchCalendarLink(b.url)).text : typeof b.text === "string" ? b.text : null;
		if (text === null) throw badRequest("send { url } or { text }");
		const events = this.calendarEvents(text);
		return { events: events.length, modules: detectModules(events) };
	}

	/**
	 * Onboarding v0.1 (J1′): the confirmed modules plus how the timetable
	 * arrives. `calendar`: { kind: "sample" } (labelled demo week),
	 * { kind: "link", url }, { kind: "file", text } or { kind: "none" }.
	 * Modules are { name, code? }; a missing code is made from the name.
	 */
	async onboardFlow(body: unknown) {
		const b = (body ?? {}) as { modules?: unknown; calendar?: { kind?: unknown; url?: unknown; text?: unknown }; nudgesPerDay?: unknown; timeZone?: unknown };
		const timeZone = validTimeZone(b.timeZone);
		const kind = b.calendar?.kind;
		if (kind !== "sample" && kind !== "link" && kind !== "file" && kind !== "none") throw badRequest("calendar.kind must be sample, link, file or none");
		const nudgesPerDay = b.nudgesPerDay === undefined ? DEFAULT_PREFS.nudgesPerDay : b.nudgesPerDay;
		if (nudgesPerDay !== 1 && nudgesPerDay !== 2) throw badRequest("nudgesPerDay must be 1 or 2");

		let modules: { code: string; name: string }[] | undefined;
		if (kind !== "sample") {
			if (!Array.isArray(b.modules) || b.modules.length === 0) throw badRequest("add at least one module");
			if (b.modules.length > 20) throw badRequest("at most 20 modules");
			const taken = new Set<string>();
			modules = b.modules.map((raw) => {
				const m = (raw ?? {}) as { code?: unknown; name?: unknown };
				const name = typeof m.name === "string" ? m.name.trim() : "";
				if (!name || name.length > 80) throw badRequest("each module needs a name (up to 80 characters)");
				const code = typeof m.code === "string" && m.code.trim() ? m.code.trim().toUpperCase() : codeFromName(name, taken);
				if (!MODULE_CODE_RE.test(code)) throw badRequest(`invalid module code ${code}`);
				if (taken.has(code)) throw badRequest(`two modules share the code ${code}`);
				taken.add(code);
				return { code, name };
			});
		}
		// Fetch before saving anything, so a bad link leaves no half-made profile.
		const link = kind === "link" ? await this.fetchCalendarLink(b.calendar?.url) : null;
		const fileText = kind === "file" ? (typeof b.calendar?.text === "string" ? b.calendar.text : null) : null;
		if (kind === "file" && fileText === null) throw badRequest("calendar.text is required for a file");

		const base = this.onboard({ ...(kind === "sample" ? {} : { modules: modules!.map((m) => m.code) }), timetableSource: kind === "sample" ? "sample" : "ics", nudgesPerDay });
		const profile = this.requireProfile();
		const ai = this.ai ? await this.ai.status().catch(() => null) : null;
		this.store.saveProfile({
			...profile,
			...(modules ? { modules } : {}),
			...(kind === "none" ? { timetableSource: "none" as const } : {}),
			...(timeZone ? { timeZone } : {}),
			ai: { provider: ai?.provider ?? null, ...(ai?.provider ? { connectedAt: this.now().toISOString() } : {}) },
		});
		let calendar: { added: number; unmapped: number } | null = null;
		if (link) {
			const r = this.importIcs(link.text);
			this.store.saveRuntime({ calendarUrl: link.url });
			calendar = { added: r.added, unmapped: r.unmapped.length };
		} else if (fileText !== null) {
			const r = this.importIcs(fileText);
			calendar = { added: r.added, unmapped: r.unmapped.length };
		}
		this.log("onboarding_done", { flow: "v0.1", calendar: kind, modules: (modules ?? base.profile.modules).map((m) => m.code), events: calendar?.added ?? null, ai: ai?.provider ?? null });
		return { profile: this.requireProfile(), reads: this.reads(), calendar, firstTaste: this.firstTasteCard() };
	}

	/** The first-taste card: the bundled sample lecture (O-3). */
	private firstTasteCard() {
		const lecture = this.lectureById(FIRST_TASTE_LECTURE);
		if (!lecture || !this.content.hasMaterials(lecture.id)) return null;
		return { lectureId: lecture.id, title: lecture.title, module: lecture.module, sample: true, spec: specFor("try-now", lecture.id, this.store.profile()?.prefs) };
	}

	/** Start preparing the first taste while the student is still on the modules screen (J1′ step 2). */
	firstTaste() {
		const card = this.firstTasteCard();
		if (!card) throw new CompanionError("first_taste_unavailable", 404, "the sample lecture isn't installed");
		return { ...card, ...this.createSession(card.spec) };
	}

	// ─── course material and the module calendar (F-104, V-18) ─────────────

	private requireModule(code: string) {
		const mod = this.requireProfile().modules.find((m) => m.code === code);
		if (!mod) throw notFound("module");
		return mod;
	}

	/** Each module with its current teaching week and its course units. */
	course() {
		const profile = this.requireProfile();
		const now = this.now();
		const all = lecturesWithStatus(this.store.state());
		return profile.modules.map((m) => ({
			...m,
			...currentWeek(m, now),
			units: all.filter((l) => l.module === m.code && (l.hasMaterials || !isTimed(l))).sort((a, b) => (a.week || 99) - (b.week || 99) || a.order - b.order),
		}));
	}

	/** Upload: convert the files and propose course units. Nothing is saved as material until saveMaterials. */
	async proposeMaterials(code: string, files: UploadedFile[]) {
		const mod = this.requireModule(code);
		const r = await this.courseMaterials.propose(mod, files);
		this.log("materials_uploaded", { module: code, files: r.files.map((f) => ({ pages: f.pageCount, units: f.units.length, via: f.via, noText: f.noText.length })) });
		return r;
	}

	/** Save the confirmed units: each becomes a course unit with only its pages as slides. */
	saveMaterials(code: string, body: unknown) {
		this.requireModule(code);
		const b = (body ?? {}) as { uploadId?: unknown; units?: unknown };
		if (typeof b.uploadId !== "string") throw badRequest("uploadId is required");
		if (!Array.isArray(b.units) || b.units.length === 0) throw badRequest("keep at least one unit");
		const pending = this.courseMaterials.pending(b.uploadId, code);
		const chosen = b.units.map((raw) => {
			const u = (raw ?? {}) as { file?: unknown; title?: unknown; week?: unknown; pages?: unknown };
			const file = typeof u.file === "number" ? pending.files[u.file] : undefined;
			if (!file) throw badRequest("each unit needs the file it came from");
			const unit: ProposedUnit = { title: typeof u.title === "string" ? u.title.trim() : "", week: typeof u.week === "number" ? u.week : 0, pages: Array.isArray(u.pages) ? [Number(u.pages[0]), Number(u.pages[1])] : [1, file.pages.length] };
			return { fileIndex: u.file as number, file, unit };
		});
		for (const [i, f] of pending.files.entries()) {
			const units = chosen.filter((c) => c.fileIndex === i).map((c) => c.unit);
			const problem = units.length ? checkProposal(units, f.pages.length) : null;
			if (problem) throw badRequest(`${f.name}: ${problem}`);
		}
		const all = this.store.allLectures();
		let order = Math.max(0, ...all.filter((l) => l.module === code).map((l) => l.order));
		const created: Lecture[] = [];
		const firstPdfDir = new Map<number, string>();
		for (const c of chosen) {
			const id = this.unitId(code, c.unit.title, all.concat(created));
			const md = CourseMaterials.unitMarkdown(c.file.pages, c.unit.pages, c.unit.title);
			const pdf = c.file.kind === "pdf" ? pending.pdf(c.fileIndex) : null;
			const dir = this.content.writeMaterials(id, { slidesMd: md.markdown, ...(pdf && !firstPdfDir.has(c.fileIndex) ? { pdf } : {}) });
			// One copy of each PDF on disk: later units of the same file link to it.
			if (pdf) {
				const first = firstPdfDir.get(c.fileIndex);
				if (first) linkOrCopy(path.join(first, "slides.pdf"), path.join(dir, "slides.pdf"));
				else firstPdfDir.set(c.fileIndex, dir);
			}
			created.push({ id, module: code, title: c.unit.title, week: c.unit.week, order: ++order, kind: "lecture", hasMaterials: true, source: { file: c.file.name, pages: c.unit.pages } });
		}
		this.store.saveLectures([...all, ...created]);
		this.courseMaterials.discard(b.uploadId);
		// Write each unit's study pack in the background when the student's AI is ready (F-105).
		if (this.packs && this.aiReady) for (const u of created) this.packs.start(u.id);
		this.log("materials_saved", { module: code, units: created.length, weeks: created.map((u) => u.week) });
		return { units: created };
	}

	private unitId(code: string, title: string, taken: readonly Lecture[]): string {
		const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "unit";
		const base = `${code.toLowerCase().replace(/[^a-z0-9]/g, "")}-${slug}`.slice(0, 80);
		const ids = new Set(taken.map((l) => l.id));
		let id = base;
		for (let n = 2; ids.has(id) || this.content.hasMaterials(id); n++) id = `${base}-${n}`;
		return id;
	}

	// ─── study packs (F-105) ────────────────────────────────────────────────

	private requirePacks(): StudyPacks {
		if (!this.packs) throw new CompanionError("packs_unavailable", 501, "study packs are not available here");
		return this.packs;
	}

	/** Progress, explainers and bank size for one unit. */
	pack(lectureId: string) {
		assertSafeId(lectureId, "lecture id");
		if (!this.lectureById(lectureId)) throw notFound("lecture");
		const packs = this.requirePacks();
		const explainers = packs.explainers(lectureId) ?? [];
		return { meta: packs.status(lectureId), explainers, questions: packs.bank(lectureId)?.length ?? 0, running: packs.isRunning(lectureId) };
	}

	/** Start or resume a unit's pack; `fresh` regenerates every stage. */
	regeneratePack(lectureId: string, body: unknown) {
		assertSafeId(lectureId, "lecture id");
		const l = this.lectureById(lectureId);
		if (!l) throw notFound("lecture");
		if (!l.hasMaterials) throw badRequest("add material to this unit first");
		if (!this.aiReady) throw new CompanionError("not_connected", 409, "Connect your AI to write study packs.");
		const fresh = !!(body && typeof body === "object" && (body as { fresh?: unknown }).fresh === true);
		this.requirePacks().start(lectureId, { fresh });
		return this.pack(lectureId);
	}

	cancelPack(lectureId: string) {
		assertSafeId(lectureId, "lecture id");
		this.requirePacks().cancel(lectureId);
		return this.pack(lectureId);
	}

	/** Remove a unit (hidden, history kept) or a timetable lecture's material. */
	removeMaterials(lectureId: string) {
		assertSafeId(lectureId, "lecture id");
		const l = this.store.lectures().find((x) => x.id === lectureId);
		if (!l) throw notFound("lecture");
		this.content.removeMaterials(lectureId);
		const updated = this.store.updateLecture(lectureId, (x) => (isTimed(x) ? { ...x, hasMaterials: this.content.hasMaterials(x.id) } : { ...x, hasMaterials: false, archived: true }));
		this.log("materials_removed", { lectureId, unit: !isTimed(l) });
		return updated;
	}

	/** "This is week N" and reading weeks for one module (spec §5.5). */
	setModuleWeek(code: string, body: unknown) {
		const profile = this.requireProfile();
		this.requireModule(code);
		const b = (body ?? {}) as { week?: unknown; readingWeeks?: unknown; inReadingWeek?: unknown };
		const week = b.week;
		if (week !== null && (typeof week !== "number" || !Number.isInteger(week) || week < 1 || week > 52)) throw badRequest("week must be 1 to 52, or null to clear it");
		const readingWeeks = b.readingWeeks === undefined ? undefined : Array.isArray(b.readingWeeks) && b.readingWeeks.every((w) => Number.isInteger(w) && w >= 1 && w <= 52) ? [...new Set(b.readingWeeks as number[])].sort((x, y) => x - y) : null;
		if (readingWeeks === null) throw badRequest("readingWeeks must be teaching-week numbers");
		const modules = profile.modules.map((m) => {
			if (m.code !== code) return m;
			const rw = readingWeeks ?? m.readingWeeks ?? [];
			const { weekOneStart: _drop, ...rest } = m;
			return {
				...rest,
				...(rw.length ? { readingWeeks: rw } : {}),
				...(week === null ? {} : { weekOneStart: weekOneStartFor(this.now(), week as number, rw, b.inReadingWeek === true) }),
			};
		});
		this.store.saveProfile({ ...profile, modules });
		const mod = modules.find((m) => m.code === code)!;
		this.log("module_week_set", { module: code, week, readingWeeks: mod.readingWeeks ?? [] });
		return { ...mod, ...currentWeek(mod, this.now()) };
	}

	// ─── timetable ──────────────────────────────────────────────────────────

	importIcs(text: string) {
		const profile = this.requireProfile();
		if (!text.includes("BEGIN:VCALENDAR")) throw badRequest("not an iCalendar file");
		const now = this.now();
		const events = parseIcs(text, { from: addDays(now, -CALENDAR_RULES.lookbackDays), to: addDays(now, CALENDAR_RULES.lookaheadDays) }, 500, { timeZone: this.timeZone() });
		const { lectures: incoming, unmapped } = icsToLectures(events, profile.modules, (id) => this.content.hasMaterials(id));
		// Merge, never replace: uploads, units and "I wasn't there" survive a refresh (F-104).
		const merged = mergeTimetable(this.store.allLectures(), incoming);
		this.store.saveLectures(merged.lectures);
		const lectures = merged.lectures.filter((l) => !l.archived && isTimed(l));
		this.store.saveProfile({ ...profile, timetableSource: "ics", timetableRead: { at: now.toISOString(), events: lectures.length, modules: profile.modules.map((m) => m.code) } });
		return { added: lectures.length, unmapped: unmapped.map((e) => ({ summary: e.summary, start: e.start.toISOString(), end: e.end.toISOString() })) };
	}

	reads() {
		const profile = this.store.profile();
		const runtime = this.store.runtime();
		return {
			...readsSummary(this.store.lectures(), profile?.timetableSource ?? "sample", profile?.timetableRead?.at, runtime.calendarUrl ? "link" : "file"),
			link: runtime.calendarUrl ? maskLink(runtime.calendarUrl) : null,
			refreshedAt: runtime.calendarRefreshedAt ?? null,
			timeZone: this.timeZone(),
		};
	}

	/** The student's zone: from the profile, else this machine's. */
	timeZone(): string {
		return this.store.profile()?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
	}

	private calendarRefreshing: Promise<unknown> | null = null;
	private calendarCheckedThisRun = false;

	/** Re-read a subscribed link when the app opens and every CALENDAR_RULES.refreshHours (F-108). Never throws. */
	refreshCalendarIfDue(): Promise<unknown> | null {
		const runtime = this.store.runtime();
		if (!runtime.calendarUrl || !this.store.profile() || this.calendarRefreshing) return this.calendarRefreshing;
		const last = runtime.calendarRefreshedAt ? new Date(runtime.calendarRefreshedAt).getTime() : 0;
		const due = !this.calendarCheckedThisRun || Date.now() - last >= CALENDAR_RULES.refreshHours * 3_600_000;
		if (!due) return null;
		this.calendarCheckedThisRun = true;
		this.calendarRefreshing = this.refreshCalendar()
			.catch((err) => this.log("calendar_error", { where: "auto-refresh", message: err instanceof Error ? err.message : String(err) }))
			.finally(() => { this.calendarRefreshing = null; });
		return this.calendarRefreshing;
	}

	lectures(query: { module?: string | null; q?: string | null } = {}) {
		const state = this.store.state();
		let list = lecturesWithStatus(state);
		if (query.module) list = list.filter((l) => l.module === query.module);
		if (query.q) {
			const ids = new Set(searchLectures(list, query.q, (id) => this.content.slideTitles(id)).map((l) => l.id));
			list = list.filter((l) => ids.has(l.id));
		}
		// Timetabled first by time, then course units in course order (V-18).
		return list.sort((a, b) => (a.start ?? "~").localeCompare(b.start ?? "~") || a.week - b.week || a.order - b.order);
	}

	roadmap() {
		return roadmap(this.store.state());
	}

	markMissed(lectureId: string, missed = true): Lecture {
		const updated = this.store.updateLecture(lectureId, (l) => {
			const { attended: _drop, ...rest } = l;
			return missed ? { ...rest, attended: false } : rest;
		});
		if (!updated) throw notFound("lecture");
		if (missed) this.log("wasnt_there", { lectureId, via: "lecture" });
		return updated;
	}

	// ─── materials (§7.5) ───────────────────────────────────────────────────

	materials(lectureId: string) {
		assertSafeId(lectureId, "lecture id");
		const md = this.content.slidesMarkdown(lectureId);
		return { lectureId, hasMaterials: md !== null, hasPdf: this.content.pdfPath(lectureId) !== null, slides: md ? slideTitles(md) : [] };
	}

	/** Slide sections for the slide panel and reader. */
	lectureSlides(lectureId: string) {
		assertSafeId(lectureId, "lecture id");
		const md = this.content.slidesMarkdown(lectureId);
		return { slides: md ? parseSlides(md) : [] };
	}

	/** Ideas to revisit (open misses), optionally for one lecture: never "overdue". */
	openMisses(lectureId?: string | null) {
		const lectures = new Map(this.store.lectures().map((l) => [l.id, l]));
		return {
			misses: this.store
				.misses()
				.filter((m) => m.status === "open" && (!lectureId || m.lectureId === lectureId))
				.map((m) => ({ id: m.id, lectureId: m.lectureId, lectureTitle: lectures.get(m.lectureId)?.title ?? m.lectureId, module: lectures.get(m.lectureId)?.module ?? "", questionText: m.questionText, correctLabels: m.correctLabels, explanation: m.explanation ?? null, reason: m.reason, createdAt: m.createdAt, nextDue: m.nextDue })),
		};
	}

	/** Modules the sample timetable offers (onboarding step 1). */
	availableModules() {
		const sample = this.content.sampleTimetable();
		return { modules: sample.modules, label: sample.label };
	}

	/** The lecture's concept map coloured by this student's answers (F-12). */
	lectureMap(lectureId: string) {
		assertSafeId(lectureId, "lecture id");
		if (!this.store.lectures().some((l) => l.id === lectureId)) throw notFound("lecture");
		const source = this.content.conceptMapSource(lectureId);
		let base: { nodes: Omit<MapNode, "status" | "answers">[]; edges: { from: string; to: string }[] };
		let kind: "authored" | "headings" = "authored";
		const parsed = source ? parseMermaidPlan(source) : null;
		if (parsed?.ok && parsed.plan) {
			base = {
				nodes: parsed.plan.nodes.map((n) => ({ id: n.id, ...splitNodeLabel(n.title || n.id) })),
				edges: parsed.plan.edges.map((e) => ({ from: e.from, to: e.to })),
			};
		} else {
			kind = "headings";
			const md = this.content.slidesMarkdown(lectureId);
			base = starterMap(md ? slideTitles(md) : []);
		}
		const evidence: MapEvidence[] = this.store
			.events()
			.filter((e) => e.type === "answer" && e.data.lectureId === lectureId && e.data.graded === true)
			.map((e) => ({
				nodeId: typeof e.data.nodeId === "string" ? e.data.nodeId : undefined,
				slides: Array.isArray(e.data.slides) ? (e.data.slides as number[]) : [],
				correct: e.data.correct === true,
				dontKnow: e.data.dontKnow === true,
				confidence: typeof e.data.confidence === "number" ? e.data.confidence : null,
				at: e.t,
			}));
		const misses = this.store.misses().filter((m) => m.lectureId === lectureId);
		return { lectureId, source: kind, mermaid: source ?? "", nodes: nodeStatuses(base.nodes, evidence, misses), edges: base.edges };
	}

	/** Subscribe to a calendar link (F-03): fetch, import, remember for refreshes. */
	/** Validate and fetch a calendar link (https:// or webcal://) with the network guards. */
	private async fetchCalendarLink(rawUrl: unknown): Promise<{ url: string; text: string }> {
		if (typeof rawUrl !== "string" || rawUrl.length > 2000) throw badRequest("url is required");
		const url = rawUrl.trim().replace(/^webcal:\/\//i, "https://");
		let parsed: URL;
		try {
			parsed = new URL(url);
		} catch {
			throw badRequest("that doesn't look like a link");
		}
		if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw badRequest("calendar links start with https:// or webcal://");
		if (!this.deps.fetchCalendar) throw new CompanionError("calendar_unavailable", 501, "calendar links are not available here");
		try {
			return { url: parsed.toString(), text: await this.deps.fetchCalendar(parsed.toString()) };
		} catch (err) {
			throw new CompanionError("calendar_fetch_failed", 502, err instanceof Error ? err.message : "couldn't fetch that calendar");
		}
	}

	async subscribeCalendar(rawUrl: unknown) {
		const { url, text } = await this.fetchCalendarLink(rawUrl);
		const parsed = new URL(url);
		const result = this.importIcs(text);
		const first = this.store.runtime().calendarUrl !== parsed.toString();
		this.store.saveRuntime({ calendarUrl: parsed.toString(), calendarRefreshedAt: new Date().toISOString() });
		this.calendarCheckedThisRun = true;
		this.log(first ? "calendar_connected" : "calendar_refreshed", { source: "link", events: result.added, unmapped: result.unmapped.length });
		return result;
	}

	async refreshCalendar() {
		const url = this.store.runtime().calendarUrl;
		if (!url) throw badRequest("no calendar link is connected");
		return this.subscribeCalendar(url);
	}

	/** The lecture's slide PDF, for the slide sheet (pdfjs renders the cited page). */
	materialsPdf(lectureId: string): string | null {
		assertSafeId(lectureId, "lecture id");
		return this.content.pdfPath(lectureId);
	}

	async importMaterials(lectureId: string, pdf: Uint8Array) {
		const lecture = this.store.lectures().find((l) => l.id === lectureId);
		if (!lecture) throw notFound("lecture");
		if (!this.deps.convertPdf) throw new CompanionError("pdf_unavailable", 501, "PDF conversion is not available");
		const pages = await this.deps.convertPdf(pdf);
		if (pages === "too-long") throw badRequest("the PDF has too many pages");
		if (pages === "unreadable") throw badRequest("the PDF could not be read");
		const assembled = assembleSlidesMarkdown(pages, lecture.title);
		this.content.writeMaterials(lectureId, { slidesMd: assembled.markdown, pdf });
		this.store.updateLecture(lectureId, (l) => ({ ...l, hasMaterials: true }));
		return { lectureId, slideCount: assembled.slideCount, needsCaption: assembled.needsCaption, slides: slideTitles(assembled.markdown) };
	}

	// ─── study blocks and the simulated lock (§7.7) ─────────────────────────

	blocks(): StudyBlock[] {
		return this.store.blocks();
	}

	saveBlocks(raw: unknown): StudyBlock[] {
		const parsed = validateBlocks(raw);
		if (!parsed.ok) throw badRequest(parsed.errors.join("; "), parsed.errors);
		const lectureIds = new Set(this.store.lectures().map((l) => l.id));
		for (const b of parsed.blocks) if (b.lectureId && !lectureIds.has(b.lectureId)) throw badRequest(`unknown lecture ${b.lectureId}`);
		this.store.saveBlocks(parsed.blocks);
		this.log("settings_changed", { changed: ["blocks"], blocks: parsed.blocks.length });
		return parsed.blocks;
	}

	// ─── the weekly plan (F-110), the routine (F-109), the check-in (F-111) ─

	private planSettings() {
		return { ...DEFAULT_PLAN, ...(this.store.profile()?.plan ?? {}) };
	}

	private mondayOf(d: Date) {
		return addDays(atTime(d, "00:00"), 1 - isoWeekday(d));
	}

	/** A week's plan: its blocks (not removed), lectures, the target and how much is planned. `weekOf` is any YYYY-MM-DD in it. */
	plan(weekOf?: string) {
		const profile = this.requireProfile();
		const monday = this.mondayOf(weekOf && /^\d{4}-\d{2}-\d{2}$/.test(weekOf) ? new Date(`${weekOf}T12:00:00`) : this.now());
		const from = dateKey(monday);
		const to = dateKey(addDays(monday, 6));
		const settings = this.planSettings();
		const blocks = this.store.blocks().filter((b) => b.date >= from && b.date <= to && b.status !== "removed").sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`));
		const lectures = this.store.lectures().filter((l) => l.start && dateKey(new Date(l.start)) >= from && dateKey(new Date(l.start)) <= to);
		const titles = new Map(this.store.lectures().map((l) => [l.id, { title: l.title, module: l.module }]));
		const committed = blocks.filter((b) => b.status === "accepted" || b.status === "started").reduce((n, b) => n + b.minutes, 0);
		return {
			week: from,
			target: settings.weeklyTargetMinutes,
			blockMinutes: settings.blockMinutes,
			committedMinutes: committed,
			proposedMinutes: blocks.filter((b) => b.status === "proposed").reduce((n, b) => n + b.minutes, 0),
			blocks: blocks.map((b) => ({ ...b, focus: b.lectureId ? (titles.get(b.lectureId) ?? null) : null })),
			lectures,
			commitments: profile.routine?.commitments ?? [],
		};
	}

	/** Propose blocks for a week (default: this one) to meet the target. Earlier proposals for that week are replaced. */
	proposePlan(body: unknown = {}) {
		const profile = this.requireProfile();
		const settings = this.planSettings();
		const target = settings.weeklyTargetMinutes;
		if (!target) throw new CompanionError("no_target", 409, "Set a weekly study target first.");
		const b = (body ?? {}) as { week?: unknown };
		const now = this.now();
		const monday = this.mondayOf(typeof b.week === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.week) ? new Date(`${b.week}T12:00:00`) : now);
		const from = dateKey(monday);
		const to = dateKey(addDays(monday, 6));
		const lastFrom = dateKey(addDays(monday, -7));
		const all = this.store.blocks();
		const inWeek = all.filter((x) => x.date >= from && x.date <= to);
		const units = lecturesWithStatus(this.store.state()).filter((l) => l.hasMaterials);
		const blocksWanted = Math.ceil(target / clampBlockMinutes(settings.blockMinutes));
		const focus = pacedUnits({ modules: profile.modules, units, now: now > monday ? now : monday, blocks: blocksWanted });
		const r = proposeWeek({
			week: monday,
			now,
			lectures: this.store.lectures(),
			...(profile.routine ? { routine: profile.routine } : {}),
			quietHours: profile.prefs.quietHours,
			targetMinutes: target,
			blockMinutes: settings.blockMinutes,
			existing: inWeek,
			lastWeek: all.filter((x) => x.date >= lastFrom && x.date < from),
			focus,
			firstTask: (id) => this.packs?.bank(id)?.[0]?.id,
			newId: () => this.id("blk"),
		});
		this.store.saveBlocks([...all.filter((x) => !(x.status === "proposed" && x.date >= from && x.date <= to)), ...r.proposals]);
		this.log("plan_proposed", { week: from, proposals: r.proposals.length, plannedMinutes: r.plannedMinutes, target, roomMinutes: r.roomMinutes, fits: r.fits, gaps: r.proposals.filter((p) => p.reason === "gap").length });
		return { ...this.plan(from), roomMinutes: r.roomMinutes, fits: r.fits, message: r.fits ? null : PLAN_COPY.weekTooFull(r.roomMinutes) };
	}

	/** Tick, move, start or remove one block (one action each, F-110). A move keeps its focus and first task. */
	updateBlock(blockId: string, patch: unknown) {
		const p = (patch ?? {}) as { status?: unknown; date?: unknown; start?: unknown; minutes?: unknown; source?: unknown };
		const blocks = this.store.blocks();
		const block = blocks.find((b) => b.id === blockId);
		if (!block) throw notFound("block");
		const next: StudyBlock = { ...block };
		const moved = (p.date !== undefined && p.date !== block.date) || (p.start !== undefined && p.start !== block.start);
		if (p.date !== undefined) {
			if (typeof p.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(p.date)) throw badRequest("date must be YYYY-MM-DD");
			next.date = p.date;
		}
		if (p.start !== undefined) {
			if (!isValidHM(p.start)) throw badRequest("start must be HH:MM");
			next.start = p.start;
		}
		if (p.minutes !== undefined) {
			if (!Number.isInteger(p.minutes) || (p.minutes as number) < BLOCK_RULES.minMinutes || (p.minutes as number) > BLOCK_RULES.maxMinutes) throw badRequest(`minutes must be ${BLOCK_RULES.minMinutes}–${BLOCK_RULES.maxMinutes}`);
			next.minutes = p.minutes as number;
		}
		if (p.status !== undefined) {
			if (p.status !== "accepted" && p.status !== "removed" && p.status !== "started" && p.status !== "proposed") throw badRequest("status must be accepted, started, removed or proposed");
			next.status = p.status;
			if (p.status === "started") next.startedAt = this.now().toISOString();
		}
		if (moved && next.status === "proposed") next.status = "accepted"; // moving a proposal is choosing it
		const source = p.source === "phone" ? "phone" : undefined;
		this.store.saveBlocks(blocks.map((b) => (b.id === blockId ? next : b)));
		const data = { blockId, date: next.date, start: next.start, minutes: next.minutes, lectureId: next.lectureId ?? null, ...(source ? { source } : {}) };
		if (moved) this.log("plan_moved", { ...data, from: `${block.date} ${block.start}` });
		if (p.status === "accepted" && block.status !== "accepted") this.log("plan_accepted", data);
		if (p.status === "removed") this.log("plan_removed", data);
		if (p.status === "started") this.log("block_started", { ...data, via: "plan" });
		return next;
	}

	/** Accept proposals: the listed ids, or every proposal in that week. */
	acceptBlocks(body: unknown) {
		const b = (body ?? {}) as { ids?: unknown; week?: unknown };
		const ids = Array.isArray(b.ids) ? new Set(b.ids.filter((x): x is string => typeof x === "string")) : null;
		const week = this.plan(typeof b.week === "string" ? b.week : undefined).week;
		const end = dateKey(addDays(new Date(`${week}T12:00:00`), 6));
		const blocks = this.store.blocks();
		const accepted: StudyBlock[] = [];
		const out = blocks.map((x) => {
			if (x.status !== "proposed" || (ids ? !ids.has(x.id) : x.date < week || x.date > end)) return x;
			const y = { ...x, status: "accepted" as const };
			accepted.push(y);
			return y;
		});
		this.store.saveBlocks(out);
		for (const a of accepted) this.log("plan_accepted", { blockId: a.id, date: a.date, start: a.start, minutes: a.minutes, lectureId: a.lectureId ?? null });
		return this.plan(week);
	}

	/** Target, block length, Sunday time, focus screen (Me → Study blocks). The target changes only when the student sets it. */
	updatePlanSettings(body: unknown) {
		const profile = this.requireProfile();
		const b = (body ?? {}) as Partial<NonNullable<Profile["plan"]>>;
		const cur = this.planSettings();
		const next = { ...cur };
		if (b.weeklyTargetMinutes !== undefined) {
			if (b.weeklyTargetMinutes !== null && (!Number.isInteger(b.weeklyTargetMinutes) || b.weeklyTargetMinutes < 30 || b.weeklyTargetMinutes > 40 * 60)) throw badRequest("weeklyTargetMinutes must be 30 minutes to 40 hours, or null");
			next.weeklyTargetMinutes = b.weeklyTargetMinutes;
		}
		if (b.blockMinutes !== undefined) next.blockMinutes = clampBlockMinutes(Number(b.blockMinutes) || DEFAULT_PLAN.blockMinutes);
		if (b.sundayTime !== undefined) {
			if (!isValidHM(b.sundayTime)) throw badRequest("sundayTime must be HH:MM");
			next.sundayTime = b.sundayTime;
		}
		if (b.focusScreen !== undefined) next.focusScreen = b.focusScreen === true;
		this.store.saveProfile({ ...profile, plan: next });
		if (next.weeklyTargetMinutes !== cur.weeklyTargetMinutes) this.log("target_changed", { from: cur.weeklyTargetMinutes, to: next.weeklyTargetMinutes, via: "settings" });
		this.log("settings_changed", { changed: Object.keys(b).map((k) => `plan.${k}`) });
		return next;
	}

	/** Save a confirmed routine (from the setup chat or the plain form) and propose this week (F-109 → F-110). */
	saveRoutine(body: unknown) {
		const profile = this.requireProfile();
		const b = (body ?? {}) as { routine?: unknown; source?: unknown; modules?: unknown };
		const v = validateRoutine(b.routine, this.now().toISOString());
		if (!v.ok) throw badRequest(v.errors.join("; "), v.errors);
		const plan = { ...this.planSettings(), weeklyTargetMinutes: v.routine.weeklyTargetMinutes, blockMinutes: v.routine.preferredBlockMinutes };
		this.store.saveProfile({ ...profile, routine: v.routine, plan });
		// The chat also learns each module's week and reading weeks (V-18).
		if (Array.isArray(b.modules)) for (const m of b.modules as { code?: unknown; week?: unknown; readingWeeks?: unknown }[]) {
			if (typeof m?.code === "string" && profile.modules.some((x) => x.code === m.code) && Number.isInteger(m.week)) this.setModuleWeek(m.code, { week: m.week, ...(Array.isArray(m.readingWeeks) ? { readingWeeks: m.readingWeeks } : {}) });
		}
		this.log(b.source === "form" ? "setup_chat_fallback_form" : "setup_chat_confirmed", { target: v.routine.weeklyTargetMinutes, commitments: v.routine.commitments.length, energy: v.routine.energy });
		return { routine: v.routine, plan: this.proposePlan({}) };
	}

	/** The Sunday check-in (F-111): last week's blocks started and minutes, the target, and next week's room. */
	checkin(opts: { quiet?: boolean } = {}) {
		const profile = this.requireProfile();
		const now = this.now();
		const summary = lastWeekSummary(this.store.blocks(), now);
		const settings = this.planSettings();
		const nextMonday = addDays(this.mondayOf(now), 7);
		const room = proposeWeek({
			week: nextMonday, now, lectures: this.store.lectures(), ...(profile.routine ? { routine: profile.routine } : {}), quietHours: profile.prefs.quietHours,
			targetMinutes: 0, blockMinutes: settings.blockMinutes, existing: [], lastWeek: [], focus: [], newId: (i) => `x${i}`,
		}).roomMinutes;
		if (!opts.quiet) this.log("checkin_shown", { started: summary.started, minutes: summary.minutes });
		return { ...summary, target: settings.weeklyTargetMinutes, nextWeek: dateKey(nextMonday), roomMinutes: room, feelings: PLAN_COPY.feelings };
	}

	/** { feeling } → the proposed target; then { target: minutes } confirms it, or { keep: true } keeps the current one. */
	answerCheckin(body: unknown) {
		const b = (body ?? {}) as { feeling?: unknown; target?: unknown; keep?: unknown };
		const c = this.checkin();
		if (!c.target) throw new CompanionError("no_target", 409, "Set a weekly study target first.");
		const current = c.target;
		if (b.feeling !== undefined) {
			if (!(FEELINGS as readonly string[]).includes(b.feeling as string)) throw badRequest(`feeling must be one of ${FEELINGS.join(", ")}`);
			const proposed = proposeTarget(current, b.feeling as Feeling, c.roomMinutes);
			this.log("checkin_answered", { feeling: b.feeling, current, proposed });
			return { proposed, current, ask: proposed === current ? null : PLAN_COPY.targetProposal(proposed), keepLabel: PLAN_COPY.keepTarget(current) };
		}
		if (b.keep === true) {
			this.log("target_kept", { target: current });
			return { target: current, plan: this.proposePlan({ week: c.nextWeek }) };
		}
		if (Number.isInteger(b.target)) {
			this.updatePlanSettings({ weeklyTargetMinutes: b.target });
			return { target: b.target, plan: this.proposePlan({ week: c.nextWeek }) };
		}
		throw badRequest("send { feeling }, then { target } to confirm or { keep: true }");
	}

	/**
	 * One turn of "plan my week with me" (F-109). Body: { messages: [{ role, text }] }.
	 * Stateless: nothing is saved until the summary is confirmed (POST /routine).
	 * A turn that still breaks the rules after the model's retry returns
	 * { fallback: true }: the screen switches to the plain form.
	 */
	async setupChatTurn(body: unknown) {
		const profile = this.requireProfile();
		if (!this.deps.generate) throw new CompanionError("chat_unavailable", 501, "the setup chat needs the AI connection");
		if (!this.aiReady) throw new CompanionError("not_connected", 409, "Connect your AI to plan with the chat, or use the form.");
		const b = (body ?? {}) as { messages?: unknown; skip?: unknown };
		if (b.skip === true) {
			this.log("setup_chat_skipped", {});
			return { skipped: true };
		}
		const messages = (Array.isArray(b.messages) ? b.messages : [])
			.filter((m): m is { role: "assistant" | "student"; text: string } => !!m && (m.role === "assistant" || m.role === "student") && typeof m.text === "string")
			.map((m) => ({ role: m.role, text: m.text.slice(0, 600) }))
			.slice(-20);
		if (messages.length === 0) this.log("setup_chat_started", {});
		const chat = new SetupChat({ generate: this.deps.generate, promptsDir: this.deps.promptsDir ?? "companion/prompts" });
		try {
			const t = await chat.turn({ messages, modules: profile.modules });
			this.log("setup_chat_turn", { turn: messages.filter((m) => m.role === "assistant").length + 1, done: t.done, chips: t.chips.length });
			return t;
		} catch (err) {
			this.log("setup_chat_fallback_form", { reason: err instanceof Error ? err.message.slice(0, 200) : "error" });
			return { fallback: true, say: "Let's do this with taps instead." };
		}
	}

	// ─── the phone (F-112) ──────────────────────────────────────────────────

	requirePhone(): PhoneLink {
		if (!this.phone) throw new CompanionError("phone_unavailable", 501, "No phone relay is set up (COMPANION_RELAY_URL).");
		return this.phone;
	}

	/** The phone acted on a nudge first: the laptop drops its copy (§5.2 item 5: whichever device acts first wins). */
	phoneHandledNudge(key: string, outcome: "opened" | "snoozed" | "dismissed", at: string) {
		const mine = [...this.store.nudges()].reverse().find((n) => n.key === key);
		if (mine?.outcome) return;
		if (mine) {
			this.store.appendNudge({ ...mine, outcome, outcomeAt: at });
			return;
		}
		// Fired while the laptop was asleep: record it so the laptop never fires it again (the cap holds across devices).
		const type = key.split(":")[0] as NudgeRecord["type"];
		this.store.appendNudge({ id: this.id("n"), type: (["N-1", "N-2", "N-3", "N-4", "N-5", "block"] as const).includes(type as never) ? type : "N-1", key, firedAt: at, text: "(on your phone)", outcome, outcomeAt: at });
	}

	/** An answer given on the phone: a wrong one becomes an idea to revisit, as on the laptop (§6.8). */
	phoneAnswer(a: { lectureId: string; questionId: string; choice: number; correct: boolean; at: string }) {
		const q = this.packs?.bank(a.lectureId)?.find((x) => x.id === a.questionId);
		if (!q || a.correct) return;
		const record: AnswerRecord = { questionId: q.id, questionText: q.stem, nodeId: q.node, graded: true, correct: false, dontKnow: false, shown: false, correctLabels: [q.options[q.correct]], explanation: q.explanation, answeredAt: a.at };
		const miss = missFromAnswer(record, { sessionId: "phone", lectureId: a.lectureId, now: new Date(a.at) });
		if (miss) this.store.saveMisses(mergeMisses(this.store.misses(), [miss]));
	}

	/**
	 * "4 more on your laptop" (J2′ step 4): a post-lecture session on that unit
	 * with question 1 recorded from the phone, ready at question 2, and a toast:
	 * "Question 1 answered on your phone ✓ 4 more ready."
	 */
	startHandoff(h: { lectureId: string; questionId?: string; choice?: number; correct?: boolean; at: string; phoneEventId: string }) {
		const key = `handoff:${h.phoneEventId}`;
		if (this.store.nudges().some((n) => n.key === key)) return null;
		const spec = specFor("post-lecture", h.lectureId, this.store.profile()?.prefs);
		const q = h.questionId ? this.packs?.bank(h.lectureId)?.find((x) => x.id === h.questionId) : undefined;
		if (h.questionId && h.choice !== undefined && h.correct !== undefined) {
			spec.seedAnswer = { questionId: h.questionId, choice: h.choice, correct: h.correct, at: h.at, ...(q ? { stem: q.stem, choiceLabel: q.options[h.choice] ?? "" } : {}) };
		}
		const { sessionId } = this.createSession(spec);
		const more = spec.seedAnswer ? spec.budget.questions - 1 : spec.budget.questions;
		this.store.appendNudge({ id: this.id("n"), type: "N-1", key, firedAt: this.now().toISOString(), title: HANDOFF_COPY.title, text: HANDOFF_COPY.toast(more), lectureId: h.lectureId, sessionId, why: "you asked on your phone" });
		return { sessionId };
	}

	/** Facilitator (F-119): play a phone answer and hand-off on the laptop, for a lab without a phone. */
	demoPhone(raw: unknown) {
		const r = (raw ?? {}) as { action?: unknown; correct?: unknown };
		const n1 = [...this.store.nudges()].reverse().find((n) => n.type === "N-1" && n.lectureId && !n.key.startsWith("handoff:"));
		const lectureId = n1?.lectureId ?? this.store.lectures().find((l) => l.hasMaterials)?.id;
		if (!lectureId) throw badRequest("no lecture with material to answer on");
		const q = this.questionFor(lectureId);
		const choice = q ? (r.correct === false ? (q.correct + 1) % 3 : q.correct) : 0;
		const at = this.now().toISOString();
		const base = { nudgeId: n1?.key ?? `N-1:${lectureId}`, lectureId, ...(q ? { questionId: q.id, choice, correct: choice === q.correct } : {}) };
		const events = [{ id: `sim-${this.id("e")}`, at, type: "answered", payload: base }];
		if (r.action !== "answer") events.push({ id: `sim-${this.id("e")}`, at, type: r.action === "done" ? "done_for_now" : "handover", payload: base });
		const link = this.phone ?? new PhoneLink(this, this.store, new RelayClient("http://offline.invalid"));
		return { replayed: link.replay(events), simulated: true };
	}

	/** Skip a block: v0.1 blocks are dated, so skipping is removing (X-7: one tap). */
	skipBlock(blockId: string): StudyBlock {
		return this.updateBlock(blockId, { status: "removed" });
	}

	activeBlock() {
		const profile = this.store.profile();
		return { active: activeBlock(this.store.blocks(), this.now()), lock: profile?.prefs.lock ?? "off", simulated: true };
	}

	appOpen(input: { app?: unknown; confirmed?: unknown; reason?: unknown }) {
		if (typeof input.app !== "string" || !input.app || input.app.length > 40) throw badRequest("app is required");
		const now = this.now();
		const strictness = this.store.profile()?.prefs.lock ?? "off";
		const active = activeBlock(this.store.blocks(), now);
		const reason = typeof input.reason === "string" ? input.reason.slice(0, 200) : undefined;
		const decision = lockDecision({ strictness, active, now, overrideUntil: this.store.runtime().lockOverrideUntil, confirmed: input.confirmed === true, reason });
		if (decision.allowed && decision.reason === "override") {
			const until = addMinutes(now, BLOCK_RULES.overrideMinutes).toISOString();
			this.store.saveRuntime({ lockOverrideUntil: until });
			this.log("lock_override", { app: input.app, strictness, reason: reason ?? null, until });
			return { ...decision, until };
		}
		if (!decision.allowed) this.log("app_open_blocked", { app: input.app, strictness, prompt: decision.prompt });
		return decision;
	}

	// ─── nudges (§7.6) ──────────────────────────────────────────────────────

	/** The nudge on screen: the newest fired today with no outcome yet, within its TTL. */
	banner(): (NudgeRecord & { ready: boolean }) | null {
		const now = this.now();
		const n = [...this.store.nudges()].reverse().find((x) => !x.outcome && sameDay(x.firedAt, now));
		if (!n || addMinutes(new Date(n.firedAt), NUDGE_RULES.bannerTtlMinutes) < now) return null;
		const session = n.sessionId ? this.store.session(n.sessionId) : null;
		return { ...n, ready: isSessionReady(session ?? undefined) };
	}

	/**
	 * The phone frame's 30-second tick: pre-warm what is coming, fire what is
	 * due. Sessions started by this tick get up to `settleMs` to become ready
	 * (scripted ones are ready in microseconds; LearnHarness takes seconds and
	 * is simply picked up by a later tick).
	 */
	async tick(settleMs = 250): Promise<{ nudge: (NudgeRecord & { ready: boolean }) | null; prepared: string[] }> {
		const prepared: string[] = [];
		if (!this.store.profile()) return { nudge: null, prepared };
		const now = this.now();
		for (const c of prewarmCandidates(this.store.state(), now)) {
			// One bad candidate must never break the tick the phone frame polls.
			try {
				prepared.push(this.createSession(c.spec, { nudgeKey: c.key }).sessionId);
			} catch (err) {
				this.log("error", { where: "prewarm", key: c.key, message: err instanceof Error ? err.message : String(err) });
			}
		}
		if (prepared.length > 0 && settleMs > 0) {
			let timer: ReturnType<typeof setTimeout> | undefined;
			await Promise.race([
				Promise.all(prepared.map((id) => this.whenReady(id))),
				new Promise((r) => (timer = setTimeout(r, settleMs))),
			]);
			clearTimeout(timer);
		}
		this.phone?.tick();
		const [due] = dueNudges(this.store.state(), now);
		if (due) {
			try {
				this.fire(due, false);
			} catch (err) {
				this.log("error", { where: "fire", key: due.key, message: err instanceof Error ? err.message : String(err) });
			}
		}
		return { nudge: this.banner(), prepared };
	}

	/** A bank question for a unit, as a notification shows it (N-1 v2), skipping ids already used. */
	questionFor(lectureId: string, used: ReadonlySet<string> = new Set()): NudgeQuestion | undefined {
		const bank = this.packs?.bank(lectureId) ?? null;
		const q = bank?.find((x) => !used.has(x.id)) ?? bank?.[0];
		return q ? { id: q.id, lectureId, stem: q.stem, options: q.options, correct: q.correct, explanation: q.explanation, slides: q.slides } : undefined;
	}

	/** The next 7 days of nudges for the phone relay (F-112, F-114): same rules as the live tick. */
	schedule() {
		const now = this.now();
		const state = this.store.state();
		return { now: now.toISOString(), nudges: scheduleWeek(state, now, { questionFor: (id, used) => this.questionFor(id, used) }) };
	}

	private fire(c: NudgeCandidate, forced: boolean): NudgeRecord {
		// N-5 opens the check-in, not a session (F-111).
		const sessionId = c.opens === "checkin" ? undefined : (c.sessionId ?? this.createSession(c.spec, { nudgeKey: c.key }).sessionId);
		const lecture = c.type === "N-1" ? this.store.lectures().find((l) => c.key === `N-1:${l.id}` || c.key.startsWith(`forced:N-1:${l.id}:`)) ?? this.lectureById(c.lectureId ?? "") : undefined;
		const used = new Set(this.store.nudges().map((n) => n.questionId).filter((q): q is string => !!q));
		const question = c.type === "N-1" && c.lectureId ? this.questionFor(c.lectureId, used) : undefined;
		const record: NudgeRecord = {
			id: this.id("n"),
			type: c.type,
			key: c.key,
			firedAt: this.now().toISOString(),
			// N-1 v2 (F-114): the question is the notification; the v1 sentence is the fallback.
			text: question ? question.stem : c.text,
			...(question && lecture ? { title: NUDGE_TEXT.n1Title(lecture.module), questionId: question.id } : c.type === "N-5" ? { title: NUDGE_TEXT.n5Title } : {}),
			...(c.why ? { why: c.why } : {}),
			...(c.lectureId ? { lectureId: c.lectureId } : {}),
			...(sessionId ? { sessionId } : {}),
			...(c.returnOf ? { returnOf: c.returnOf } : {}),
			...(forced ? { forced: true } : {}),
		};
		this.store.appendNudge(record);
		const session = sessionId ? this.store.session(sessionId) : null;
		this.log("nudge_fired", { nudgeId: record.id, type: c.type, key: c.key, lectureId: c.lectureId ?? null, sessionId: sessionId ?? null, sessionReady: isSessionReady(session ?? undefined), forced, questionId: record.questionId ?? null, why: c.why ?? null });
		if (c.type === "block") this.log("block_started", { nudgeId: record.id, lectureId: c.lectureId ?? null });
		return record;
	}

	nudgeAction(nudgeId: string, action: string): { nudge: NudgeRecord; sessionId?: string; returnAt?: string; href?: string } {
		if (!(NUDGE_ACTIONS as readonly string[]).includes(action)) throw badRequest(`action must be one of ${NUDGE_ACTIONS.join(", ")}`);
		const nudge = this.store.nudge(nudgeId);
		if (!nudge) throw notFound("nudge");
		const now = this.now();
		const act = action as NudgeAction;
		if (nudge.outcome && !(act === "open" && nudge.outcome === "opened")) throw conflict("nudge_already_handled", `this nudge was already ${nudge.outcome}`);
		const settle = (outcome: NonNullable<NudgeRecord["outcome"]>): NudgeRecord => {
			const next = { ...nudge, outcome, outcomeAt: now.toISOString() };
			this.store.appendNudge(next);
			return next;
		};
		const msSinceFired = now.getTime() - new Date(nudge.firedAt).getTime();
		switch (act) {
			case "open": {
				if (nudge.type === "N-5") {
					const next = nudge.outcome === "opened" ? nudge : settle("opened");
					this.log("nudge_opened", { nudgeId, type: nudge.type, msSinceFired });
					return { nudge: next, href: "/app/plan?checkin=1" };
				}
				let session = nudge.sessionId ? this.store.session(nudge.sessionId) : null;
				if (!session || session.state === "error") {
					const spec = session?.spec ?? specFor(nudge.type === "N-3" ? "missed-lecture" : nudge.type === "N-2" ? "retest" : nudge.type === "block" ? "block" : "post-lecture", nudge.lectureId ?? "", this.store.profile()?.prefs);
					session = this.store.session(this.createSession(spec).sessionId)!;
				}
				const updated = nudge.outcome === "opened" ? nudge : settle("opened");
				const next = updated.sessionId === session.id ? updated : { ...updated, sessionId: session.id };
				if (next !== updated) this.store.appendNudge(next);
				this.log("nudge_opened", { nudgeId, type: nudge.type, sessionId: session.id, sessionReady: isSessionReady(session), msSinceFired });
				return { nudge: next, sessionId: session.id };
			}
			case "snooze": {
				const next = settle("snoozed");
				const returnAt = snoozeReturnTime(this.store.state(), now).toISOString();
				this.log("nudge_snoozed", { nudgeId, type: nudge.type, sessionId: nudge.sessionId ?? null, returnAt, msSinceFired });
				return { nudge: next, returnAt };
			}
			case "dismiss": {
				const next = settle("dismissed");
				this.stopQuietly(nudge.sessionId);
				this.log("nudge_dismissed", { nudgeId, type: nudge.type, msSinceFired });
				return { nudge: next };
			}
			case "wasnt-there": {
				if (nudge.type !== "N-1" || !nudge.lectureId) throw badRequest("\"I wasn't there\" only applies to a post-lecture nudge");
				const next = settle("wasnt-there");
				this.store.updateLecture(nudge.lectureId, (l) => ({ ...l, attended: false }));
				this.stopQuietly(nudge.sessionId);
				this.log("wasnt_there", { nudgeId, lectureId: nudge.lectureId, via: "nudge" });
				return { nudge: next };
			}
		}
	}

	private stopQuietly(sessionId: string | undefined): void {
		if (!sessionId) return;
		this.store.updateSession(sessionId, (s) => (s.openedAt || s.state === "done" ? s : { ...s, state: "stopped", endedAt: this.now().toISOString() }));
	}

	/** Upcoming candidates (facilitator view). */
	candidates() {
		const now = this.now();
		const state = this.store.state();
		return nudgeCandidates(state, now).map((c) => ({ type: c.type, key: c.key, text: c.text, lectureId: c.lectureId ?? null, fireAt: c.fireAt, fireBy: c.fireBy, sessionId: c.sessionId ?? null }));
	}

	// ─── sessions (§6) ──────────────────────────────────────────────────────

	parseSpec(raw: unknown): SessionSpec {
		const r = (raw ?? {}) as Partial<SessionSpec> & { questions?: unknown };
		if (typeof r.kind !== "string" || !(SESSION_KINDS as readonly string[]).includes(r.kind)) throw badRequest(`kind must be one of ${SESSION_KINDS.join(", ")}`);
		if (typeof r.lectureId !== "string") throw badRequest("lectureId is required");
		const spec = specFor(r.kind, assertSafeId(r.lectureId, "lecture id"), this.store.profile()?.prefs, Array.isArray(r.missIds) ? r.missIds.filter((m): m is string => typeof m === "string") : undefined);
		if (r.nodes !== undefined) {
			if (!Array.isArray(r.nodes) || r.nodes.length > 10 || !r.nodes.every((n) => typeof n === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(n))) throw badRequest("nodes must be up to 10 concept-map node ids");
			if (r.nodes.length) spec.nodes = [...r.nodes];
		}
		if (r.mode !== undefined) {
			if (r.mode !== "question-first" && r.mode !== "show-first") throw badRequest("mode must be question-first or show-first");
			spec.mode = r.mode;
		}
		const questions = r.questions ?? r.budget?.questions;
		if (questions !== undefined) {
			if (!Number.isInteger(questions) || (questions as number) < 1 || (questions as number) > 20) throw badRequest("questions must be 1–20");
			spec.budget.minutes = Math.max(1, Math.round((spec.budget.minutes * (questions as number)) / spec.budget.questions));
			spec.budget.questions = questions as number;
		}
		return spec;
	}

	private engineFor(name: EngineName): SessionEngine {
		const engine = this.deps.engines[name];
		if (!engine) throw new CompanionError("engine_unavailable", 503, `engine ${name} is not configured`);
		return engine;
	}

	createSession(spec: SessionSpec, opts: { nudgeKey?: string; engine?: EngineName } = {}): { sessionId: string } {
		// The first taste is prepared during onboarding, before the profile exists (J1′).
		if (!(spec.kind === "try-now" && spec.lectureId === FIRST_TASTE_LECTURE)) this.requireProfile();
		const lecture = this.lectureById(spec.lectureId);
		if (!lecture) throw notFound("lecture");
		if (spec.kind === "retest" && !(spec.missIds && spec.missIds.length > 0)) {
			const misses = dueMissesForRetest(this.store.misses().filter((m) => m.lectureId === spec.lectureId), this.now(), true);
			if (misses.length === 0) throw badRequest("nothing to retest for this lecture");
			spec = { ...spec, missIds: misses.map((m) => m.id) };
		}
		const engine = opts.engine ?? this.store.demo().engineOverride ?? this.defaultEngine();
		const session: CompanionSession = {
			id: this.id("s"),
			engine,
			spec,
			...(opts.nudgeKey ? { nudgeKey: opts.nudgeKey } : {}),
			budget: spec.budget.questions,
			answered: 0,
			createdAt: this.now().toISOString(),
			state: "preparing",
		};
		this.store.saveSession(session);
		this.log("session_prepare_started", { sessionId: session.id, engine, kind: spec.kind, lectureId: spec.lectureId, prewarm: !!opts.nudgeKey });
		const run = this.prepare(session.id).finally(() => this.preparing.delete(session.id));
		this.preparing.set(session.id, run);
		return { sessionId: session.id };
	}

	/** Resolves when preparation settles (ready or error). For tests and the tracer. */
	whenReady(sessionId: string): Promise<void> {
		return this.preparing.get(sessionId) ?? Promise.resolve();
	}

	private async prepare(sessionId: string, attempt = 0): Promise<void> {
		const started = Date.now();
		const session = this.store.session(sessionId);
		if (!session) return;
		const engine = this.deps.engines[session.engine];
		try {
			if (!engine) throw new CompanionError("engine_unavailable", 503, `engine ${session.engine} is not configured`);
			const lecture = this.lectureById(session.spec.lectureId);
			if (!lecture) throw notFound("lecture");
			const missIds = new Set(session.spec.missIds ?? []);
			const misses = this.store.misses().filter((m) => missIds.has(m.id));
			const moduleName = this.store.profile()?.modules.find((m) => m.code === lecture.module)?.name;
			const { text } = buildOpeningMessage({
				spec: session.spec,
				lecture,
				...(moduleName ? { moduleName } : {}),
				slidesMarkdown: this.content.slidesMarkdown(lecture.id) ?? "",
				conceptMap: this.content.conceptMapSource(lecture.id) ?? undefined,
				misses,
				now: this.now(),
			});
			const patch = await engine.start(session, { title: `${lecture.module} · ${lecture.title}`, openingMessage: text, misses });
			const started2 = this.store.updateSession(sessionId, (s) => ({ ...s, ...patch }));
			if (!started2) return;
			await engine.waitUntilReady(started2, this.deps.readyTimeoutMs ?? PREPARE_RULES.readyTimeoutMs);
			this.store.updateSession(sessionId, (s) => ({
				...s,
				readyAt: this.now().toISOString(),
				state: s.state === "preparing" ? (s.openedAt ? "active" : "ready") : s.state,
			}));
			this.log("session_prepared", { sessionId, engine: session.engine, kind: session.spec.kind, latencyMs: Date.now() - started, chatId: started2.chatId ?? null });
		} catch (err) {
			const code = err instanceof CompanionError ? err.code : "prepare_failed";
			const message = err instanceof Error ? err.message : String(err);
			if (this.deps.autoFallback && attempt === 0 && session.engine === "learnharness" && this.safeHasScripted(session.spec.lectureId)) {
				this.store.updateSession(sessionId, (s) => ({ ...s, engine: "scripted", fellBackFrom: "learnharness", state: "preparing" }));
				this.log("engine_fallback", { sessionId, from: "learnharness", to: "scripted", code, message });
				return this.prepare(sessionId, 1);
			}
			this.store.updateSession(sessionId, (s) => ({ ...s, state: "error", error: code }));
			this.log("error", { where: "prepare", sessionId, engine: session.engine, code, message });
		}
	}

	private safeHasScripted(lectureId: string): boolean {
		try {
			return this.content.scriptedSet(lectureId) !== null;
		} catch {
			return false;
		}
	}

	private requireSession(id: string): { session: CompanionSession; lecture: Lecture; engine: SessionEngine } {
		const session = this.store.session(assertSafeId(id, "session id"));
		if (!session) throw notFound("session");
		const lecture = this.lectureById(session.spec.lectureId);
		if (!lecture) throw notFound("lecture");
		return { session, lecture, engine: this.engineFor(session.engine) };
	}

	async view(id: string): Promise<SessionView> {
		const { session, lecture, engine } = this.requireSession(id);
		const now = this.now();
		if (!session.chatId && !session.scripted) {
			// The engine has not started this session: either the first turn is
			// still being admitted (show the wait) or starting failed (say so).
			this.markOpened(session, now);
			const base = {
				id: session.id, engine: session.engine, kind: session.spec.kind, mode: session.spec.mode,
				lecture: { id: lecture.id, title: lecture.title, module: lecture.module },
				goal: goalFor(session.spec, lecture, session.budget), answered: 0, budget: session.budget, canHint: false, slideRefs: [],
			};
			return session.state === "error"
				? { ...base, status: "error", error: session.error ?? "prepare_failed" }
				: { ...base, status: "preparing", activity: `Reading your ${lecture.module} slides → writing question 1` };
		}
		const raw = await engine.view(session, lecture);
		// A hand-off (F-112): question 1 was answered on the phone. The scripted engine counts it itself.
		const v = session.spec.seedAnswer && session.engine === "learnharness" ? { ...raw, answered: raw.answered + 1 } : raw;
		this.markOpened(session, now);
		this.store.updateSession(session.id, (s) => {
			let next: CompanionSession = { ...s, answered: v.answered };
			if (v.question && !(s.shownQuestionIds ?? []).includes(v.question.id)) {
				next = { ...next, shownQuestionIds: [...(s.shownQuestionIds ?? []), v.question.id], questionShownAt: now.toISOString() };
				this.log("question_shown", {
					sessionId: s.id, questionId: v.question.id, n: v.answered + 1, engine: s.engine,
					msSinceOpen: s.openedAt ? now.getTime() - new Date(s.openedAt).getTime() : 0,
				});
			}
			if (v.status === "done" && s.state !== "done") {
				next = { ...next, state: "done", endedAt: now.toISOString() };
				this.log("session_done", { sessionId: s.id, answered: v.answered, budget: v.budget, endedEarly: !!v.endedEarly, engine: s.engine, cost: engine.cost(s) });
			}
			return next;
		});
		return v;
	}

	private markOpened(session: CompanionSession, now: Date): void {
		if (session.openedAt && session.state !== "stopped") return;
		const resumed = !!session.openedAt;
		this.store.updateSession(session.id, (s) => ({
			...s,
			openedAt: s.openedAt ?? now.toISOString(),
			lastActivityAt: now.toISOString(),
			state: s.state === "ready" || s.state === "stopped" ? "active" : s.state,
		}));
		this.log("session_opened", { sessionId: session.id, engine: session.engine, kind: session.spec.kind, prewarmed: !!session.nudgeKey, ready: isSessionReady(session), resumed });
	}

	parseAnswer(raw: unknown): AnswerInput {
		const r = (raw ?? {}) as Record<string, unknown>;
		if (typeof r.questionId !== "string" || !r.questionId) throw badRequest("questionId is required");
		const out: AnswerInput = { questionId: r.questionId };
		if (r.dontKnow === true) out.dontKnow = true;
		if (r.indices !== undefined) {
			if (!Array.isArray(r.indices) || !r.indices.every((i) => Number.isInteger(i) && i >= 1)) throw badRequest("indices must be 1-based option numbers");
			out.indices = r.indices as number[];
		}
		if (!out.dontKnow && !(out.indices && out.indices.length > 0)) throw badRequest("choose an option or \"I don't know\"");
		if (r.confidence !== undefined && !out.dontKnow) {
			if (typeof r.confidence !== "number" || !CONFIDENCE_STOPS.includes(r.confidence)) throw badRequest(`confidence must be one of ${CONFIDENCE_STOPS.join(", ")}`);
			out.confidence = r.confidence;
		}
		if (r.why !== undefined) {
			if (typeof r.why !== "string" || r.why.length > 2_000) throw badRequest("why must be text under 2000 characters");
			if (r.why.trim()) out.why = r.why.trim();
		}
		return out;
	}

	async answer(id: string, raw: unknown): Promise<{ correct: boolean; graded: boolean }> {
		const { session, engine } = this.requireSession(id);
		if (session.state === "error") throw conflict("session_error", "this session failed; start a new one or retry");
		const a = this.parseAnswer(raw);
		const now = this.now();
		const { record, patch } = await engine.answer(session, a, now);
		const counts = record.graded && !record.shown;
		const updated = this.store.updateSession(id, (s) => ({
			...s,
			...patch,
			answered: s.answered + (counts ? 1 : 0),
			lastActivityAt: now.toISOString(),
			state: s.state === "stopped" || s.state === "ready" ? "active" : s.state,
		}))!;
		const miss = missFromAnswer(record, { sessionId: id, lectureId: session.spec.lectureId, now });
		let misses = this.store.misses();
		if (miss) misses = mergeMisses(misses, [miss]);
		if (session.spec.kind === "retest" && counts && session.spec.missIds) misses = applyRetestAnswer(misses, session.spec.missIds, updated.answered, record, now);
		if (miss || session.spec.kind === "retest") this.store.saveMisses(misses);
		this.log("answer", {
			sessionId: id, lectureId: session.spec.lectureId, questionId: record.questionId, nodeId: record.nodeId ?? null,
			slides: parseSlideRefs(record.explanation), n: updated.answered, engine: session.engine, kind: session.spec.kind,
			graded: record.graded, correct: record.correct, dontKnow: record.dontKnow, confidence: record.confidence ?? null,
			why: !!record.why, whyLength: record.why?.length ?? 0, assisted: (session.hintedQuestionIds ?? []).includes(record.questionId),
			msOnQuestion: session.questionShownAt ? now.getTime() - new Date(session.questionShownAt).getTime() : null,
			miss: miss?.reason ?? null,
		});
		return { correct: record.correct, graded: record.graded };
	}

	async showMe(id: string, raw: unknown): Promise<void> {
		const { session, engine } = this.requireSession(id);
		const questionId = (raw as { questionId?: unknown } | null)?.questionId;
		if (typeof questionId !== "string" || !questionId) throw badRequest("questionId is required");
		const { patch } = await engine.showMe(session, questionId, this.now());
		this.store.updateSession(id, (s) => ({ ...s, ...patch, lastActivityAt: this.now().toISOString() }));
		this.log("show_me", { sessionId: id, questionId, engine: session.engine });
	}

	async hint(id: string, raw: unknown): Promise<{ text: string }> {
		const { session, engine } = this.requireSession(id);
		const questionId = (raw as { questionId?: unknown } | null)?.questionId;
		if (typeof questionId !== "string" || !questionId) throw badRequest("questionId is required");
		const { text, patch } = await engine.hint(session, questionId);
		this.store.updateSession(id, (s) => ({ ...s, ...patch }));
		this.log("hint", { sessionId: id, questionId, engine: session.engine });
		return { text };
	}

	async more(id: string, raw: unknown): Promise<{ budget: number }> {
		const { session, engine } = this.requireSession(id);
		const n = (raw as { questions?: unknown } | null)?.questions ?? KEEP_GOING_QUESTIONS;
		if (!Number.isInteger(n) || (n as number) < 1 || (n as number) > 10) throw badRequest("questions must be 1–10");
		const budget = session.budget + (n as number);
		const raised = this.store.updateSession(id, (s) => ({ ...s, budget, state: s.state === "done" || s.state === "stopped" ? "active" : s.state }))!;
		const { patch } = await engine.more(raised, n as number);
		this.store.updateSession(id, (s) => ({ ...s, ...patch, lastActivityAt: this.now().toISOString() }));
		this.log("keep_going", { sessionId: id, added: n, budget });
		return { budget };
	}

	stop(id: string): void {
		const { session } = this.requireSession(id);
		if (session.state === "done" || session.state === "stopped") return;
		this.store.updateSession(id, (s) => ({ ...s, state: "stopped", endedAt: this.now().toISOString() }));
		this.log("session_stopped", { sessionId: id, answered: session.answered, budget: session.budget, engine: session.engine });
	}

	async retry(id: string): Promise<void> {
		const { session, engine } = this.requireSession(id);
		if (session.state === "error" && !session.chatId && !session.scripted) {
			// Never started: prepare again from scratch.
			this.store.updateSession(id, (s) => ({ ...s, state: "preparing", error: undefined }));
			const run = this.prepare(id).finally(() => this.preparing.delete(id));
			this.preparing.set(id, run);
			return;
		}
		await engine.retry(session);
		this.store.updateSession(id, (s) => ({ ...s, state: s.openedAt ? "active" : "ready", error: undefined }));
	}

	sessionCost(id: string) {
		const { session, engine } = this.requireSession(id);
		return { sessionId: id, engine: session.engine, cost: engine.cost(session) };
	}

	// ─── progress and today (§7.8) ──────────────────────────────────────────

	progress() {
		const now = this.now();
		const state = this.store.state();
		return { week: weekSummary(state, now), welcomeBack: welcomeBack(state, now), roadmap: roadmap(state) };
	}

	today() {
		void this.refreshCalendarIfDue();
		const now = this.now();
		const state = this.store.state();
		const firstRun = state.sessions.every((s) => !s.openedAt);
		const tryNow = firstRun ? tryNowLecture(state, now) : undefined;
		const todays = lecturesWithStatus(state).filter((l) => !!l.start && sameDay(l.start, now));
		const nextBlock = (() => {
			for (let i = 0; i < 8; i++) {
				const c = commitmentsOn({ lectures: [], blocks: state.blocks }, addDays(now, i)).find((b) => b.end > now);
				if (c) return { blockId: c.id, start: c.start.toISOString(), end: c.end.toISOString() };
			}
			return null;
		})();
		return {
			now: now.toISOString(),
			onboarded: !!state.profile,
			tryNow: tryNow ? { lectureId: tryNow.id, title: tryNow.title, module: tryNow.module, spec: specFor("try-now", tryNow.id, state.profile?.prefs) } : null,
			lectures: todays,
			nextBlock,
			readyToRevisit: state.misses.filter((m) => m.status === "open").length,
			welcomeBack: welcomeBack(state, now),
			banner: this.banner(),
			phonePaired: this.phone?.paired() ?? false,
			phoneAvailable: this.phone !== null,
			activeSession: state.sessions.filter((s) => s.state === "active" && s.answered < s.budget).at(-1)?.id ?? null,
		};
	}

	// ─── data (R-7) ─────────────────────────────────────────────────────────

	async deleteAll(): Promise<{ deleted: true }> {
		// "Delete all my data" also deletes what the relay holds (F-112, J9).
		await this.phone?.unpair().catch(() => undefined);
		this.removeEngineData();
		this.store.wipe({ keepMaterials: true });
		return { deleted: true };
	}

	private removeEngineData(): void {
		for (const s of this.store.sessions()) {
			try {
				this.deps.engines[s.engine]?.remove(s);
			} catch {
				// Best effort: a running turn keeps its chat; the companion record still goes.
			}
		}
	}

	// ─── facilitator (§7.10; routes gated by COMPANION_DEMO=1) ──────────────

	demoState() {
		const demo = this.store.demo();
		let scenarios: string[] = [];
		try {
			scenarios = Object.keys(this.content.sampleTimetable().scenarios ?? {});
		} catch {
			scenarios = [];
		}
		return {
			now: this.now().toISOString(),
			realNow: new Date().toISOString(),
			clockOffsetMs: demo.clockOffsetMs,
			participant: demo.participant ?? null,
			engineOverride: demo.engineOverride ?? null,
			defaultEngine: this.defaultEngine(),
			onboarded: this.store.profile() !== null,
			candidates: this.store.profile() ? this.candidates() : [],
			banner: this.banner(),
			scenarios,
		};
	}

	demoClock(raw: unknown) {
		const r = (raw ?? {}) as { set?: unknown; advanceMinutes?: unknown; jump?: unknown };
		const now = this.now();
		if (r.jump === "reset") this.deps.clockControl.reset();
		else if (typeof r.set === "string") {
			const t = new Date(r.set);
			if (Number.isNaN(t.getTime())) throw badRequest("set must be an ISO time");
			this.deps.clockControl.set(t);
		} else if (typeof r.advanceMinutes === "number" && Number.isFinite(r.advanceMinutes)) {
			this.deps.clockControl.set(addMinutes(now, r.advanceMinutes));
		} else if (r.jump === "next-lecture-end") {
			const next = this.store
				.lectures()
				.filter((l): l is TimedLecture => isTimed(l) && (l.kind ?? "lecture") === "lecture" && new Date(l.end) > now)
				.sort((a, b) => a.end.localeCompare(b.end))[0];
			if (!next) throw badRequest("no lecture ends after the demo clock");
			this.deps.clockControl.set(new Date(next.end));
		} else if (r.jump === "next-day") {
			this.deps.clockControl.set(atTime(addDays(now, 1), "09:00"));
		} else if (r.jump === "sunday-evening") {
			// The coming Sunday at the student's check-in time (F-111: "jump to Sunday 19:00").
			const days = (7 - isoWeekday(now)) % 7;
			this.deps.clockControl.set(atTime(addDays(now, days), this.planSettings().sundayTime));
		} else throw badRequest("use {set: ISO}, {advanceMinutes: n} or {jump: next-lecture-end | next-day | sunday-evening | reset}");
		return this.demoState();
	}

	demoFire(raw: unknown): NudgeRecord {
		this.requireProfile();
		const r = (raw ?? {}) as { type?: unknown; lectureId?: unknown };
		const types: NudgeType[] = ["N-1", "N-2", "N-3", "N-4", "N-5", "block"];
		if (typeof r.type !== "string" || !types.includes(r.type as NudgeType)) throw badRequest(`type must be one of ${types.join(", ")}`);
		const c = forcedCandidate(this.store.state(), this.now(), r.type as NudgeType, typeof r.lectureId === "string" ? { lectureId: r.lectureId } : {});
		if (typeof c === "string") throw badRequest(c);
		return this.fire(c, true);
	}

	/** Reset for the next participant. The event log is archived, never lost. */
	demoReset(): ReturnType<CompanionService["demoState"]> & { archivedEvents: string | null } {
		this.removeEngineData();
		const archivedEvents = this.store.wipe({ keepMaterials: true, archiveEvents: true });
		this.deps.clockControl.reset();
		return { ...this.demoState(), archivedEvents };
	}

	demoScenario(raw: unknown) {
		const name = (raw as { name?: unknown } | null)?.name;
		const sample = this.content.sampleTimetable();
		const scenario = typeof name === "string" ? sample.scenarios?.[name] : undefined;
		if (!scenario) throw badRequest(`scenario must be one of ${Object.keys(sample.scenarios ?? {}).join(", ")}`);
		this.demoReset();
		this.deps.clockControl.set(scenarioClock(scenario, this.now()));
		this.onboard({ modules: sample.modules.map((m) => m.code), timetableSource: "sample", nudgesPerDay: scenario.nudgesPerDay ?? 1 });
		for (const id of scenario.missed ?? []) this.store.updateLecture(id, (l) => ({ ...l, attended: false }));
		if (scenario.lastActiveDaysAgo) {
			const then = addDays(this.now(), -scenario.lastActiveDaysAgo);
			const lecture = tryNowLecture({ lectures: this.store.lectures().filter((l) => isTimed(l) && new Date(l.end) <= then) }, then) ?? this.store.lectures()[0];
			if (lecture) {
				this.store.saveSession({
					id: this.id("s"), engine: "scripted", spec: specFor("post-lecture", lecture.id, DEFAULT_PREFS), budget: 5, answered: 5,
					createdAt: then.toISOString(), openedAt: then.toISOString(), endedAt: then.toISOString(), lastActivityAt: then.toISOString(), state: "done",
				});
			}
		}
		return { scenario: name, description: scenario.description, ...this.demoState() };
	}

	demoParticipant(raw: unknown) {
		const id = (raw as { participant?: unknown } | null)?.participant;
		if (id !== null && (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,32}$/.test(id))) throw badRequest("participant must be 1–32 letters, digits, - or _ (or null)");
		this.store.saveDemo({ participant: id ?? undefined });
		return this.demoState();
	}

	demoEngine(raw: unknown) {
		const engine = (raw as { engine?: unknown } | null)?.engine;
		if (engine !== null && !(ENGINE_NAMES as readonly unknown[]).includes(engine)) throw badRequest(`engine must be ${ENGINE_NAMES.join(" or ")} (or null for the default)`);
		this.store.saveDemo({ engineOverride: (engine as EngineName | null) ?? undefined });
		return this.demoState();
	}
}

/** Hard-link a file (one copy of a semester PDF on disk), copying where links aren't possible. */
function linkOrCopy(from: string, to: string) {
	try {
		fs.rmSync(/* turbopackIgnore: true */ to, { force: true });
		fs.linkSync(/* turbopackIgnore: true */ from, /* turbopackIgnore: true */ to);
	} catch {
		fs.copyFileSync(/* turbopackIgnore: true */ from, /* turbopackIgnore: true */ to);
	}
}

/** A calendar link for display: the host and the last path segment, never the private token in between (F-108). */
export function maskLink(url: string): string {
	try {
		const u = new URL(url);
		const last = u.pathname.split("/").filter(Boolean).at(-1) ?? "";
		return `${u.host}/…${last.length > 24 ? `${last.slice(0, 4)}…${last.slice(-8)}` : last ? `/${last}` : ""}`;
	} catch {
		return "your calendar link";
	}
}

/** An IANA zone the runtime knows ("Europe/London"), or null. */
function validTimeZone(z: unknown): string | null {
	if (typeof z !== "string" || !z || z.length > 64) return null;
	try {
		new Intl.DateTimeFormat("en-GB", { timeZone: z });
		return z;
	} catch {
		return null;
	}
}
