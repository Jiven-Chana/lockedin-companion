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
import { activeBlock, canStartBlock, lockDecision, resumableSession, validateBlocks } from "../../core/companion/blocks.ts";
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
	blockFocus,
} from "../../core/companion/nudges.ts";
import { buildOpeningMessage } from "../../core/companion/opening-message.ts";
import { buildLearnOpening, learnCovers, learnNodeRef, suggestForBlock, type LearnTopic } from "../../core/companion/learn.ts";
import { cleanPrefs, howFromOthers, howNote, owesHowCard, wordCount } from "../../core/companion/notes.ts";
import { PHONE_BLOCK_COPY, PHONE_RULES, PLAN_RULES, TODAY_COPY, SETUP_COPY, SETUP_RULES, BLOCK_RULES, GAP_COPY, GAP_RULES, LEARN_COPY, LEARN_RULES, LEARN_SAYS, NOTE_COPY, NOTE_RULES, PRACTISE_COPY, PRACTISE_RULES, RESUME_RULES, CALENDAR_RULES, DEFAULT_APPEARANCE, DEFAULT_PLAN, HANDOFF_COPY, NUDGE_TEXT, PLAN_COPY, DEFAULT_PREFS, FIRST_TASTE_LECTURE, KEEP_GOING_QUESTIONS, MATERIALS_RULES, MILESTONES, NUDGE_RULES, PACK_COPY, PLACEMENT_COPY, PREPARE_RULES, PROGRESS_COPY, SESSION_BUDGETS, SESSION_COPY } from "../../core/companion/policy.ts";
import { codeFromName, detectModules, MODULE_CODE_RE } from "../../core/companion/module-detect.ts";
import { CompanionAi, type AiPort, type KeyVerifier } from "./ai.ts";
import { CourseMaterials, unitPages, type UploadedFile } from "./materials.ts";
import { StudyPacks } from "./study-pack.ts";
import type { BankQuestion } from "../../core/companion/study-pack.ts";
import { SetupChat } from "./setup-chat.ts";
import { PhoneLink, RelayClient } from "./phone.ts";
import { blockWhy, clampBlockMinutes, freeTimes, moveTimes, openBlocks, pacedUnits, placementProblem, proposeWeek, replanWeek } from "../../core/companion/plan-week.ts";
import type { PhoneBlockLines, PhonePractisePool, PhoneWeek } from "../../core/companion/sync.ts";
import { buildRound, savedAfter, type RoundRef } from "../../core/companion/phone-round.ts";
import { closeGaps, gapsByIdea, GENERAL_IDEA, ideaKeyOfMiss, type RightAnswer } from "../../core/companion/gaps.ts";
import { ideaKeyOf, pickPractise, type IdeaStanding, type PractiseCandidate } from "../../core/companion/practise.ts";
import { fadingAt, moduleShares, replayScore, scoreAt, scoreSeries, termFor, type ModuleShare, type PackIdea, type QuestionInfo, type ScorePoint, type ScoreRange } from "../../core/companion/score.ts";
import { earnedMilestones, needsAttention, type AttentionLine } from "../../core/companion/milestones.ts";
import { scheduleWeek, type NudgeQuestion } from "../../core/companion/nudges.ts";
import { FEELINGS, lastWeekSummary, proposeTarget, type Feeling } from "../../core/companion/checkin.ts";
import { validateRoutine } from "../../core/companion/routine.ts";
import type { Generate } from "./generate.ts";
import { checkProposal, currentWeek, unitTooShort, weekOneStartFor, type ProposedUnit } from "../../core/companion/units.ts";
import { lecturesWithStatus, phoneToday, roadmap, searchLectures, tryNowLecture, weekSummary, welcomeBack } from "../../core/companion/progress.ts";
import { assembleSlidesMarkdown, parseSlideRefs, parseSlides, slideTitles, type SlidePage } from "../../core/companion/slides.ts";
import { nodeStatuses, splitNodeLabel, starterMap, type MapEvidence, type MapNode } from "../../core/companion/concept-map.ts";
import { parseMermaidPlan } from "../../agent/tools/mermaid-plan.ts";
import { addDays, addMinutes, atTime, dateKey, isoWeekday, isValidHM, sameDay, startOfWeek } from "../../core/companion/time.ts";
import { hideSampleTimetable, icsToLectures, isTimed, materializeSampleTimetable, mergeTimetable, parseIcs, readsSummary, scenarioClock, type TimedLecture } from "../../core/companion/timetable.ts";
import {
	CLIENT_EVENT_TYPES,
	COMPANION_EVENT_TYPES,
	MOTION_CHOICES,
	ENGINE_NAMES,
	NUDGE_ACTIONS,
	SESSION_KINDS,
	type AnswerInput,
	type CompanionEventType,
	type MotionChoice,
	type CompanionSession,
	type EngineName,
	type AnswerRecord,
	type Lecture,
	type NudgeAction,
	type NudgeCandidate,
	type NudgeRecord,
	type NudgeType,
	type Profile,
	type SessionKind,
	type SessionSpec,
	type StudyMode,
	type ModuleNotes,
	type ModuleNotesView,
	type LearnItem,
	type LearnScope,
	type SessionView,
	type StudyBlock,
	ENERGY_TIMES,
	WEEK_SHARES,
	type EnergyTime,
	type ModuleInfo,
	type Routine,
	type SetupEnd,
	type SetupView,
	type SetupWeek,
	type WeekShare,
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
	/** Test seam: the waits between a study pack's tries. */
	packSleep?: (ms: number, signal: AbortSignal) => Promise<void>;
	/** Draws one page of a PDF as a PNG (the engine's renderer); null when the page can't be drawn. */
	renderPdfPage?: (pdfPath: string, page: number) => Promise<Uint8Array | null>;
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
	/** Page pictures being drawn right now, so two requests for one page draw it once. */
	private readonly drawingPages = new Map<string, Promise<string>>();
	private aiReady = false;
	private packsResumed = false;
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
					...(deps.ai ? { connected: async () => (this.ai ? this.ai.ready() : true) } : {}),
					...(deps.packSleep ? { sleep: deps.packSleep } : {}),
				})
			: null;
		this.phone = deps.relay ? new PhoneLink(this, deps.store, new RelayClient(deps.relay.url, deps.relay.fetch)) : null;
		this.ai = deps.ai
			? new CompanionAi(deps.ai.port, deps.ai.verifyKey, (type, data) => this.log(type, data), (ready) => this.noteAiReady(ready))
			: null;
	}

	private noteAiReady(ready: boolean) {
		// Logged when the AI becomes ready, remembered across restarts: a restart with the AI still connected isn't news (X-1).
		if (this.deps.engineWhenAiReady && ready !== (this.store.runtime().aiReady ?? false)) {
			this.store.saveRuntime({ aiReady: ready });
			if (ready) this.log("engine_ready", { engine: this.deps.engineWhenAiReady });
		}
		this.aiReady = ready;
		if (ready && !this.packsResumed) {
			this.packsResumed = true;
			this.resumePacks();
		}
	}

	/**
	 * Once the student's AI is ready after a start: pick up the study packs
	 * that were queued or being written when the app last stopped, and write
	 * the ones for uploaded units that never got one (saved while the AI
	 * wasn't connected). Failed and cancelled packs wait for the student (V-23).
	 */
	resumePacks(): string[] {
		const packs = this.packs;
		if (!packs || !this.store.profile()) return [];
		const started: string[] = [];
		for (const unit of this.store.lectures()) {
			if (!unit.source || !unit.hasMaterials) continue;
			if (packs.interrupted(unit.id) || !packs.exists(unit.id)) {
				packs.start(unit.id);
				started.push(unit.id);
			}
		}
		return started;
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
			if (k === "motion" && !MOTION_CHOICES.includes(v as MotionChoice)) throw badRequest("appearance.motion must be calm, full or off");
			(appearance as Record<string, unknown>)[k] = v;
		}
		const next = { ...current, prefs, appearance };
		this.store.saveProfile(next);
		const changed = [
			...Object.keys(p).map((k) => `prefs.${k}`),
			...Object.keys(patch.appearance ?? {}).map((k) => `appearance.${k}`),
		];
		if (changed.length > 0) this.log("settings_changed", { changed, prefs: next.prefs });
		if (patch.appearance?.motion !== undefined && patch.appearance.motion !== current.appearance.motion) this.log("motion_changed", { from: current.appearance.motion, to: next.appearance.motion });
		return next;
	}

	/** `quiet`: the v0.1 flow calls this and logs its own onboarding_done (one per onboarding in the CSV). */
	onboard(input: OnboardingInput, opts: { quiet?: boolean } = {}) {
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
		if (!opts.quiet) this.log("onboarding_done", { modules: codes, source, nudgesPerDay, lectures: lectures.length });
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

		const base = this.onboard({ ...(kind === "sample" ? {} : { modules: modules!.map((m) => m.code) }), timetableSource: kind === "sample" ? "sample" : "ics", nudgesPerDay }, { quiet: true });
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
		// Back and forward (or a reload) on the modules screen must not prepare it again on the student's AI.
		const waiting = this.store.sessions().find(
			(s) => s.spec.kind === card.spec.kind && s.spec.lectureId === card.spec.lectureId && !s.openedAt && s.answered === 0 && (s.state === "preparing" || s.state === "ready"),
		);
		return { ...card, ...(waiting ? { sessionId: waiting.id } : this.createSession(card.spec)) };
	}


	// ─── the first run (v2.0 step 7; V-45, V-63 to V-66) ────────────────────

	/** Setup is still going: the timetable step made the profile and the end hasn't been reached. */
	private inSetup(profile: Profile | null | undefined): boolean {
		return !!profile?.setup && !profile.setup.doneAt;
	}

	/** Modules as typed or ticked: { name, code? }. A missing code is made from the name; names and codes already there are left out. */
	private newModules(raw: unknown, existing: readonly { code: string; name: string }[]): { code: string; name: string }[] {
		if (!Array.isArray(raw)) throw badRequest("modules must be a list");
		const taken = new Set(existing.map((m) => m.code));
		const names = new Set(existing.map((m) => m.name.toLowerCase()));
		const out: { code: string; name: string }[] = [];
		for (const item of raw) {
			const m = (item ?? {}) as { code?: unknown; name?: unknown };
			const name = typeof m.name === "string" ? m.name.trim() : "";
			if (!name || name.length > SETUP_RULES.moduleNameMax) throw badRequest(SETUP_COPY.moduleName);
			const given = typeof m.code === "string" && m.code.trim() ? m.code.trim().toUpperCase() : null;
			if (given ? taken.has(given) : names.has(name.toLowerCase())) continue;
			const code = given ?? codeFromName(name, taken);
			if (!MODULE_CODE_RE.test(code)) throw badRequest(`invalid module code ${code}`);
			taken.add(code);
			names.add(name.toLowerCase());
			out.push({ code, name });
		}
		if (existing.length + out.length > SETUP_RULES.maxModules) throw badRequest(SETUP_COPY.tooManyModules);
		return out;
	}

	/** Where setup is: the step to open on, and what each step has so far. */
	setup(): SetupView {
		const profile = this.store.profile();
		const phone = { available: this.phone !== null, paired: this.phone?.paired() ?? false };
		if (!profile) return { started: false, done: false, step: this.aiReady ? 2 : 1, phone, calendar: false, modules: [], week: null, end: null };
		const modules = profile.modules.map((m) => {
			const list = this.learnUnits(m.code).filter((u) => !isTimed(u));
			return {
				code: m.code,
				name: m.name,
				units: list.length,
				preparing: list.filter((u) => this.packs?.isRunning(u.id) || ["queued", "generating"].includes(this.packs?.status(u.id)?.state ?? "")).length,
				ready: list.filter((u) => this.packs?.status(u.id)?.state === "ready").length,
				list: list.map((u) => ({ id: u.id, title: u.title, week: u.week })),
			};
		});
		return {
			started: true,
			done: !this.inSetup(profile),
			step: profile.setup?.step ?? SETUP_RULES.steps,
			phone,
			calendar: profile.timetableSource === "ics",
			modules,
			week: profile.setup?.week ? this.setupWeekView(profile.setup.week, null) : null,
			end: this.setupEnd(),
		};
	}

	/**
	 * Setup step 2. Body: { calendar: { kind: "link", url } | { kind: "file", text } | { kind: "none" },
	 * modules: [{ name, code? }], timeZone? }. Makes the profile the first
	 * time, with no modules if the student chose "Later"; going back and
	 * forward adds what is new and keeps what was there.
	 */
	async setupTimetable(body: unknown): Promise<SetupView> {
		const b = (body ?? {}) as { modules?: unknown; calendar?: { kind?: unknown; url?: unknown; text?: unknown }; timeZone?: unknown };
		const existing = this.store.profile();
		if (existing && !this.inSetup(existing)) throw new CompanionError("already_set_up", 409, SETUP_COPY.already);
		const kind = b.calendar?.kind;
		if (kind !== "link" && kind !== "file" && kind !== "none") throw badRequest("calendar.kind must be link, file or none");
		const timeZone = validTimeZone(b.timeZone);
		const added = this.newModules(b.modules ?? [], existing?.modules ?? []);
		// Fetch before saving anything, so a bad link leaves no half-made profile.
		const link = kind === "link" ? await this.fetchCalendarLink(b.calendar?.url) : null;
		const fileText = kind === "file" ? (typeof b.calendar?.text === "string" ? b.calendar.text : null) : null;
		if (kind === "file" && fileText === null) throw badRequest("calendar.text is required for a file");

		const now = this.now();
		const ai = this.ai ? await this.ai.status().catch(() => null) : null;
		const base: Profile = existing ?? {
			createdAt: now.toISOString(),
			modules: [],
			timetableSource: "none",
			prefs: { ...DEFAULT_PREFS },
			appearance: { ...DEFAULT_APPEARANCE },
			ai: { provider: ai?.provider ?? null, ...(ai?.provider ? { connectedAt: now.toISOString() } : {}) },
		};
		if (!existing) this.store.saveLectures([]);
		this.store.saveProfile({ ...base, modules: [...base.modules, ...added], ...(timeZone ? { timeZone } : {}), setup: { ...base.setup, step: 3 } });
		let events: number | null = null;
		if (link) {
			events = this.importIcs(link.text).added;
			this.store.saveRuntime({ calendarUrl: link.url });
		} else if (fileText !== null) {
			events = this.importIcs(fileText).added;
		}
		for (const m of added) this.log("module_added", { module: m.code, via: "setup" });
		this.log("setup_timetable", { calendar: kind, modules: this.requireProfile().modules.map((m) => m.code), events, ai: ai?.provider ?? null });
		return this.setup();
	}

	/** The step the student has reached (2 to 5), so a closed tab reopens there. */
	setupStep(body: unknown): SetupView {
		const profile = this.requireProfile();
		const step = (body as { step?: unknown } | null)?.step;
		if (typeof step !== "number" || !Number.isInteger(step) || step < 2 || step > SETUP_RULES.steps) throw badRequest(`step must be 2 to ${SETUP_RULES.steps}`);
		if (this.inSetup(profile)) this.store.saveProfile({ ...profile, setup: { ...profile.setup, step } });
		return this.setup();
	}

	/** "+ Add a module" (V-64), in setup and in the Library: a name is enough. */
	addModule(body: unknown): { code: string; name: string } {
		const profile = this.requireProfile();
		const raw = (body as { name?: unknown } | null)?.name;
		const name = typeof raw === "string" ? raw.trim() : "";
		if (!name || name.length > SETUP_RULES.moduleNameMax) throw badRequest(SETUP_COPY.moduleName);
		const same = profile.modules.find((m) => m.name.toLowerCase() === name.toLowerCase());
		if (same) throw badRequest(SETUP_COPY.moduleExists(same.name));
		const [mod] = this.newModules([{ name }], profile.modules);
		this.store.saveProfile({ ...profile, modules: [...profile.modules, mod!] });
		this.log("module_added", { module: mod!.code, via: this.inSetup(profile) ? "setup" : "library" });
		return mod!;
	}

	/** A module's share of the week (V-63). Body: { share: "less" | "normal" | "more" }. */
	setModuleShare(code: string, body: unknown) {
		const profile = this.requireProfile();
		const mod = this.requireModule(code);
		const share = (body as { share?: unknown } | null)?.share;
		if (!(WEEK_SHARES as readonly unknown[]).includes(share)) throw badRequest(`share must be one of ${WEEK_SHARES.join(", ")}`);
		const { share: was, ...rest } = mod;
		const next: ModuleInfo = share === "normal" ? rest : { ...rest, share: share as "less" | "more" };
		this.store.saveProfile({ ...profile, modules: profile.modules.map((m) => (m.code === code ? next : m)) });
		this.log("module_share_changed", { module: code, from: was ?? "normal", to: share });
		return { ...next, share: share as WeekShare };
	}

	/**
	 * Setup's slides step (V-66): read the files, split them and save every
	 * unit worth studying straight away. The checklist is not shown; titles
	 * and weeks can be changed afterwards.
	 */
	async quickMaterials(code: string, files: UploadedFile[]): Promise<{ units: Lecture[]; skipped: number }> {
		const p = await this.proposeMaterials(code, files);
		const all = p.files.flatMap((f) => f.units.map((u) => ({ file: f.file, title: u.title, week: u.week, pages: u.pages, chars: u.chars })));
		const units = all.filter((u) => u.chars >= MATERIALS_RULES.minUnitChars).map(({ chars: _chars, ...u }) => u);
		if (units.length === 0) {
			this.courseMaterials.discard(p.uploadId);
			throw badRequest(SETUP_COPY.nothingToStudy);
		}
		return { units: this.saveMaterials(code, { uploadId: p.uploadId, units }).units, skipped: all.length - units.length };
	}

	/** A new title for a course unit made from the student's material. Body: { title }. */
	renameUnit(lectureId: string, body: unknown): Lecture {
		assertSafeId(lectureId, "lecture id");
		const unit = this.store.lectures().find((l) => l.id === lectureId);
		if (!unit) throw notFound("lecture");
		if (isTimed(unit)) throw badRequest("a timetabled lecture's title comes from your calendar");
		const raw = (body as { title?: unknown } | null)?.title;
		const title = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
		if (!title || title.length > SETUP_RULES.unitTitleMax) throw badRequest(`a title of 1 to ${SETUP_RULES.unitTitleMax} characters`);
		const updated = this.store.updateLecture(lectureId, (l) => ({ ...l, title }))!;
		this.log("unit_renamed", { lectureId, module: unit.module });
		return updated;
	}

	private setupWeekView(week: string, message: string | null): SetupWeek {
		const profile = this.requireProfile();
		const plan = this.plan(week);
		return {
			energy: [...(profile.routine?.energy ?? [])],
			target: plan.target ?? SETUP_RULES.defaultTargetMinutes,
			week: plan.week,
			blocks: plan.blocks.filter((x) => x.status === "proposed" || x.status === "accepted").map((x) => ({ id: x.id, date: x.date, start: x.start, minutes: x.minutes, module: x.module, title: x.focus?.title ?? null, why: x.why })),
			message,
		};
	}

	/**
	 * Setup's week step (V-45): "When do you have energy?" and one total for
	 * the week (V-63). Body: { energy?: ["morning" | "afternoon" | "evening"],
	 * weeklyTargetMinutes? }; what isn't sent stays as it was, and the total
	 * starts at five hours. Each call suggests the week again, so the blocks
	 * move as the student taps. With no room left this week it plans the next.
	 */
	setupWeek(body: unknown): SetupWeek {
		const profile = this.requireProfile();
		const b = (body ?? {}) as { energy?: unknown; weeklyTargetMinutes?: unknown };
		const settings = this.planSettings();
		let energy: EnergyTime[] = [...(profile.routine?.energy ?? [])];
		if (b.energy !== undefined) {
			const given = b.energy;
			if (!Array.isArray(given) || !given.every((e) => (ENERGY_TIMES as readonly unknown[]).includes(e))) throw badRequest(`energy must be a list of ${ENERGY_TIMES.join(", ")}`);
			energy = ENERGY_TIMES.filter((e) => given.includes(e));
		}
		let target = settings.weeklyTargetMinutes ?? SETUP_RULES.defaultTargetMinutes;
		if (b.weeklyTargetMinutes !== undefined) {
			const t = b.weeklyTargetMinutes;
			if (typeof t !== "number" || !Number.isInteger(t) || t < 30 || t > 40 * 60) throw badRequest("weeklyTargetMinutes must be 30 minutes to 40 hours");
			target = t;
		}
		const now = this.now();
		const routine: Routine = { commitments: [], places: [], preferredBlockMinutes: settings.blockMinutes, ...profile.routine, energy, weeklyTargetMinutes: target, confirmedAt: now.toISOString() };
		this.store.saveProfile({ ...profile, routine, plan: { ...settings, weeklyTargetMinutes: target } });
		if (target !== settings.weeklyTargetMinutes) this.log("target_changed", { from: settings.weeklyTargetMinutes, to: target, via: "setup" });

		const suggested = (p: { blocks: { status: string }[] }) => p.blocks.some((x) => x.status === "proposed" || x.status === "accepted" || x.status === "started");
		let plan = this.proposePlan({});
		if (!suggested(plan)) plan = this.proposePlan({ week: dateKey(addDays(this.mondayOf(now), 7)) });
		const latest = this.requireProfile();
		if (latest.setup) this.store.saveProfile({ ...latest, setup: { ...latest.setup, week: plan.week } });
		const view = this.setupWeekView(plan.week, plan.message);
		this.log("setup_week", { energy, target, week: plan.week, blocks: view.blocks.length });
		return view;
	}

	/**
	 * "Later" on setup's week step: the total and the suggested blocks go, as
	 * if the step had not been opened. A target is only ever set by the
	 * student (V-5). Blocks already kept with "Looks good" are theirs and stay.
	 */
	skipSetupWeek(): SetupView {
		const profile = this.requireProfile();
		const week = profile.setup?.week;
		if (!this.inSetup(profile) || !week) return this.setup();
		const end = dateKey(addDays(new Date(`${week}T12:00:00`), 6));
		const blocks = this.store.blocks();
		const inWeek = (x: StudyBlock) => x.date >= week && x.date <= end;
		const { week: _week, ...setup } = profile.setup!;
		if (blocks.some((x) => inWeek(x) && (x.status === "accepted" || x.status === "started"))) {
			this.store.saveProfile({ ...profile, setup });
			return this.setup();
		}
		this.store.saveBlocks(blocks.filter((x) => !(inWeek(x) && x.status === "proposed" && x.source === "planner")));
		const { routine: _routine, ...rest } = profile;
		this.store.saveProfile({ ...rest, plan: { ...this.planSettings(), weeklyTargetMinutes: null }, setup });
		this.log("setup_week", { skipped: true });
		return this.setup();
	}

	/** Where setup ends: the first unit in keep-up order, from the student's own slides. */
	private setupEnd(): SetupEnd | null {
		const profile = this.store.profile();
		if (!profile) return null;
		const units = lecturesWithStatus(this.store.state()).filter((l) => l.hasMaterials && l.kind !== "event");
		const first = pacedUnits({ modules: profile.modules, units, now: this.now(), blocks: 1 })[0]?.lectureId ?? profile.modules.flatMap((m) => this.learnUnits(m.code))[0]?.id;
		const unit = first ? this.lectureById(first) : undefined;
		return unit ? { lectureId: unit.id, module: unit.module, title: unit.title } : null;
	}

	/** The end of setup, reached once. Later steps left for "Later" stay where they always were: Me, the Library, Week. */
	setupDone(): SetupView {
		const profile = this.requireProfile();
		if (this.inSetup(profile)) {
			this.store.saveProfile({ ...profile, setup: { ...profile.setup!, doneAt: this.now().toISOString() } });
			const s = this.setup();
			this.log("onboarding_done", {
				flow: "v2.0",
				calendar: s.calendar,
				modules: profile.modules.map((m) => m.code),
				units: s.modules.reduce((n, m) => n + m.units, 0),
				target: profile.plan?.weeklyTargetMinutes ?? null,
				energy: profile.routine?.energy ?? [],
				blocks: this.store.blocks().filter((x) => x.status === "accepted").length,
				phone: s.phone.paired,
				ai: profile.ai?.provider ?? null,
			});
		}
		return this.setup();
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
		this.log("materials_uploaded", { module: code, uploadId: r.uploadId, files: r.files.map((f) => ({ kind: f.kind, pages: f.pageCount, noText: f.noText.length })) });
		this.log("materials_proposed", { module: code, uploadId: r.uploadId, files: r.files.map((f) => ({ units: f.units.length, weeks: f.units.map((u) => u.week), via: f.via })) });
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
			const short = units.find((u) => unitTooShort(unitPages(f.pages), u.pages, MATERIALS_RULES.minUnitChars));
			if (short) throw badRequest(`${short.title || f.name}: ${PACK_COPY.tooShort}`);
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
		// The student's own material has arrived: the sample timetable gives way to it (V-26).
		const profile = this.requireProfile();
		const kept = profile.timetableSource === "sample" ? hideSampleTimetable(all) : { lectures: all, hidden: 0 };
		this.store.saveLectures([...kept.lectures, ...created]);
		if (profile.timetableSource === "sample") {
			const { timetableRead: _read, ...rest } = profile;
			this.store.saveProfile({ ...rest, timetableSource: "none" });
			this.log("sample_hidden", { lectures: kept.hidden, via: "materials", module: code });
		}
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

	/** "Set week" on a course unit whose material didn't say (V-25). Body: { week: 1–52 }. */
	setUnitWeek(lectureId: string, body: unknown): Lecture {
		assertSafeId(lectureId, "lecture id");
		const unit = this.store.lectures().find((l) => l.id === lectureId);
		if (!unit) throw notFound("lecture");
		if (isTimed(unit)) throw badRequest("a timetabled lecture's week comes from your calendar");
		const week = (body as { week?: unknown } | null)?.week;
		if (!Number.isInteger(week) || (week as number) < 1 || (week as number) > 52) throw badRequest("week must be 1 to 52");
		const updated = this.store.updateLecture(lectureId, (l) => ({ ...l, week: week as number }))!;
		this.log("unit_week_set", { lectureId, module: unit.module, from: unit.week, to: week });
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
		if (profile.timetableSource === "sample" && merged.archived > 0) this.log("sample_hidden", { lectures: merged.archived, via: "calendar" });
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
		return { slides: md ? parseSlides(md) : [], hasPdf: this.content.pdfPath(lectureId) !== null };
	}

	/**
	 * The picture of one page of a unit's own PDF, for the slide panel (V-21):
	 * drawn once, then kept beside the unit's material. Returns the PNG's path.
	 */
	async slidePage(lectureId: string, page: number): Promise<string> {
		assertSafeId(lectureId, "lecture id");
		if (!Number.isInteger(page) || page < 1) throw badRequest("the page must be a whole number from 1");
		const missing = () => new CompanionError("page_not_found", 404, "There is no picture of that page.");
		const pdf = this.content.pdfPath(lectureId);
		const md = pdf ? this.content.slidesMarkdown(lectureId) : null;
		if (!pdf || !md || !parseSlides(md).some((sl) => sl.number === page)) throw missing();
		const file = path.join(/* turbopackIgnore: true */ this.content.pagesDir(lectureId), `${page}.png`);
		if (fs.existsSync(/* turbopackIgnore: true */ file)) return file;
		if (!this.deps.renderPdfPage) throw new CompanionError("pdf_unavailable", 501, "Page pictures are not available here.");
		const key = `${lectureId}:${page}`;
		let drawing = this.drawingPages.get(key);
		if (!drawing) {
			const render = this.deps.renderPdfPage;
			drawing = (async () => {
				const png = await render(pdf, page);
				if (!png) throw missing();
				fs.mkdirSync(/* turbopackIgnore: true */ path.dirname(file), { recursive: true });
				// Written under another name first, so a half-written picture is never served.
				fs.writeFileSync(/* turbopackIgnore: true */ `${file}.part`, png);
				fs.renameSync(/* turbopackIgnore: true */ `${file}.part`, /* turbopackIgnore: true */ file);
				return file;
			})().finally(() => this.drawingPages.delete(key));
			this.drawingPages.set(key, drawing);
		}
		return drawing;
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
		// A copy: the reader uses up the bytes it is given, and the file itself is kept below (S-2).
		const pages = await this.deps.convertPdf(pdf.slice());
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
		// "Re-plan the rest of my week" (v2.2): which kept blocks have passed unstarted, and which the last re-plan moved.
		const open = new Set(openBlocks(this.store.blocks(), this.now()).map((b) => b.id));
		const replanned = new Set((this.replanRecord()?.moves ?? []).map((m) => m.id));
		return {
			week: from,
			target: settings.weeklyTargetMinutes,
			blockMinutes: settings.blockMinutes,
			committedMinutes: committed,
			proposedMinutes: blocks.filter((b) => b.status === "proposed").reduce((n, b) => n + b.minutes, 0),
			// A block's module: the student's choice, else its unit's (blocks planned before v1.1 only had the unit).
			blocks: blocks.map((b) => {
				const focus = b.lectureId ? (titles.get(b.lectureId) ?? null) : null;
				const first = this.firstStepOf(b);
				// What the timetable shows on a block (V-44): its first step, and whether it can be started now.
				return { ...b, focus, module: b.module ?? focus?.module ?? null, firstStep: first ? PLAN_COPY.firstStep(first.slide) : null, canStart: canStartBlock(b, this.now()), mode: this.blockButtons(b), why: blockWhy(b, profile.modules), notStarted: open.has(b.id), moved: replanned.has(b.id) };
			}),
			replan: { open: open.size, moved: replanned.size, canUndo: replanned.size > 0 },
			lectures,
			commitments: profile.routine?.commitments ?? [],
			// For the timetable (V-37): where a block may not go, and the modules a block can be given.
			quietHours: profile.prefs.quietHours,
			modules: profile.modules.map((m) => ({ code: m.code, name: m.name, hasMaterial: this.store.lectures().some((l) => l.module === m.code && l.hasMaterials) })),
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

	/**
	 * The last re-plan, while its Undo still means something: on the day it
	 * was made, with every block it moved still kept and still where it put it.
	 */
	private replanRecord() {
		const rec = this.store.runtime().replan;
		if (!rec || dateKey(new Date(rec.at)) !== dateKey(this.now())) return null;
		const blocks = new Map(this.store.blocks().map((b) => [b.id, b]));
		const intact = rec.moves.every((m) => {
			const b = blocks.get(m.id);
			return b?.status === "accepted" && b.date === m.to.date && b.start === m.to.start;
		});
		return intact ? rec : null;
	}

	/**
	 * "Re-plan the rest of my week" (v2.2): kept blocks whose time has passed
	 * without being started move to free times in the days left. Only ever
	 * run when the student presses the button; nothing is called missed (R-6).
	 */
	replanWeek() {
		const profile = this.requireProfile();
		const now = this.now();
		const blocks = this.store.blocks();
		const r = replanWeek({ now, lectures: this.store.lectures(), ...(profile.routine ? { routine: profile.routine } : {}), quietHours: profile.prefs.quietHours, blocks });
		if (r.moves.length > 0) {
			const to = new Map(r.moves.map((m) => [m.id, m]));
			const moves = blocks.filter((b) => to.has(b.id)).map((b) => ({ id: b.id, from: { date: b.date, start: b.start, ...(b.placed ? { placed: b.placed } : {}) }, to: { date: to.get(b.id)!.date, start: to.get(b.id)!.start } }));
			this.store.saveBlocks(blocks.map((b) => {
				const m = to.get(b.id);
				if (!m) return b;
				const next: StudyBlock = { ...b, date: m.date, start: m.start };
				delete next.placed; // where it is now is not where the planner first put it, so its old reason is no longer true
				return next;
			}));
			this.store.saveRuntime({ replan: { at: now.toISOString(), moves } });
		}
		this.log("plan_replanned", { moved: r.moves.length, nextWeek: r.nextWeek, left: r.left.length });
		const message = r.moves.length > 0 ? `${PLAN_COPY.replan.done(r.moves.length, r.nextWeek)}${r.left.length > 0 ? ` ${PLAN_COPY.replan.noRoom}` : ""}` : r.left.length > 0 ? PLAN_COPY.replan.noRoom : null;
		return { ...this.plan(), message };
	}

	/** One Undo for the whole re-plan: every block goes back to where it was, with the reason it had. */
	undoReplan() {
		const rec = this.replanRecord();
		if (!rec) throw new CompanionError("nothing_to_undo", 409, "There is no re-plan to undo.");
		const from = new Map(rec.moves.map((m) => [m.id, m.from]));
		this.store.saveBlocks(this.store.blocks().map((b) => {
			const f = from.get(b.id);
			return f ? { ...b, date: f.date, start: f.start, ...(f.placed ? { placed: f.placed } : {}) } : b;
		}));
		this.store.saveRuntime({ replan: undefined });
		this.log("plan_replan_undone", { moved: rec.moves.length });
		return { ...this.plan(), message: PLAN_COPY.replan.undone };
	}

	/** Tick, move, start or remove one block (one action each, F-110). A move keeps its focus and first task. */
	updateBlock(blockId: string, patch: unknown) {
		const p = (patch ?? {}) as { status?: unknown; date?: unknown; start?: unknown; minutes?: unknown; source?: unknown; module?: unknown };
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
			// A block starts on its own day (V-44); starting it twice is harmless.
			if (p.status === "started" && block.status !== "started" && !canStartBlock(block, this.now())) throw new CompanionError("block_not_today", 409, PLAN_COPY.notToday);
			next.status = p.status;
			if (p.status === "started" && block.status !== "started") next.startedAt = this.now().toISOString();
		}
		if (p.module !== undefined) {
			// The block's module (V-37): one of the student's, or null for free study. It then studies that module's next unit.
			if (p.module !== null && (typeof p.module !== "string" || !this.requireProfile().modules.some((m) => m.code === p.module))) throw badRequest("module must be one of your modules, or null for free study");
			if (p.module === null) {
				delete next.module;
				delete next.lectureId;
				delete next.firstTaskQuestionId;
				delete next.reason;
			} else if (p.module !== (block.module ?? (block.lectureId ? this.lectureById(block.lectureId)?.module : undefined))) {
				const profile = this.requireProfile();
				const units = lecturesWithStatus(this.store.state()).filter((l) => l.module === p.module && l.hasMaterials);
				const unit = pacedUnits({ modules: profile.modules.filter((m) => m.code === p.module), units, now: this.now(), blocks: 1 })[0]?.lectureId ?? units[0]?.id;
				next.module = p.module;
				delete next.reason;
				if (unit) {
					next.lectureId = unit;
					const first = this.packs?.bank(unit)?.[0]?.id;
					if (first) next.firstTaskQuestionId = first;
					else delete next.firstTaskQuestionId;
				} else {
					delete next.lectureId;
					delete next.firstTaskQuestionId;
				}
			}
		}
		if (moved || p.minutes !== undefined) {
			// A block can't be put on top of a lecture, a commitment, another block or quiet hours, by any route (V-37).
			const profile = this.requireProfile();
			const problem = placementProblem({ block: next, lectures: this.store.lectures(), commitments: profile.routine?.commitments ?? [], blocks, quietHours: profile.prefs.quietHours });
			if (problem) throw new CompanionError("block_overlaps", 409, PLACEMENT_COPY[problem], { problem });
		}
		if (moved && next.status === "proposed") next.status = "accepted"; // moving a proposal is choosing it
		if (moved) delete next.placed; // where it is now is the student's choice, not the planner's reason
		const source = p.source === "phone" ? "phone" : undefined;
		this.store.saveBlocks(blocks.map((b) => (b.id === blockId ? next : b)));
		const data = { blockId, date: next.date, start: next.start, minutes: next.minutes, lectureId: next.lectureId ?? null, module: next.module ?? null, ...(source ? { source } : {}) };
		if (moved) this.log("plan_moved", { ...data, from: `${block.date} ${block.start}` });
		if (p.module !== undefined && (next.module ?? null) !== (block.module ?? null)) this.log("plan_module_set", { ...data, from: block.module ?? null });
		if (p.status === "accepted" && block.status !== "accepted") this.log("plan_accepted", data);
		if (p.status === "removed") this.log("plan_removed", data);
		if (p.status === "started" && block.status !== "started") this.log("block_started", { ...data, via: "plan" });
		return next;
	}

	/** A block's tiny first step (S-67, V-44): its first question and the slide it comes from. */
	private firstStepOf(block: Pick<StudyBlock, "lectureId" | "firstTaskQuestionId">): { questionId: string; stem: string; slide: number | null } | null {
		if (!block.lectureId || !block.firstTaskQuestionId) return null;
		const q = this.packs?.bank(block.lectureId)?.find((x) => x.id === block.firstTaskQuestionId);
		return q ? { questionId: q.id, stem: q.stem, slide: q.slides[0] ?? null } : null;
	}

	/**
	 * What the phone shows for a block (v2.1 part B; lo-fi task 2): its goal,
	 * its first step, why it is where it is, and where "Not now" can move it.
	 */
	phoneBlock(block: StudyBlock): PhoneBlockLines & { unit: string | null; slide: number | null } {
		const profile = this.requireProfile();
		const mode = this.blockMode(block);
		const unit = mode ? (this.lectureById(mode.focus)?.title ?? null) : null;
		const slide = this.firstStepOf(block)?.slide ?? null;
		const learn = mode?.study === "learn";
		const budget = SESSION_BUDGETS.block;
		return {
			unit,
			slide,
			goal: learn && unit ? PHONE_BLOCK_COPY.goalLearn(unit, block.minutes) : PHONE_BLOCK_COPY.goalPractise(budget.questions, budget.minutes),
			firstStep: !unit ? null : learn ? PHONE_BLOCK_COPY.firstStepLearn(unit) : PHONE_BLOCK_COPY.firstStep(slide),
			onLaptop: !unit ? null : learn ? PHONE_BLOCK_COPY.onLaptopLearn(unit) : PHONE_BLOCK_COPY.onLaptop(unit, slide),
			why: blockWhy(block, profile.modules),
			moves: moveTimes({ block, now: this.now(), lectures: this.store.lectures(), ...(profile.routine ? { routine: profile.routine } : {}), quietHours: profile.prefs.quietHours, blocks: this.store.blocks().filter((b) => b.status !== "removed") })
				.map((m) => ({ ...m, label: PLAN_COPY.moveLabel(m.kind, m.start) })),
		};
	}

	/**
	 * "Practise" on the phone's home screen (v2.3 part B): for each module
	 * with question banks, the questions the laptop's own Practise would ask
	 * next (mixed across ideas, weighted to gaps, least asked first), so the
	 * phone can ask them with the laptop closed. Chosen again at every upload.
	 */
	phonePractise(): PhonePractisePool[] {
		const profile = this.requireProfile();
		return profile.modules.flatMap((m) => {
			const questions = this.practisePicks(m.code, PHONE_RULES.practisePool, new Set()).flatMap((p) => {
				const q = this.packs?.bank(p.lectureId)?.find((x) => x.id === p.questionId);
				return q ? [this.asNudgeQuestion(p.lectureId, q)] : [];
			});
			return questions.length > 0 ? [{ module: m.code, name: m.name, questions }] : [];
		});
	}

	/**
	 * "On the move" (v2.2 part C; lo-fi task 2, version A): the block's unit's
	 * bank questions the phone can ask with the laptop closed, the first
	 * step's question first. The same rule as "Keep going here" (V-46): the
	 * phone has no AI, so the bank is what it asks. Empty with no bank.
	 */
	phoneBlockRound(block: StudyBlock): NudgeQuestion[] {
		const focus = this.blockMode(block)?.focus;
		const bank = focus ? (this.packs?.bank(focus) ?? []) : [];
		const first = bank.findIndex((q) => q.id === block.firstTaskQuestionId);
		const ordered = first > 0 ? [...bank.slice(first), ...bank.slice(0, first)] : bank;
		return ordered.slice(0, PHONE_RULES.roundSize).map((q) => this.asNudgeQuestion(focus!, q));
	}

	/**
	 * The week on the phone (v2.1 part C; lo-fi task 3): the lectures shown
	 * between the blocks, one free time for each day ahead ("Move to a free
	 * gap", "Add a block") and the nudges setting.
	 */
	phoneWeek(): PhoneWeek {
		const profile = this.requireProfile();
		const now = this.now();
		const from = dateKey(now);
		const to = dateKey(addDays(now, PLAN_RULES.moveDays));
		const hm = (iso: string) => {
			const d = new Date(iso);
			return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
		};
		const settings = this.planSettings();
		return {
			lectures: this.store.lectures()
				.filter((l) => l.start && dateKey(new Date(l.start)) >= from && dateKey(new Date(l.start)) <= to)
				.sort((a, b) => a.start!.localeCompare(b.start!))
				.map((l) => ({ date: dateKey(new Date(l.start!)), start: hm(l.start!), title: (l.kind ?? "lecture") === "lecture" ? PLAN_COPY.lectureRow(profile.modules.find((m) => m.code === l.module)?.name ?? l.module) : l.title })),
			free: freeTimes({ now, lectures: this.store.lectures(), ...(profile.routine ? { routine: profile.routine } : {}), quietHours: profile.prefs.quietHours, blocks: this.store.blocks(), minutes: settings.blockMinutes }),
			nudgesPerDay: profile.prefs.nudgesPerDay,
			blockMinutes: clampBlockMinutes(settings.blockMinutes),
		};
	}

	/**
	 * "Add a block" on the phone (v2.1 part C). The phone chose a free time the
	 * laptop offered, but the laptop decides: a time that is no longer free is
	 * not made, and the log says why. Once per block id.
	 */
	addBlockFromPhone(raw: { blockId: unknown; date: unknown; start: unknown; minutes?: unknown }): StudyBlock | null {
		const profile = this.requireProfile();
		const { blockId, date, start } = raw;
		if (typeof blockId !== "string" || !/^[\w-]{6,40}$/.test(blockId) || typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !isValidHM(start)) return null;
		const blocks = this.store.blocks();
		if (blocks.some((b) => b.id === blockId)) return null;
		const block: StudyBlock = { id: blockId, date, start: start as string, minutes: clampBlockMinutes(typeof raw.minutes === "number" ? raw.minutes : this.planSettings().blockMinutes), status: "accepted", source: "phone" };
		const problem = placementProblem({ block, lectures: this.store.lectures(), commitments: profile.routine?.commitments ?? [], blocks, quietHours: profile.prefs.quietHours });
		if (problem) {
			this.log("relay_error", { where: "plan add", blockId, reason: PLACEMENT_COPY[problem] });
			return null;
		}
		this.store.saveBlocks([...blocks, block]);
		this.log("plan_accepted", { blockId, date, start, minutes: block.minutes, lectureId: null, source: "phone", added: true });
		return block;
	}

	/** "Take the first step" on the phone: the block is started, as its Start button would (V-44). */
	phoneStartedBlock(blockId: string) {
		this.markBlockStarted(blockId, "nudge");
	}

	/**
	 * "Open on my laptop" from a block on the phone (lo-fi task 2): its session
	 * is opened here and a card says so. Once per phone event.
	 */
	openBlockFromPhone(blockId: string, phoneEventId: string): { sessionId: string } | null {
		const key = `handoff:${phoneEventId}`;
		if (this.store.nudges().some((n) => n.key === key)) return null;
		const block = this.store.blocks().find((b) => b.id === blockId && b.status !== "removed");
		if (!block) return null;
		const started = this.markBlockStarted(blockId, "nudge") ?? block;
		const sessionId = this.openBlock(started);
		if (!sessionId) return null;
		const lines = this.phoneBlock(started);
		this.store.appendNudge({ id: this.id("n"), type: "block", key, firedAt: this.now().toISOString(), title: HANDOFF_COPY.title, text: PHONE_BLOCK_COPY.open(lines.unit ?? "Your block", lines.slide, lines.goal), ...(started.lectureId ? { lectureId: started.lectureId } : {}), sessionId, why: "you asked on your phone" });
		return { sessionId };
	}

	/** Mark a block started, once. `via` says how: the Start button, or its notification. */
	private markBlockStarted(blockId: string, via: "start" | "nudge"): StudyBlock | null {
		const blocks = this.store.blocks();
		const block = blocks.find((b) => b.id === blockId);
		if (!block || block.status === "started" || !canStartBlock(block, this.now())) return block ?? null;
		const next: StudyBlock = { ...block, status: "started", startedAt: this.now().toISOString() };
		this.store.saveBlocks(blocks.map((b) => (b.id === blockId ? next : b)));
		this.log("block_started", { blockId, date: next.date, start: next.start, minutes: next.minutes, lectureId: next.lectureId ?? null, module: next.module ?? null, via });
		return next;
	}

	/**
	 * Start a study block from the laptop (V-44): marks it started and opens
	 * its session. A block that is already started just opens a session again.
	 */
	startBlock(blockId: string, raw?: unknown): { block: StudyBlock; sessionId: string | null } {
		const block = this.store.blocks().find((b) => b.id === blockId && b.status !== "removed");
		if (!block) throw notFound("block");
		if (block.status !== "started" && !canStartBlock(block, this.now())) throw new CompanionError("block_not_today", 409, PLAN_COPY.notToday);
		const study = (raw as { study?: unknown } | null | undefined)?.study;
		if (study !== undefined && study !== "learn" && study !== "practise") throw badRequest("study must be learn or practise");
		const started = this.markBlockStarted(blockId, "start") ?? block;
		return { block: started, sessionId: this.openBlock(started, study) };
	}

	/**
	 * What a block opens (step 5): Learn while its lecture is part-way through
	 * or not learned yet, Practise once it has been. The other mode is offered
	 * beside it (AFF-N: the mode is the student's choice each visit).
	 */
	private blockMode(block: StudyBlock) {
		const focus = blockFocus({ lectures: this.store.lectures() }, block, this.now());
		if (!focus) return null;
		const canLearn = (this.store.demo().engineOverride ?? this.defaultEngine()) === "learnharness" && !!this.lectureById(focus)?.hasMaterials;
		const suggestion = suggestForBlock({ lectureId: focus, sessions: this.store.sessions(), now: this.now(), canLearn, canPractise: this.safeHasScripted(focus) });
		return { focus, ...suggestion };
	}

	/** The block's two buttons, as Week and Today show them. */
	private blockButtons(block: StudyBlock): { study: StudyMode; label: string; other: { study: StudyMode; label: string } | null } | null {
		const mode = this.blockMode(block);
		if (!mode) return null;
		return { study: mode.study, label: LEARN_COPY.blockMode(mode.study, mode.why), other: mode.other ? { study: mode.other, label: LEARN_COPY.instead(mode.other) } : null };
	}

	/** Open a block's session in the suggested mode, or the one the student chose. Null when the block has nothing to study yet. */
	private openBlock(block: StudyBlock, chosen?: StudyMode, nudgeKey?: string): string | null {
		const mode = this.blockMode(block);
		if (!mode) return null;
		const study = chosen ?? mode.study;
		const first = this.firstStepOf(block);
		if (study === "learn") {
			// Part-way through this lecture: the block picks it up, with this block's time.
			if (mode.resume && this.store.session(mode.resume)) {
				this.store.updateSession(mode.resume, (s) => (s.spec.learn ? { ...s, spec: { ...s.spec, learn: { ...s.spec.learn, minutes: block.minutes } } } : s));
				return mode.resume;
			}
			return this.startLearn({ lectureId: mode.focus }, { minutes: block.minutes, kind: "block", ...(first ? { firstQuestionId: first.questionId } : {}), ...(nudgeKey ? { nudgeKey } : {}) }).sessionId;
		}
		const spec: SessionSpec = { ...specFor("block", mode.focus, this.store.profile()?.prefs), ...(first ? { firstQuestionId: first.questionId } : {}), study: "practise" };
		return this.createSession(spec, nudgeKey ? { nudgeKey } : {}).sessionId;
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
	/** `via`: where the change came from. A target confirmed in the Sunday check-in is that, not a settings change (X-1). */
	updatePlanSettings(body: unknown, via: "settings" | "checkin" = "settings") {
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
		if (next.weeklyTargetMinutes !== cur.weeklyTargetMinutes) this.log("target_changed", { from: cur.weeklyTargetMinutes, to: next.weeklyTargetMinutes, via });
		if (via === "settings") this.log("settings_changed", { changed: Object.keys(b).map((k) => `plan.${k}`) });
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
		// Reading the check-in to answer it isn't showing it again (X-1).
		const c = this.checkin({ quiet: true });
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
			this.updatePlanSettings({ weeklyTargetMinutes: b.target }, "checkin");
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
	/**
	 * A question for "Send a test question to my phone": from the student's own
	 * study packs, and one not sent as a test before while there is one.
	 */
	testQuestion(): NudgeQuestion | undefined {
		const sent = new Set(this.store.runtime().phoneTestQuestions ?? []);
		const units = this.store.lectures().filter((l) => l.hasMaterials && (this.packs?.bank(l.id)?.length ?? 0) > 0);
		const fresh = units.map((u) => this.packs!.bank(u.id)!.find((q) => !sent.has(q.id))).find((q) => q);
		const unit = fresh ? units.find((u) => this.packs!.bank(u.id)!.some((q) => q.id === fresh.id))! : units[0];
		return unit ? this.questionFor(unit.id, sent) : undefined;
	}

	phoneHandledNudge(key: string, outcome: "opened" | "snoozed" | "dismissed", at: string) {
		// A test question isn't one of the day's nudges: it never counts toward the cap.
		if (key.startsWith("test:")) return;
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
		// An answer on the phone is an answer (v2.3 part D): its unit is no longer "not started".
		if (this.lectureById(a.lectureId)) this.store.addPhoneAnswered(a.lectureId);
		const q = this.packs?.bank(a.lectureId)?.find((x) => x.id === a.questionId);
		if (!q || a.correct) return;
		const record: AnswerRecord = { questionId: q.id, questionText: q.stem, nodeId: q.node, graded: true, correct: false, dontKnow: false, shown: false, correctLabels: [q.options[q.correct]], explanation: q.explanation, answeredAt: a.at };
		const miss = missFromAnswer(record, { sessionId: "phone", lectureId: a.lectureId, now: new Date(a.at) });
		if (miss) this.store.saveMisses(mergeMisses(this.store.misses(), [miss]));
	}

	/**
	 * "N more on your laptop" after any number of answers on the phone (v2.1,
	 * V-46): the laptop opens the same round, with every phone answer already
	 * on the record, at the next question.
	 */
	private handoffRound(h: { lectureId: string; round: RoundRef[]; answers: { questionId: string; choice: number; correct: boolean }[]; at: string }, key: string) {
		const picks = h.round.filter((r) => this.packs?.bank(r.lectureId)?.some((q) => q.id === r.questionId));
		const code = this.lectureById(h.lectureId)?.module;
		if (picks.length === 0 || !code) return null;
		const find = (id: string) => {
			const r = picks.find((p) => p.questionId === id);
			return r ? this.packs?.bank(r.lectureId)?.find((q) => q.id === id) : undefined;
		};
		const seedAnswers = h.answers.flatMap((a) => {
			const q = find(a.questionId);
			return q ? [{ questionId: a.questionId, choice: a.choice, correct: a.correct, at: h.at, stem: q.stem, choiceLabel: q.options[a.choice] ?? "" }] : [];
		});
		const spec: SessionSpec = {
			kind: "practise", lectureId: h.lectureId, mode: "question-first", study: "practise",
			budget: { questions: picks.length, minutes: PRACTISE_RULES.minutes },
			practise: { module: code, picks },
			...(seedAnswers.length ? { seedAnswers } : {}),
		};
		const { sessionId } = this.createSession(spec);
		const more = picks.length - seedAnswers.length;
		const text = seedAnswers.length > 1 ? HANDOFF_COPY.toastMany(seedAnswers.length, more) : HANDOFF_COPY.toast(more, seedAnswers[0]?.correct ?? true);
		this.store.appendNudge({ id: this.id("n"), type: "N-1", key, firedAt: this.now().toISOString(), title: HANDOFF_COPY.title, text, lectureId: h.lectureId, sessionId, why: "you asked on your phone" });
		// The laptop has the round now: none of it is waiting on the phone any more.
		this.phoneSaved({ remove: picks.map((p) => p.questionId) });
		return { sessionId };
	}

	/**
	 * "4 more on your laptop" (J2′ step 4): a post-lecture session on that unit
	 * with question 1 recorded from the phone, ready at question 2, and a toast:
	 * "Question 1 answered on your phone ✓ 4 more ready."
	 */
	startHandoff(h: { lectureId: string; questionId?: string; choice?: number; correct?: boolean; at: string; phoneEventId: string; round?: RoundRef[]; answers?: { questionId: string; choice: number; correct: boolean }[] }) {
		const key = `handoff:${h.phoneEventId}`;
		if (this.store.nudges().some((n) => n.key === key)) return null;
		if (h.round?.length) {
			const started = this.handoffRound({ lectureId: h.lectureId, round: h.round, answers: h.answers ?? [], at: h.at }, key);
			if (started) return started;
		}
		// The phone's question is the first question of a Practise round; the laptop carries on with the rest (V-40).
		const spec: SessionSpec = { ...specFor("post-lecture", h.lectureId, this.store.profile()?.prefs), study: "practise" };
		const q = h.questionId ? this.packs?.bank(h.lectureId)?.find((x) => x.id === h.questionId) : undefined;
		if (h.questionId && h.choice !== undefined && h.correct !== undefined) {
			spec.seedAnswer = { questionId: h.questionId, choice: h.choice, correct: h.correct, at: h.at, ...(q ? { stem: q.stem, choiceLabel: q.options[h.choice] ?? "" } : {}) };
		}
		const { sessionId } = this.createSession(spec);
		const more = spec.seedAnswer ? spec.budget.questions - 1 : spec.budget.questions;
		this.store.appendNudge({ id: this.id("n"), type: "N-1", key, firedAt: this.now().toISOString(), title: HANDOFF_COPY.title, text: HANDOFF_COPY.toast(more, spec.seedAnswer?.correct ?? true), lectureId: h.lectureId, sessionId, why: "you asked on your phone" });
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
	banner(): (NudgeRecord & { ready: boolean; startsAt: number }) | null {
		const now = this.now();
		const n = [...this.store.nudges()].reverse().find((x) => !x.outcome && sameDay(x.firedAt, now));
		if (!n || addMinutes(new Date(n.firedAt), NUDGE_RULES.bannerTtlMinutes) < now) return null;
		const session = n.sessionId ? this.store.session(n.sessionId) : null;
		// A hand-off from the phone picks up at question 2: question 1 was answered there (R-8).
		return { ...n, ready: isSessionReady(session ?? undefined), startsAt: session?.spec.seedAnswer ? 2 : 1 };
	}

	/**
	 * The phone frame's 30-second tick: pre-warm what is coming, fire what is
	 * due. Sessions started by this tick get up to `settleMs` to become ready
	 * (scripted ones are ready in microseconds; LearnHarness takes seconds and
	 * is simply picked up by a later tick).
	 */
	async tick(settleMs = 250): Promise<{ nudge: (NudgeRecord & { ready: boolean; startsAt: number }) | null; prepared: string[] }> {
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
		return q ? this.asNudgeQuestion(lectureId, q) : undefined;
	}

	private asNudgeQuestion(lectureId: string, q: BankQuestion): NudgeQuestion {
		const unit = this.lectureById(lectureId);
		return { id: q.id, lectureId, stem: q.stem, options: q.options, correct: q.correct, explanation: q.explanation, slides: q.slides, ...(unit ? { unit: unit.title, module: unit.module } : {}) };
	}

	/**
	 * Questions 2 onwards of the round a notification's question starts
	 * (v2.1, V-46). `lead`: this is the next notification to be sent, so what
	 * was saved on the phone comes straight after its own question.
	 */
	phoneRound(first: NudgeQuestion, lead: boolean): NudgeQuestion[] {
		const bank = (id: string) => this.packs?.bank(id) ?? [];
		const saved = lead
			? (this.store.runtime().phoneSaved ?? []).flatMap((r) => {
					const q = bank(r.lectureId).find((x) => x.id === r.questionId);
					return q ? [this.asNudgeQuestion(r.lectureId, q)] : [];
				})
			: [];
		const own = bank(first.lectureId).map((q) => this.asNudgeQuestion(first.lectureId, q));
		return buildRound({ first, saved, own, size: PHONE_RULES.roundSize });
	}

	/** The phone's saved questions after some are added ("Done for now") or dealt with (answered, or taken over by the laptop). */
	phoneSaved(change: { add?: readonly RoundRef[]; remove?: readonly string[] }) {
		const before = this.store.runtime().phoneSaved ?? [];
		const after = savedAfter(before, change, PHONE_RULES.savedMax);
		if (JSON.stringify(after) !== JSON.stringify(before)) this.store.saveRuntime({ phoneSaved: after });
	}

	/** The next 7 days of nudges for the phone relay (F-112, F-114): same rules as the live tick. */
	schedule() {
		const now = this.now();
		const state = this.store.state();
		return { now: now.toISOString(), nudges: scheduleWeek(state, now, { questionFor: (id, used) => this.questionFor(id, used) }) };
	}

	/** The block a block nudge is for. Its key is `block:<id>:<date>`, or `forced:block:<id>:<ms>`. */
	private blockOfNudge(key: string): StudyBlock | null {
		const id = /(?:^|:)block:([^:]+):/.exec(key)?.[1];
		return id ? (this.store.blocks().find((b) => b.id === id) ?? null) : null;
	}

	private fire(c: NudgeCandidate, forced: boolean): NudgeRecord {
		// N-5 opens the check-in, not a session (F-111).
		// A block's notification names its first step, and its session opens on it (V-44).
		const block = c.type === "block" ? this.blockOfNudge(c.key) : null;
		const firstStep = block ? this.firstStepOf(block) : null;
		if (firstStep) c = { ...c, spec: { ...c.spec, firstQuestionId: firstStep.questionId }, text: NUDGE_TEXT.block(block!.minutes, PLAN_COPY.firstStep(firstStep.slide)) };
		// The question after a lecture opens a Practise round (V-40).
		if (c.type === "N-1") c = { ...c, spec: { ...c.spec, study: "practise" } };
		// A block's notification opens what the block suggests: Learn, picking up where it stopped, or Practise (step 5).
		const sessionId = c.opens === "checkin" ? undefined : (c.sessionId ?? (block ? this.openBlock(block, undefined, c.key) : null) ?? this.createSession(c.spec, { nudgeKey: c.key }).sessionId);
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
				// Opening a block's notification is starting the block (V-44).
				if (nudge.type === "block") {
					const block = this.blockOfNudge(nudge.key);
					if (block) this.markBlockStarted(block.id, "nudge");
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
		// Learn or Practise, when the screen says which (V-40). Unsaid, the session's kind and the AI connection decide.
		if (r.study !== undefined) {
			if (r.study !== "learn" && r.study !== "practise") throw badRequest("study must be learn or practise");
			spec.study = r.study;
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

	createSession(spec: SessionSpec, opts: { nudgeKey?: string; engine?: EngineName; askHow?: boolean } = {}): { sessionId: string } {
		// The first taste is prepared during onboarding, before the profile exists (J1′).
		if (!(spec.kind === "try-now" && spec.lectureId === FIRST_TASTE_LECTURE)) this.requireProfile();
		const lecture = this.lectureById(spec.lectureId);
		if (!lecture) throw notFound("lecture");
		if (spec.kind === "retest" && !(spec.missIds && spec.missIds.length > 0)) {
			const misses = dueMissesForRetest(this.store.misses().filter((m) => m.lectureId === spec.lectureId), this.now(), true);
			if (misses.length === 0) throw badRequest("nothing to retest for this lecture");
			spec = { ...spec, missIds: misses.map((m) => m.id) };
		}
		// A retest and the welcome-back taste are Practise (step 5): quick questions from the bank.
		if ((spec.kind === "retest" || spec.kind === "try-now") && !spec.learn && spec.study === undefined) spec = { ...spec, study: "practise" };
		// Practise runs on the question bank and needs no AI (V-40). A unit with no bank yet can only be taught, so it stays Learn.
		if (spec.study === "practise" && !spec.practise && !this.content.scriptedSet(spec.lectureId)) spec = { ...spec, study: "learn" };
		const engine = spec.study === "practise" ? "scripted" : (opts.engine ?? this.store.demo().engineOverride ?? this.defaultEngine());
		// Two modes only (V-40; step 5). The tutor teaching is Learn; anything on the question bank is Practise.
		if (engine === "learnharness" && !spec.learn) spec = this.asLearn(spec);
		else if (engine === "scripted" && spec.study !== "practise") {
			if (spec.kind === "learn" || spec.learn) throw new CompanionError("not_connected", 409, LEARN_COPY.notConnected);
			spec = { ...spec, study: "practise" };
		}
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
		// The module's first Learn session (V-52): "How do you like to learn this?" comes first. The tutor starts once it is answered or skipped.
		const waiting = !!opts.askHow && !!spec.learn && owesHowCard(this.store.notes(), lecture.module);
		this.store.saveSession(waiting ? { ...session, awaitingHow: true } : session);
		if (!waiting) this.beginPrepare(session.id, !!opts.nudgeKey);
		return { sessionId: session.id };
	}

	private beginPrepare(sessionId: string, prewarm = false): void {
		const session = this.store.session(sessionId);
		if (!session || this.preparing.has(sessionId)) return;
		this.log("session_prepare_started", { sessionId, engine: session.engine, kind: session.spec.kind, study: session.spec.study ?? "learn", lectureId: session.spec.lectureId, prewarm });
		const run = this.prepare(sessionId).finally(() => this.preparing.delete(sessionId));
		this.preparing.set(sessionId, run);
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
			const firstQuestion = session.spec.firstQuestionId ? this.packs?.bank(lecture.id)?.find((q) => q.id === session.spec.firstQuestionId) : undefined;
			const { text } = session.spec.learn ? this.learnOpening(session.spec, lecture, firstQuestion) : buildOpeningMessage({
				spec: session.spec,
				lecture,
				...(moduleName ? { moduleName } : {}),
				slidesMarkdown: this.content.slidesMarkdown(lecture.id) ?? "",
				conceptMap: this.content.conceptMapSource(lecture.id) ?? undefined,
				...(firstQuestion ? { firstStep: { stem: firstQuestion.stem, slide: firstQuestion.slides[0] ?? null } } : {}),
				misses,
				now: this.now(),
			});
			const patch = await engine.start(session, { title: `${lecture.module} · ${lecture.title}`, openingMessage: text, misses });
			const started2 = this.store.updateSession(sessionId, (s) => ({ ...s, ...patch }));
			if (!started2) return;
			await this.untilReady(started2, engine, started);
		} catch (err) {
			const code = err instanceof CompanionError ? err.code : "prepare_failed";
			const message = err instanceof Error ? err.message : String(err);
			if (this.deps.autoFallback && attempt === 0 && session.engine === "learnharness" && this.safeHasScripted(session.spec.lectureId)) {
				// The tutor could not start: the same unit on its question bank, which is Practise.
				this.store.updateSession(sessionId, (s) => {
					const spec = this.asPractise(s.spec);
					return { ...s, spec, budget: spec.budget.questions, engine: "scripted", fellBackFrom: "learnharness", state: "preparing" };
				});
				this.log("engine_fallback", { sessionId, from: "learnharness", to: "scripted", code, message });
				return this.prepare(sessionId, 1);
			}
			this.prepareFailed(session, err);
		}
	}

	/** Wait for question 1, then mark the session ready. */
	private async untilReady(session: CompanionSession, engine: SessionEngine, started: number): Promise<void> {
		await engine.waitUntilReady(session, this.deps.readyTimeoutMs ?? PREPARE_RULES.readyTimeoutMs, () =>
			this.log("teacher_nudged", { sessionId: session.id, answered: 0, budget: session.budget, engine: session.engine }),
		);
		this.store.updateSession(session.id, (s) => ({
			...s,
			readyAt: this.now().toISOString(),
			state: s.state === "preparing" ? (s.openedAt ? "active" : "ready") : s.state,
		}));
		this.log("session_prepared", { sessionId: session.id, engine: session.engine, kind: session.spec.kind, latencyMs: Date.now() - started, chatId: session.chatId ?? null });
	}

	private prepareFailed(session: CompanionSession, err: unknown): void {
		const code = err instanceof CompanionError ? err.code : "prepare_failed";
		const message = err instanceof Error ? err.message : String(err);
		this.store.updateSession(session.id, (s) => ({ ...s, state: "error", error: code }));
		this.log("error", { where: "prepare", sessionId: session.id, engine: session.engine, code, message });
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
			this.markOpened(session.id, now);
			const base = {
				...this.studyOf(session, lecture, session.budget),
				id: session.id, engine: session.engine, kind: session.spec.kind, mode: session.spec.mode,
				lecture: { id: lecture.id, title: lecture.title, module: lecture.module },
				goal: goalFor(session.spec, lecture, session.budget), answered: 0, budget: session.budget, canHint: false, slideRefs: [],
			};
			if (session.state === "error") return { ...base, status: "error", error: session.error ?? "prepare_failed", practiceAvailable: this.canPractise(session) };
			if (session.awaitingHow) {
				const notes = this.store.notes();
				// Still owed: the card. Answered meanwhile (another tab, another session of this module): start the tutor.
				if (owesHowCard(notes, lecture.module)) {
					const name = this.store.profile()?.modules.find((m) => m.code === lecture.module)?.name ?? lecture.module;
					return { ...base, status: "ask", ask: { module: lecture.module, name, canCopy: howFromOthers(notes, lecture.module) !== null } };
				}
				this.store.updateSession(session.id, ({ awaitingHow: _waiting, ...s }) => s);
				this.beginPrepare(session.id);
			}
			return { ...base, status: "preparing", activity: session.spec.learn ? LEARN_COPY.reading(lecture.module) : SESSION_COPY.reading(lecture.module) };
		}
		// Learn: opening it (again) starts this sitting's clock, so mark it before the view reads the clock.
		if (session.spec.learn) this.markOpened(session.id, now);
		// A hand-off's phone answer (F-112) is counted by each engine itself.
		const { teacherNudged, ...mapped } = await engine.view(session.spec.learn ? (this.store.session(session.id) ?? session) : session, lecture, now);
		const v = mapped.status === "error" ? { ...mapped, practiceAvailable: this.canPractise(session) } : mapped;
		if (teacherNudged) this.log("teacher_nudged", { sessionId: session.id, answered: v.answered, budget: v.budget, engine: session.engine });
		this.markOpened(session.id, now);
		this.store.updateSession(session.id, (s) => {
			let next: CompanionSession = { ...s, answered: v.answered };
			// Where the plan stands, for the pick-up card (and the plan note of V-53).
			const plan = v.learn?.plan;
			if (plan && (s.learnAt?.index !== plan.index || s.learnAt.total !== plan.total || s.learnAt.title !== (plan.current ?? ""))) {
				next = { ...next, learnAt: { index: plan.index, total: plan.total, title: plan.current ?? "", covered: plan.nodes.filter((n) => n.state !== "todo").map((n) => n.title), plan: plan.nodes.map((n) => ({ title: n.title, state: n.state })) } };
			}
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
		return { ...v, ...this.studyOf(session, lecture, v.budget), ...this.weekOf(session, v), ...(v.status === "done" ? this.doneExtras(session, now) : {}) };
	}

	/** Every right answer in the history, for the gap rule (V-43): laptop answers, and the phone's. */
	private rightAnswers(): RightAnswer[] {
		const nodeOf = new Map<string, string | undefined>();
		const node = (lectureId: string, questionId: string) => {
			const k = `${lectureId}|${questionId}`;
			if (!nodeOf.has(k)) nodeOf.set(k, this.packs?.bank(lectureId)?.find((q) => q.id === questionId)?.node);
			return nodeOf.get(k);
		};
		const out: RightAnswer[] = [];
		for (const e of this.store.events()) {
			const d = e.data as { lectureId?: unknown; questionId?: unknown; nodeId?: unknown; correct?: unknown; graded?: unknown; dontKnow?: unknown; confidence?: unknown; source?: unknown };
			const laptop = e.type === "answer" && d.graded !== false;
			const phone = e.type === "answered" && d.source === "phone";
			if ((!laptop && !phone) || d.correct !== true || d.dontKnow === true) continue;
			if (typeof d.lectureId !== "string" || typeof d.questionId !== "string") continue;
			const nodeId = (typeof d.nodeId === "string" && d.nodeId) || node(d.lectureId, d.questionId) || GENERAL_IDEA;
			out.push({ ideaKey: `${d.lectureId}#${nodeId}`, questionId: d.questionId, at: new Date(e.t), confidence: typeof d.confidence === "number" ? d.confidence : null });
		}
		return out;
	}

	/** Close the gaps that have earned it (V-43), after any answer. */
	private settleGaps(): void {
		const misses = this.store.misses();
		if (!misses.some((m) => m.status === "open")) return;
		const next = closeGaps(misses, this.rightAnswers(), this.now());
		if (next === misses) return;
		const closed = next.filter((m, i) => m.status === "solid" && misses[i]!.status === "open");
		this.store.saveMisses(next);
		for (const key of new Set(closed.map(ideaKeyOfMiss))) this.log("gap_closed", { idea: key, questions: closed.filter((m) => ideaKeyOfMiss(m) === key).length });
	}

	/**
	 * Gaps by idea (V-39): module, then idea, then the questions missed on it,
	 * with how far each idea is towards leaving the list (V-43). Only ideas
	 * with a gap are listed. Confident errors come first within a module.
	 */
	gaps() {
		const profile = this.requireProfile();
		const lectures = new Map(this.store.allLectures().map((l) => [l.id, l]));
		const titles = new Map(this.packIdeas().map((i) => [`${i.lectureId}#${i.nodeId}`, i.title]));
		const ideas = gapsByIdea(this.store.misses(), this.rightAnswers()).flatMap((g) => {
			const unit = lectures.get(g.lectureId);
			if (!unit) return [];
			const bank = this.packs?.bank(g.lectureId) ?? [];
			return [{
				key: g.key,
				lectureId: g.lectureId,
				nodeId: g.nodeId,
				module: unit.module,
				unit: unit.title,
				title: titles.get(g.key) ?? (g.nodeId === GENERAL_IDEA ? GAP_COPY.wholeUnit(unit.title) : g.nodeId.replace(/[-_]+/g, " ")),
				missed: g.misses.length,
				right: g.right,
				needed: g.needed,
				confidentError: g.confidentError,
				// "Practise this idea" needs questions on it to draw from.
				// Either the idea has questions to draw from, or it is on the unit's map and the AI is connected to write some.
				canPractise: bank.some((q) => q.node === g.nodeId) || (g.nodeId === GENERAL_IDEA && bank.length > 0) || (this.aiReady && titles.has(g.key)),
				questions: g.misses.map((m) => ({
					id: m.id,
					text: m.questionText,
					chosen: m.chosen ?? [],
					reason: m.reason,
					correct: m.correctLabels,
					explanation: m.explanation ?? null,
					slide: parseSlideRefs(m.explanation)[0] ?? bank.find((q) => q.id === m.questionId)?.slides[0] ?? null,
					at: m.createdAt,
				})),
			}];
		});
		const modules = profile.modules
			.map((m) => ({ code: m.code, name: m.name, ideas: ideas.filter((i) => i.module === m.code) }))
			.filter((m) => m.ideas.length > 0);
		return { modules, ideas: ideas.length };
	}

	/** A week in one Learn session: the header names the week, and the slide panel follows the unit of the idea being taught. */
	private weekOf(session: CompanionSession, v: SessionView): Partial<Pick<SessionView, "lecture" | "learn">> {
		const ids = session.spec.learn?.lectureIds;
		if (!ids || ids.length < 2 || !v.learn) return {};
		const first = this.lectureById(ids[0]!);
		const at = v.learn.plan?.currentId ? this.lectureById(learnNodeRef(v.learn.plan.currentId, ids, ids[0]).lectureId) : undefined;
		return {
			lecture: { ...v.lecture, title: LEARN_COPY.weekTitle(first?.week ?? 0, ids.length) },
			learn: { ...v.learn, ...(at ? { unit: { id: at.id, title: at.title } } : {}) },
		};
	}

	/** Learn or Practise, for the header (V-40, V-50). A round across a module is named after the module. */
	private studyOf(session: CompanionSession, lecture: Pick<Lecture, "module">, budget: number): Pick<SessionView, "study" | "practiseOf"> & { goal?: string } {
		const study = session.spec.study ?? "learn";
		if (!session.spec.practise) return { study };
		const name = this.store.profile()?.modules.find((m) => m.code === session.spec.practise!.module)?.name ?? lecture.module;
		return { study, practiseOf: name, goal: goalFor(session.spec, { title: name }, budget) };
	}

	/**
	 * Start Practise (V-40). For "Practise this idea" (V-39) the AI first writes
	 * new questions around the gap, when it is connected; they lead the round.
	 * Without the AI, or if it fails, the round uses the idea's unused questions.
	 */
	async practise(raw: unknown): Promise<{ sessionId: string; written: number }> {
		const idea = (raw as { idea?: unknown } | null)?.idea;
		let written: string[] = [];
		if (typeof idea === "string" && idea.includes("#") && this.packs && (this.ai ? await this.ai.ready().catch(() => false) : false)) {
			const [lectureId, nodeId] = [idea.slice(0, idea.indexOf("#")), idea.slice(idea.indexOf("#") + 1)];
			const misses = this.store.misses().filter((m) => m.status === "open" && ideaKeyOfMiss(m) === idea);
			try {
				const fresh = await this.packs.writeForIdea(lectureId, nodeId, misses.map((m) => ({ stem: m.questionText, chosen: m.chosen ?? [], correct: m.correctLabels, reason: m.reason, ...(m.confidence !== undefined ? { confidence: m.confidence } : {}), ...(m.why ? { why: m.why } : {}) })), GAP_RULES.newQuestions);
				written = fresh.map((q) => q.id);
			} catch (err) {
				// The round still runs, on the questions the idea already has.
				this.log("gap_questions_failed", { idea, error: err instanceof Error ? err.message.slice(0, 200) : "unknown" });
			}
		}
		return { ...this.startPractise(raw, written), written: written.length };
	}

	/**
	 * Start a Practise round across a module (V-40): questions from the
	 * module's banks, chosen by the mixing rule. No AI, no wait.
	 */
	startPractise(raw: unknown, lead: readonly string[] = []): { sessionId: string } {
		const code = (raw as { module?: unknown } | null)?.module;
		if (typeof code !== "string" || !this.requireProfile().modules.some((m) => m.code === code)) throw badRequest("module must be one of your modules");
		// "Practise this idea" (V-39): the round stays on one idea of one unit.
		const idea = (raw as { idea?: unknown }).idea;
		if (idea !== undefined && (typeof idea !== "string" || !idea.includes("#"))) throw badRequest("idea must be an idea key, lectureId#nodeId");
		// Questions just written for this gap lead the round; the rest are chosen by the rule.
		const n = idea ? GAP_RULES.newQuestions : PRACTISE_RULES.questions;
		const leading = idea ? lead.slice(0, n).map((questionId) => ({ lectureId: (idea as string).slice(0, (idea as string).indexOf("#")), questionId })) : [];
		const picks = [...leading, ...this.practisePicks(code, n - leading.length, new Set(leading.map((p) => p.questionId)), idea as string | undefined)];
		if (picks.length === 0) throw new CompanionError("no_questions", 422, idea ? GAP_COPY.noQuestions : PRACTISE_COPY.noQuestions);
		const spec: SessionSpec = {
			kind: "practise", lectureId: picks[0]!.lectureId, mode: "question-first", study: "practise",
			budget: { questions: picks.length, minutes: PRACTISE_RULES.minutes },
			practise: { module: code, picks, ...(idea ? { idea: idea as string } : {}) },
		};
		return this.createSession(spec);
	}

	/** The questions for a Practise round: what `pickPractise` chooses from the module's banks and the student's history. */
	private practisePicks(module: string, n: number, exclude: ReadonlySet<string>, idea?: string): { lectureId: string; questionId: string }[] {
		const now = this.now();
		const all: PractiseCandidate[] = this.store.lectures().filter((l) => l.module === module).flatMap((l) => (this.packs?.bank(l.id) ?? []).map((question) => ({ lectureId: l.id, question })));
		// One idea only: its own questions, or the whole unit's when the gap is on the unit in general.
		const candidates = !idea ? all : all.filter((c) => (idea.endsWith(`#${GENERAL_IDEA}`) ? `${c.lectureId}#${GENERAL_IDEA}` === idea : ideaKeyOf(c) === idea));
		if (candidates.length === 0) return [];
		// How often, and when last, each question has been asked: on the laptop or the phone.
		const asked = new Map<string, { times: number; last: number }>();
		const events = this.store.events();
		for (const e of events) {
			if (e.type !== "answer" && e.type !== "answered") continue;
			const id = e.data.questionId;
			if (typeof id !== "string") continue;
			const at = new Date(e.t).getTime();
			const a = asked.get(id);
			asked.set(id, { times: (a?.times ?? 0) + 1, last: Math.max(a?.last ?? at, at) });
		}
		// Where each idea stands: a gap, fading, fine, or not met yet.
		const banks = new Map<string, Map<string, QuestionInfo>>();
		const questionInfo = (questionId: string, lectureId: string) => {
			if (!banks.has(lectureId)) banks.set(lectureId, new Map((this.packs?.bank(lectureId) ?? []).map((q) => [q.id, { difficulty: q.difficulty, nodeId: q.node }])));
			return banks.get(lectureId)!.get(questionId);
		};
		const replay = replayScore({ events, blocks: this.store.blocks(), lectures: this.store.allLectures(), ideas: this.packIdeas(), questionInfo, now });
		const fading = new Set(fadingAt(replay, now));
		const standing = new Map<string, IdeaStanding>();
		for (const i of replay.ideas.values()) standing.set(i.key, i.toRevisit ? "gap" : fading.has(i.key) ? "fading" : i.lastRight ? "ok" : "new");
		for (const m of this.store.misses()) if (m.status === "open" && m.nodeId) standing.set(`${m.lectureId}#${m.nodeId}`, "gap");
		return pickPractise({ candidates, asked, standing, n, exclude }).map((c) => ({ lectureId: c.lectureId, questionId: c.question.id }));
	}

	/**
	 * What the done screen names instead of a score (R-6; design log 23 Nov):
	 * the ideas this session will bring back, and the next study block.
	 */
	private doneExtras(session: CompanionSession, now: Date): Pick<SessionView, "comingBack" | "nextBlockAt"> {
		const titles = new Map(this.packIdeas().map((i) => [`${i.lectureId}#${i.nodeId}`, i.title]));
		const comingBack: string[] = [];
		for (const m of this.store.misses()) {
			if (m.sessionId !== session.id || m.status !== "open") continue;
			const name = (m.nodeId ? titles.get(`${m.lectureId}#${m.nodeId}`) : undefined) ?? m.questionText;
			if (!comingBack.includes(name)) comingBack.push(name);
		}
		return { comingBack, nextBlockAt: this.nextBlockOf(this.store.state(), now)?.start.toISOString() ?? null };
	}

	/** The next study block still to come, within the week ahead. */
	private nextBlockOf(state: Pick<ReturnType<CompanionStore["state"]>, "blocks">, now: Date) {
		for (let i = 0; i < 8; i++) {
			const c = commitmentsOn({ lectures: [], blocks: state.blocks }, addDays(now, i)).find((b) => b.end > now);
			if (c) return c;
		}
		return null;
	}

	/**
	 * The session screen has opened this session (or come back to a stopped
	 * one). Decided from the record as it is now, inside the update: the
	 * screen asks every 750 ms and the engine's view takes a moment, so a
	 * copy read before that would open the same session several times (X-1).
	 */
	private markOpened(sessionId: string, now: Date): void {
		let opened: { session: CompanionSession; resumed: boolean } | null = null;
		this.store.updateSession(sessionId, (s) => {
			if (s.openedAt && s.state !== "stopped") return s;
			opened = { session: s, resumed: !!s.openedAt };
			return {
				...s,
				openedAt: s.openedAt ?? now.toISOString(),
				lastActivityAt: now.toISOString(),
				// Learn: the clock for this sitting starts when it is opened, and again when it is picked up.
				...(s.spec.learn ? { sittingFrom: now.toISOString() } : {}),
				state: s.state === "ready" || s.state === "stopped" ? "active" : s.state,
			};
		});
		const o = opened as { session: CompanionSession; resumed: boolean } | null;
		if (o) this.log("session_opened", { sessionId, engine: o.session.engine, kind: o.session.spec.kind, prewarmed: !!o.session.nudgeKey, ready: isSessionReady(o.session), resumed: o.resumed });
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
		if (r.text !== undefined) {
			if (typeof r.text !== "string" || r.text.length > LEARN_RULES.sayMax) throw badRequest(`text must be under ${LEARN_RULES.sayMax} characters`);
			if (r.text.trim()) out.text = r.text.trim();
		}
		if (!out.dontKnow && !(out.indices && out.indices.length > 0) && !out.text) throw badRequest("choose an option or \"I don't know\"");
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
		// A week in one Learn session: the idea says which unit it belongs to.
		const ref = session.spec.learn?.lectureIds?.length && record.nodeId ? learnNodeRef(record.nodeId, session.spec.learn.lectureIds, session.spec.lectureId) : null;
		if (ref) record.nodeId = ref.nodeId;
		const lectureId = ref?.lectureId ?? record.lectureId ?? session.spec.lectureId;
		const miss = missFromAnswer(record, { sessionId: id, lectureId, now });
		let misses = this.store.misses();
		if (miss) misses = mergeMisses(misses, [miss]);
		if (session.spec.kind === "retest" && counts && session.spec.missIds) misses = applyRetestAnswer(misses, session.spec.missIds, updated.answered, record, now);
		if (miss || session.spec.kind === "retest") this.store.saveMisses(misses);
		this.log("answer", {
			sessionId: id, lectureId, questionId: record.questionId, nodeId: record.nodeId ?? null,
			slides: parseSlideRefs(record.explanation), n: updated.answered, engine: session.engine, kind: session.spec.kind, study: session.spec.study ?? "learn",
			graded: record.graded, guess: !!record.guess, correct: record.correct, dontKnow: record.dontKnow, confidence: record.confidence ?? null,
			why: !!record.why, whyLength: record.why?.length ?? 0, assisted: (session.hintedQuestionIds ?? []).includes(record.questionId),
			msOnQuestion: session.questionShownAt ? now.getTime() - new Date(session.questionShownAt).getTime() : null,
			miss: miss?.reason ?? null,
			// What was chosen (V-39). The typed reason stays out of the log; it is kept with the miss.
			chosen: record.chosen ?? [],
		});
		this.settleGaps();
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
		let extra: { lectureId: string; questionId: string }[] = [];
		if (session.spec.practise) {
			extra = this.practisePicks(session.spec.practise.module, n as number, new Set(session.spec.practise.picks.map((p) => p.questionId)), session.spec.practise.idea);
			if (extra.length === 0) throw new CompanionError("no_more_questions", 409, PRACTISE_COPY.noMore);
		}
		const budget = session.budget + (session.spec.practise ? extra.length : (n as number));
		const raised = this.store.updateSession(id, (s) => ({
			...s,
			budget,
			...(s.spec.practise ? { spec: { ...s.spec, practise: { ...s.spec.practise, picks: [...s.spec.practise.picks, ...extra] } } } : {}),
			state: s.state === "done" || s.state === "stopped" ? "active" : s.state,
		}))!;
		const { patch } = await engine.more(raised, n as number);
		this.store.updateSession(id, (s) => ({ ...s, ...patch, lastActivityAt: this.now().toISOString() }));
		this.log("keep_going", { sessionId: id, added: session.spec.practise ? extra.length : n, budget });
		return { budget };
	}

	stop(id: string): void {
		const { session } = this.requireSession(id);
		if (session.state === "done" || session.state === "stopped") return;
		this.store.updateSession(id, (s) => ({ ...s, state: "stopped", endedAt: this.now().toISOString() }));
		this.log("session_stopped", { sessionId: id, answered: session.answered, budget: session.budget, engine: session.engine, ...(session.learnAt ? { idea: session.learnAt.index, ideas: session.learnAt.total } : {}) });
		this.noteWhere(id);
	}

	// ─── what LockedIn knows about you (v2.0 step 6; V-52, V-53) ────────────

	/** The newest earlier Learn session in a module that got as far as a plan: the third note. */
	private lastLearnIn(module: string): NonNullable<ModuleNotesView["last"]> | null {
		for (const s of [...this.store.sessions()].reverse()) {
			if (!s.spec.learn || !s.learnAt) continue;
			const lecture = this.lectureById(s.spec.lectureId);
			if (!lecture || lecture.module !== module) continue;
			return { sessionId: s.id, lecture: lecture.title, at: s.endedAt ?? s.lastActivityAt ?? s.createdAt, index: s.learnAt.index, total: s.learnAt.total, title: s.learnAt.title, plan: s.learnAt.plan ?? [], finished: s.state === "done" };
		}
		return null;
	}

	/** The three notes for a module, as the Library shows them (V-53; R-7, AFF-H: show what the app knows). */
	moduleNotes(code: string): ModuleNotesView {
		const mod = this.requireModule(code);
		const n = this.store.notes()[mod.code] ?? {};
		return {
			module: { code: mod.code, name: mod.name },
			asked: n.asked === true,
			how: n.how ? { text: n.how.text, at: n.how.at } : null,
			where: n.where ?? null,
			last: this.lastLearnIn(mod.code),
		};
	}

	private patchNotes(module: string, patch: (n: ModuleNotes) => ModuleNotes): ModuleNotes {
		const all = this.store.notes();
		const next = patch(all[module] ?? {});
		this.store.saveNotes({ ...all, [module]: next });
		return next;
	}

	/** The student edits a note: `{ how?: string, where?: string }`. An empty string clears it. */
	saveModuleNote(code: string, raw: unknown): ModuleNotesView {
		const mod = this.requireModule(code);
		const r = (raw ?? {}) as { how?: unknown; where?: unknown };
		const at = this.now().toISOString();
		const text = (v: unknown, max: number): string | undefined => {
			if (v === undefined) return undefined;
			if (typeof v !== "string") throw badRequest("a note is text");
			const t = v.trim();
			if (wordCount(t) > max) throw badRequest(NOTE_COPY.tooLong(max));
			return t;
		};
		const how = text(r.how, NOTE_RULES.howWords);
		const where = text(r.where, NOTE_RULES.whereWords);
		if (how === undefined && where === undefined) throw badRequest("nothing to save");
		this.patchNotes(mod.code, (n) => {
			const { how: oldHow, where: oldWhere, ...rest } = n;
			return {
				...rest,
				...(how === undefined ? (oldHow ? { how: oldHow } : {}) : how ? { how: { text: how, at } } : {}),
				...(where === undefined ? (oldWhere ? { where: oldWhere } : {}) : where ? { where: { text: where, at, by: "you" as const } } : {}),
			};
		});
		for (const note of [how !== undefined ? "how" : null, where !== undefined ? "where" : null]) if (note) this.log("note_edited", { module: mod.code, note });
		return this.moduleNotes(mod.code);
	}

	/**
	 * The first-time card (V-52), answered on a waiting Learn session: the
	 * taps (`{ start?, steps?, check?, more? }`), `{ same: true }` to reuse
	 * another module's answer, or `{ skip: true }`. Either way the module is
	 * never asked again, and the tutor starts.
	 */
	answerHow(id: string, raw: unknown): { ok: true } {
		const { session, lecture } = this.requireSession(id);
		if (!session.spec.learn) throw conflict("not_learn", "only a Learn session asks this");
		const r = (raw ?? {}) as { same?: unknown; skip?: unknown };
		const at = this.now().toISOString();
		const others = howFromOthers(this.store.notes(), lecture.module);
		if (r.same === true && !others) throw badRequest("no other module has an answer to reuse");
		const prefs = r.same === true || r.skip === true ? {} : cleanPrefs(raw);
		const text = r.same === true ? others!.text : howNote(prefs);
		this.patchNotes(lecture.module, (n) => ({ ...n, asked: true, ...(text ? { how: { text, ...(Object.keys(prefs).length ? { prefs } : {}), at } } : {}) }));
		this.log("how_answered", { module: lecture.module, how: r.skip === true ? "skip" : r.same === true ? "same" : text ? "taps" : "skip", rows: ["start", "steps", "check"].filter((k) => k in prefs).length, typed: "more" in prefs });
		if (session.awaitingHow) {
			this.store.updateSession(id, ({ awaitingHow: _waiting, ...s }) => s);
			this.beginPrepare(id);
		}
		return { ok: true };
	}

	private readonly noting = new Map<string, Promise<void>>();

	/** Resolves when "where you are" has been rewritten (or not) after a session. For tests. */
	whenNoted(sessionId: string): Promise<void> {
		return this.noting.get(sessionId) ?? Promise.resolve();
	}

	/**
	 * After a Learn session ends, the AI rewrites the module's "where you are"
	 * note from what the session showed (V-53), on the cheap model and in the
	 * background. A failure is logged and the old note stays.
	 */
	private noteWhere(sessionId: string): void {
		const session = this.store.session(sessionId);
		const generate = this.deps.generate;
		if (!session?.spec.learn || !session.chatId || !generate || this.noting.has(sessionId)) return;
		const lecture = this.lectureById(session.spec.lectureId);
		const engine = this.deps.engines[session.engine];
		if (!lecture || !engine?.steps) return;
		let answered: string[];
		try {
			answered = engine.steps(session).flat().flatMap((i) => {
				if (i.type !== "answered") return [];
				const picked = i.written ?? (i.dontKnow ? "I don't know" : i.options.filter((o) => o.picked).map((o) => o.label).join("; "));
				const right = i.options.filter((o) => o.answer).map((o) => o.label).join("; ");
				return [`- ${i.guess ? "Have a guess" : i.options.length ? "Check" : "In their own words"}: ${i.stem.replace(/\s+/g, " ")} | answered: ${picked || "(nothing)"}${i.guess || i.correct === undefined ? "" : i.correct ? " | right" : " | not right"}${right && !i.correct ? ` | answer: ${right}` : ""}${i.why ? ` | their why: ${i.why}` : ""}`];
			});
		} catch {
			return;
		}
		// Nothing was answered: the session shows nothing new about where they are.
		if (answered.length === 0) return;
		const code = lecture.module;
		const started = Date.now();
		const old = this.store.notes()[code]?.where;
		const plan = session.learnAt?.plan?.length ? session.learnAt.plan.map((n) => `${n.title} (${n.state === "done" ? "done" : n.state === "current" ? "stopped here" : "not reached"})`).join("; ") : "none yet";
		const user = [
			`Module: ${code}`,
			`Lecture: ${lecture.title}`,
			`The note as it stands${old?.by === "you" ? " (the student edited it themselves)" : ""}:`,
			old?.text || "(empty)",
			"",
			`This session's plan: ${plan}`,
			`How it ended: ${session.state === "done" ? "the student finished it" : "the student stopped part-way"}`,
			"",
			"Questions and answers, in order:",
			...answered,
		].join("\n");
		const run = (async () => {
			try {
				const system = fs.readFileSync(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ this.deps.promptsDir ?? "companion/prompts", "where-you-are.md"), "utf-8");
				const r = await generate<{ note: string }>({
					slot: NOTE_RULES.slot, system, user,
					toolName: "save_note", toolDescription: "Save the rewritten note.",
					schema: { type: "object", additionalProperties: false, required: ["note"], properties: { note: { type: "string" } } },
					validate: (v) => {
						const note = (v as { note?: unknown } | null)?.note;
						if (typeof note !== "string" || !note.trim()) return "note must be text";
						return wordCount(note) > NOTE_RULES.whereWords ? `the note has ${wordCount(note)} words; keep it under ${NOTE_RULES.whereWords}` : null;
					},
				});
				const text = r.value.note.trim();
				this.patchNotes(code, (n) => ({ ...n, where: { text, at: this.now().toISOString(), by: "ai" } }));
				this.log("note_rewritten", { module: code, sessionId, words: wordCount(text), ms: Date.now() - started, model: r.model, cost: r.cost });
			} catch (err) {
				this.log("note_rewrite_failed", { module: code, sessionId, message: err instanceof Error ? err.message : String(err) });
			}
		})().finally(() => this.noting.delete(sessionId));
		this.noting.set(sessionId, run);
	}

	// ─── Learn (v2.0 step 5; V-47, V-54) ────────────────────────────────────

	/** How long a Learn sitting is when it isn't started from a block: the student's usual block length. */
	private learnMinutes(): number {
		return this.store.profile() ? this.planSettings().blockMinutes : LEARN_RULES.defaultMinutes;
	}

	/** Any session the tutor runs is Learn (V-40): give it Learn's shape. */
	private asLearn(spec: SessionSpec, minutes = this.learnMinutes()): SessionSpec {
		return { ...spec, study: "learn", budget: { questions: 0, minutes }, learn: { scope: spec.nodes?.length ? "section" : "lecture", minutes } };
	}

	/** The same unit on its question bank: what a Learn session becomes when the tutor can't run. */
	private asPractise(spec: SessionSpec): SessionSpec {
		const { learn: _learn, ...rest } = spec;
		const kind = rest.kind === "learn" ? "post-lecture" : rest.kind;
		return { ...rest, kind, study: "practise", budget: { ...SESSION_BUDGETS[kind] } };
	}

	private learnOpening(spec: SessionSpec, lecture: Lecture, firstQuestion?: { stem: string; slides: number[] }) {
		const ids = spec.learn?.lectureIds?.length ? spec.learn.lectureIds : [lecture.id];
		const units = ids.flatMap((id) => {
			const l = this.lectureById(id);
			return l ? [{ lecture: l, slidesMarkdown: this.content.slidesMarkdown(id) ?? "", slidesFile: this.content.slidesPath(id), conceptMap: this.content.conceptMapSource(id) }] : [];
		});
		const moduleName = this.store.profile()?.modules.find((m) => m.code === lecture.module)?.name;
		// What LockedIn knows about the student in this module (V-53): the tutor reads all three notes.
		const mine = this.store.notes()[lecture.module];
		const last = this.lastLearnIn(lecture.module);
		const notes = {
			...(mine?.how?.text ? { how: mine.how.text } : {}),
			...(mine?.where?.text ? { where: mine.where.text } : {}),
			...(last ? { last: `${last.finished ? NOTE_COPY.finishedAt(last.lecture) : NOTE_COPY.stoppedAt(last.index, last.total, last.title, last.lecture)}${last.plan.length ? ` Its plan: ${last.plan.map((n) => `${n.title} (${n.state === "done" ? "done" : n.state === "current" ? "stopped here" : "not reached"})`).join("; ")}.` : ""}` } : {}),
		};
		return buildLearnOpening({ spec, lecture, ...(moduleName ? { moduleName } : {}), units, now: this.now(), notes, ...(firstQuestion ? { firstStep: { stem: firstQuestion.stem, slide: firstQuestion.slides[0] ?? null } } : {}) });
	}

	/** A module's units that can be taught, in course order. */
	private learnUnits(code: string): Lecture[] {
		return this.store.lectures().filter((l) => l.module === code && l.hasMaterials && l.kind !== "event").sort((a, b) => (a.week || 99) - (b.week || 99) || a.order - b.order);
	}

	/** A Learn session that was stopped part-way, newest first (R-5: nothing is lost). Offered for RESUME_RULES.offerDays. */
	private unfinishedLearn(match: (s: CompanionSession) => boolean): CompanionSession | null {
		const now = this.now().getTime();
		return [...this.store.sessions()].reverse().find((s) => !!s.spec.learn && !!s.chatId && (s.state === "active" || s.state === "stopped") && match(s)
			&& now - new Date(s.endedAt ?? s.lastActivityAt ?? s.openedAt ?? s.createdAt).getTime() <= RESUME_RULES.offerDays * 86_400_000) ?? null;
	}

	/**
	 * The module's start sheet (step 5; AFF-K, INT-02-b): one suggestion, the
	 * topics a typed goal is matched against, and this week's lectures.
	 */
	learnSheet(code: string) {
		const mod = this.requireModule(code);
		const now = this.now();
		const units = this.learnUnits(mod.code);
		const ids = new Set(units.map((u) => u.id));
		const sessions = this.store.sessions();
		const learned = new Set(sessions.filter((s) => !!s.spec.learn && s.state === "done").flatMap((s) => s.spec.learn?.lectureIds ?? [s.spec.lectureId]));
		const stopped = this.unfinishedLearn((s) => units.some((u) => learnCovers(s, u.id)));
		const next = units.find((u) => !learned.has(u.id)) ?? units[0];
		const stoppedUnit = stopped ? units.find((u) => u.id === stopped.spec.lectureId) : undefined;
		const { week } = currentWeek(mod, now);
		const thisWeek = week ? units.filter((u) => u.week === week) : [];
		const topics: LearnTopic[] = units.map((u) => ({ lectureId: u.id, title: u.title, week: u.week }));
		for (const idea of this.packIdeas()) {
			const unit = units.find((u) => u.id === idea.lectureId);
			if (unit) topics.push({ lectureId: idea.lectureId, nodeId: idea.nodeId, title: idea.title, week: unit.week });
		}
		return {
			module: { code: mod.code, name: mod.name },
			connected: this.defaultEngine() === "learnharness" || this.store.demo().engineOverride === "learnharness",
			minutes: this.learnMinutes(),
			suggestion: stopped && stoppedUnit
				? { type: "resume" as const, sessionId: stopped.id, lectureId: stoppedUnit.id, title: stopped.learnAt?.title || stoppedUnit.title, at: stopped.learnAt ?? null }
				: next ? { type: "next" as const, lectureId: next.id, title: next.title } : null,
			week: week && thisWeek.length ? { week, lectureIds: thisWeek.map((u) => u.id) } : null,
			lectures: units.map((u) => ({ id: u.id, title: u.title, week: u.week })),
			topics,
		};
	}

	/**
	 * Start Learn (V-47). `{ lectureId }` teaches a lecture; `{ lectureId,
	 * nodes }` one part of it; `{ module, week: true }` that module's
	 * lectures in the current teaching week, in one session. `goal` is what
	 * the student typed or said, handed to the tutor in their words.
	 */
	startLearn(raw: unknown, opts: { minutes?: number; kind?: SessionKind; firstQuestionId?: string; nudgeKey?: string } = {}): { sessionId: string } {
		const r = (raw ?? {}) as { lectureId?: unknown; module?: unknown; week?: unknown; goal?: unknown; nodes?: unknown };
		let goal: string | undefined;
		if (r.goal !== undefined) {
			if (typeof r.goal !== "string" || r.goal.length > LEARN_RULES.goalMax) throw badRequest(`goal must be text under ${LEARN_RULES.goalMax} characters`);
			goal = r.goal.replace(/\s+/g, " ").trim() || undefined;
		}
		let lectureIds: string[];
		let scope: LearnScope = "lecture";
		let nodes: string[] | undefined;
		if (r.week === true) {
			if (typeof r.module !== "string") throw badRequest("module is required for this week");
			const mod = this.requireModule(r.module);
			const { week } = currentWeek(mod, this.now());
			lectureIds = week ? this.learnUnits(mod.code).filter((u) => u.week === week).map((u) => u.id) : [];
			if (lectureIds.length === 0) throw new CompanionError("nothing_this_week", 409, LEARN_COPY.nothingThisWeek);
			if (lectureIds.length > 1) scope = "week";
		} else {
			if (typeof r.lectureId !== "string") throw badRequest("lectureId is required");
			const lecture = this.lectureById(assertSafeId(r.lectureId, "lecture id"));
			if (!lecture) throw notFound("lecture");
			if (!lecture.hasMaterials) throw new CompanionError("no_material", 409, LEARN_COPY.nothingToLearn);
			lectureIds = [lecture.id];
			if (r.nodes !== undefined) {
				if (!Array.isArray(r.nodes) || r.nodes.length > 10 || !r.nodes.every((n) => typeof n === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(n))) throw badRequest("nodes must be up to 10 concept-map node ids");
				if (r.nodes.length) {
					nodes = [...(r.nodes as string[])];
					scope = "section";
				}
			}
		}
		const minutes = opts.minutes ?? this.learnMinutes();
		const spec: SessionSpec = {
			kind: opts.kind ?? "learn",
			lectureId: lectureIds[0]!,
			mode: "question-first",
			budget: { questions: 0, minutes },
			study: "learn",
			learn: { scope, minutes, ...(goal ? { goal } : {}), ...(scope === "week" ? { lectureIds } : {}) },
			...(nodes ? { nodes } : {}),
			...(opts.firstQuestionId ? { firstQuestionId: opts.firstQuestionId } : {}),
		};
		return this.createSession(spec, { ...(opts.nudgeKey ? { nudgeKey: opts.nudgeKey } : {}), askHow: true });
	}

	/**
	 * Say something to the tutor (V-54). With a question open it is answered
	 * beside the question, which stays; while the tutor is writing it is
	 * handed over at its next pause; otherwise it is the student's turn.
	 * `say` sends one of LockedIn's own lines (Skip, Looks good, Carry on).
	 */
	async say(id: string, raw: unknown): Promise<{ queued: boolean; answer: string | null }> {
		const { session, engine } = this.requireSession(id);
		if (!session.spec.learn || !engine.say) throw conflict("not_learn", "only a Learn session takes a message");
		if (session.state === "error") throw conflict("session_error", "this session failed; start a new one or retry");
		const r = (raw ?? {}) as { text?: unknown; say?: unknown; questionId?: unknown };
		const preset = typeof r.say === "string" && Object.hasOwn(LEARN_SAYS, r.say) ? (r.say as keyof typeof LEARN_SAYS) : null;
		if (r.say !== undefined && !preset) throw badRequest(`say must be one of ${Object.keys(LEARN_SAYS).join(", ")}`);
		const text = preset ? LEARN_SAYS[preset] : typeof r.text === "string" ? r.text.trim() : "";
		if (!text) throw badRequest("say something first");
		if (text.length > LEARN_RULES.sayMax) throw badRequest(`keep it under ${LEARN_RULES.sayMax} characters`);
		const now = this.now();
		const touch = (extra: Partial<CompanionSession> = {}) => this.store.updateSession(id, (s) => ({ ...s, ...extra, lastActivityAt: now.toISOString(), state: s.state === "stopped" || s.state === "ready" ? "active" : s.state }));
		if (!preset && typeof r.questionId === "string" && r.questionId && engine.ask) {
			const { answer } = await engine.ask(session, r.questionId, text);
			if (answer) this.store.updateSession(id, (s) => ({ ...s, asides: [...(s.asides ?? []), { questionId: r.questionId as string, ask: text, answer, at: now.toISOString() }] }));
			touch();
			this.log("learn_said", { sessionId: id, how: answer ? "beside" : "message", chars: text.length });
			return { queued: false, answer };
		}
		const { queued } = await engine.say(session, text);
		touch();
		this.log("learn_said", { sessionId: id, how: preset ?? (queued ? "queued" : "message"), chars: preset ? 0 : text.length });
		return { queued, answer: null };
	}

	/** "Finish" (step 5): the student's own decision. A Learn session is never ended for them. */
	finish(id: string): void {
		const { session, engine } = this.requireSession(id);
		if (session.state === "done") return;
		const now = this.now();
		this.store.updateSession(id, (s) => ({ ...s, state: "done", endedAt: now.toISOString() }));
		this.log("session_done", { sessionId: id, answered: session.answered, budget: session.budget, endedEarly: false, engine: session.engine, cost: engine.cost(session), ...(session.learnAt ? { idea: session.learnAt.index, ideas: session.learnAt.total } : {}) });
		this.noteWhere(id);
	}

	/** Every step of a Learn session so far ("Earlier"), oldest first. */
	steps(id: string): { steps: LearnItem[][] } {
		const { session, engine } = this.requireSession(id);
		if (!session.spec.learn || !engine.steps || !session.chatId) return { steps: [] };
		return { steps: engine.steps(session) };
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
		if (session.state === "error" && !session.readyAt) {
			// Started, but question 1 never arrived (T-1): recover the turn, or keep
			// waiting for one that is still running, then wait for question 1 again.
			try {
				await engine.retry(session);
			} catch (err) {
				if (!(err instanceof CompanionError && err.code === "turn_running")) throw err;
			}
			const waiting = this.store.updateSession(id, (s) => ({ ...s, state: "preparing", error: undefined }))!;
			const started = Date.now();
			const run = this.untilReady(waiting, engine, started)
				.catch((err) => this.prepareFailed(waiting, err))
				.finally(() => this.preparing.delete(id));
			this.preparing.set(id, run);
			return;
		}
		await engine.retry(session);
		this.store.updateSession(id, (s) => ({ ...s, state: s.openedAt ? "active" : "ready", error: undefined }));
	}

	/** A failed session can offer the lecture's own question bank instead (T-6). */
	private canPractise(session: CompanionSession): boolean {
		return session.engine !== "scripted" && !!this.deps.engines.scripted && this.safeHasScripted(session.spec.lectureId);
	}

	/**
	 * "Use practice questions" on a failed session: the same session spec on
	 * the lecture's question bank, without the AI. The student chose it, and
	 * the session screen labels it, so the switch is declared (B-11).
	 */
	practiceInstead(id: string): { sessionId: string } {
		const { session } = this.requireSession(id);
		if (session.state !== "error" && !session.error) throw conflict("session_not_failed", "this session is working: carry on with it");
		if (!this.canPractise(session)) throw new CompanionError("no_scripted_set", 422, "there are no practice questions for this lecture yet");
		const { seedAnswer: _seed, ...spec } = this.asPractise(session.spec);
		const next = this.createSession(spec, { engine: "scripted" });
		this.store.updateSession(next.sessionId, (s) => ({ ...s, fellBackFrom: session.engine }));
		this.log("engine_fallback", { sessionId: next.sessionId, from: session.engine, to: "scripted", code: session.error ?? null, chosen: true, failedSessionId: id });
		if (session.state !== "done" && session.state !== "stopped") this.store.updateSession(id, (s) => ({ ...s, state: "stopped", endedAt: this.now().toISOString() }));
		return next;
	}

	sessionCost(id: string) {
		const { session, engine } = this.requireSession(id);
		return { sessionId: id, engine: session.engine, cost: engine.cost(session) };
	}

	// ─── progress and today (§7.8) ──────────────────────────────────────────

	/** The ideas in each unit's study pack: what the steady-pace line counts, and what a point's detail names. */
	private packIdeas(): PackIdea[] {
		const out: PackIdea[] = [];
		for (const l of this.store.lectures()) {
			if (!l.hasMaterials) continue;
			const parsed = parseMermaidPlan(this.content.conceptMapSource(l.id) ?? "");
			if (!parsed.ok || !parsed.plan) continue;
			for (const n of parsed.plan.nodes) out.push({ lectureId: l.id, nodeId: n.id, title: splitNodeLabel(n.title || n.id).title });
		}
		return out;
	}

	/**
	 * Progress (v1.1, V-34 to V-36): the learning score over this week, the
	 * last month and the term, against the steady-pace line; what each module
	 * contributed; what needs attention, each with one action; and the
	 * milestones earned. All worked out from the event log and the blocks, so
	 * past work counts from the first day.
	 */
	progress() {
		const profile = this.requireProfile();
		const now = this.now();
		const state = this.store.state();
		const events = this.store.events();
		const live = this.store.lectures();
		const ideas = this.packIdeas();
		const banks = new Map<string, Map<string, QuestionInfo>>();
		const questionInfo = (questionId: string, lectureId: string) => {
			if (!banks.has(lectureId)) banks.set(lectureId, new Map((this.packs?.bank(lectureId) ?? []).map((q) => [q.id, { difficulty: q.difficulty, nodeId: q.node }])));
			return banks.get(lectureId)!.get(questionId);
		};
		// History on a unit since removed still counts, so the module lookup covers archived units too.
		const replay = replayScore({ events, blocks: state.blocks, lectures: this.store.allLectures(), ideas, questionInfo, now });
		const ends = live.filter(isTimed).map((l) => new Date(l.end).getTime());
		const term = termFor(replay, { ideas, lastLecture: ends.length ? new Date(Math.max(...ends)) : null, now });

		const modules = profile.modules.map((m) => ({ code: m.code, name: m.name, hasMaterial: live.some((l) => l.module === m.code && l.hasMaterials) }));
		// Earned milestones are written down the first time, so one earned is never lost.
		const kept = this.store.milestones();
		const computed = earnedMilestones({ replay, events, blocks: state.blocks, ideas, modules, now });
		let changed = false;
		for (const [id, at] of Object.entries(computed)) {
			if (!kept[id] && at) {
				kept[id] = at.toISOString();
				changed = true;
				this.log("milestone_earned", { milestone: id, earnedAt: kept[id] });
			}
		}
		if (changed) this.store.saveMilestones(kept);
		const milestones = MILESTONES.map((m) => ({ ...m, earnedAt: kept[m.id] ?? null }));

		const series = Object.fromEntries(
			(["week", "month", "term"] as const).map((range) => [
				range,
				scoreSeries(replay, term, range, now).map((p) => ({
					...p,
					// A milestone belongs to the day (or week) it was earned in.
					milestones: milestones.filter((m) => m.earnedAt && dateKey(new Date(m.earnedAt)) >= p.date && dateKey(new Date(m.earnedAt)) <= p.end).map((m) => m.id),
				})),
			]),
		) as Record<ScoreRange, (ScorePoint & { milestones: string[] })[]>;

		const weekStart = startOfWeek(now);
		const ranges = { week: weekStart, month: addDays(now, -30), term: term.start };
		const until = new Date(now.getTime() + 1);
		const shares = Object.fromEntries((["week", "month", "term"] as const).map((r) => [r, moduleShares(replay, modules.map((m) => m.code), ranges[r], until)])) as Record<ScoreRange, ModuleShare[]>;

		const titleOf = new Map(live.map((l) => [l.id, l.title]));
		const nameOf = new Map(modules.map((m) => [m.code, m.name]));
		const unitsOf = (code: string) => lecturesWithStatus(state).filter((l) => l.module === code && l.hasMaterials);
		const questions = SESSION_BUDGETS["post-lecture"].questions;
		const attention = needsAttention({ replay, modules, now }).flatMap((item): AttentionLine[] => {
			if (item.kind === "module") {
				// The unit the pacing rule would study next in that module.
				const units = unitsOf(item.module);
				const next = pacedUnits({ modules: profile.modules.filter((m) => m.code === item.module), units, now, blocks: 1 })[0]?.lectureId ?? units[0]?.id;
				if (!next) return [];
				const name = nameOf.get(item.module) ?? item.module;
				return [{ kind: item.kind, module: item.module, text: item.daysSince === undefined ? PROGRESS_COPY.leastOn(name) : PROGRESS_COPY.nothingOn(name, item.daysSince), action: { label: PROGRESS_COPY.questionsOn(questions, titleOf.get(next) ?? name), session: { kind: "post-lecture" as const, lectureId: next } } }];
			}
			if (item.kind === "fading") {
				if (!titleOf.has(item.lectureId)) return [];
				return [{ kind: item.kind, module: item.module, text: PROGRESS_COPY.fading(item.count, nameOf.get(item.module) ?? item.module), action: { label: PROGRESS_COPY.getBack(item.count), session: { kind: "post-lecture" as const, lectureId: item.lectureId, ...(item.nodes.length ? { nodes: item.nodes.slice(0, 10) } : {}) } } }];
			}
			return [{ kind: item.kind, module: null, text: PROGRESS_COPY.noMaterial(item.modules.map((c) => nameOf.get(c) ?? c)), action: { label: PROGRESS_COPY.addMaterial, href: "/app/library" } }];
		});

		const securedIdeas = [...replay.ideas.values()].filter((i) => i.secured);
		return {
			score: {
				now: scoreAt(replay, now),
				weekChange: scoreAt(replay, now) - scoreAt(replay, new Date(weekStart.getTime() - 1)),
				series,
				term: { start: term.start.toISOString(), end: term.end.toISOString(), target: term.target },
				ideasSecured: securedIdeas.length,
				ideasTotal: ideas.length,
				fading: fadingAt(replay, now).length,
			},
			// What a point's detail names: each idea's title and its unit.
			// An idea outside the pack's map (the teacher's own plan, or a unit with no map): its slug in words, or the unit's title.
			ideas: Object.fromEntries(
				[...replay.ideas.values()].map((i) => {
					const inPack = ideas.find((x) => x.lectureId === i.lectureId && x.nodeId === i.nodeId)?.title;
					const fallback = i.nodeId === "(general)" ? (titleOf.get(i.lectureId) ?? "") : i.nodeId.replace(/[-_]+/g, " ");
					return [i.key, { title: inPack ?? fallback, unit: titleOf.get(i.lectureId) ?? "", module: i.module }];
				}),
			),
			modules: modules.map((m) => ({
				...m,
				lastActivity: shares.term.find((x) => x.module === m.code)?.lastActivity?.toISOString() ?? null,
				shares: Object.fromEntries((["week", "month", "term"] as const).map((r) => [r, { points: shares[r].find((x) => x.module === m.code)?.points ?? 0, minutes: shares[r].find((x) => x.module === m.code)?.minutes ?? 0 }])) as Record<ScoreRange, { points: number; minutes: number }>,
			})),
			attention,
			milestones,
			// Today's "this week" line still reads these.
			week: weekSummary(state, now),
			welcomeBack: welcomeBack(state, now),
		};
	}

	today() {
		void this.refreshCalendarIfDue();
		const now = this.now();
		const state = this.store.state();
		const firstRun = state.sessions.every((s) => !s.openedAt);
		const tryNow = firstRun ? tryNowLecture(state, now) : undefined;
		const todays = lecturesWithStatus(state).filter((l) => !!l.start && sameDay(l.start, now));
		const resume = resumableSession(state.sessions, now);
		const resumeLecture = resume ? this.lectureById(resume.spec.lectureId) : undefined;
		const nextBlock = (() => {
			{
				const c = this.nextBlockOf(state, now);
				if (c) {
					const b = state.blocks.find((x) => x.id === c.id);
					const first = b ? this.firstStepOf(b) : null;
					// Today's block can be started from Today (V-44).
					return {
						blockId: c.id, start: c.start.toISOString(), end: c.end.toISOString(), status: b?.status ?? "accepted", canStart: !!b && canStartBlock(b, now), firstStep: first ? PLAN_COPY.firstStep(first.slide) : null, mode: b ? this.blockButtons(b) : null,
						// The block's panel on Today is in its module's colour (v3.0).
						module: b?.module ?? (b?.lectureId ? this.lectureById(b.lectureId)?.module : undefined) ?? null, minutes: b?.minutes ?? null,
					};
				}
			}
			return null;
		})();
		// What was done on the phone today (v2.3 part D): one quiet line, counts and module names only.
		const phone = phoneToday(this.store.events(), state.lectures, now);
		const onPhone = TODAY_COPY.onPhone(phone.questions, phone.modules.map((code) => state.profile?.modules.find((m) => m.code === code)?.name ?? code));
		return {
			onPhone,
			now: now.toISOString(),
			// A profile made by setup isn't set up until setup's end is reached (V-45).
			onboarded: !!state.profile && !this.inSetup(state.profile),
			tryNow: tryNow ? { lectureId: tryNow.id, title: tryNow.title, module: tryNow.module, spec: specFor("try-now", tryNow.id, state.profile?.prefs) } : null,
			lectures: todays,
			nextBlock,
			// Ideas with a gap (V-39), not missed questions: several questions on one idea are one thing to revisit.
			readyToRevisit: gapsByIdea(state.misses, []).length,
			welcomeBack: welcomeBack(state, now),
			banner: this.banner(),
			// The waiting question's module, for the colour of its panel (v3.0).
			bannerModule: (() => { const id = this.banner()?.lectureId; return id ? (this.lectureById(id)?.module ?? null) : null; })(),
			phonePaired: this.phone?.paired() ?? false,
			phoneAvailable: this.phone !== null,
			activeSession: resume?.id ?? null,
			// A session that was left, to pick up (R-5). Sent whole, so Today need not open the session to describe it.
			resume: resume && resumeLecture
				? {
						sessionId: resume.id,
						module: resumeLecture.module,
						title: resumeLecture.title,
						study: (resume.spec.study ?? "learn") as StudyMode,
						// A Learn session is placed by its plan, not by a question count.
						answered: resume.spec.learn ? Math.max(0, (resume.learnAt?.index ?? 1) - 1) : resume.answered,
						budget: resume.spec.learn ? Math.max(1, resume.learnAt?.total ?? 1) : resume.budget,
						text: resume.spec.learn
							? LEARN_COPY.savedAt(resume.learnAt)
							: `${SESSION_COPY.savedAt(resume.answered + 1)} ${SESSION_COPY.left(resume.budget - resume.answered, (resume.budget - resume.answered) * RESUME_RULES.minutesPerQuestion)}.`,
					}
				: null,
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
