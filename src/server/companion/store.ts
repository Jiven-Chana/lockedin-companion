/**
 * The companion store (plan §7.2): one folder per data directory,
 * `${LH_DATA_DIR}/companion/`. JSON documents are replaced atomically
 * (LearnHarness's temp-file-and-rename helper); logs are append-only JSONL.
 *
 * Like LearnHarness this is single-user and single-process: one server per
 * data directory. Every method is synchronous, so a read-modify-write never
 * interleaves with another request inside the process.
 */

import fs from "node:fs";
import path from "node:path";
import { writeFileAtomicSync } from "../../store/atomic-write.ts";
import type {
	CompanionSession,
	CompanionState,
	EngineName,
	EventLogEntry,
	Lecture,
	Miss,
	NudgeRecord,
	Profile,
	StudyBlock,
} from "../../core/companion/types.ts";
import { badRequest } from "./errors.ts";
import { migrateAppearance } from "../../core/companion/palette.ts";

export interface DemoState {
	/** Demo clock offset from real time. */
	clockOffsetMs: number;
	participant?: string;
	/** Engine for the next sessions, set from the facilitator panel. */
	engineOverride?: EngineName;
}

export interface RuntimeState {
	/** Question ids already sent as test questions, so each test is a different one while the packs have more. */
	phoneTestQuestions?: string[];
	/** Whether the student's AI was ready when last checked, so `engine_ready` is logged on a change, not on every restart. */
	aiReady?: boolean;
	/** The firm/gentle lock's "let me through" window. */
	lockOverrideUntil?: string;
	/** A subscribed calendar link (F-03); stays on this laptop. */
	calendarUrl?: string;
	/** When the subscribed link was last read (F-108: refreshed on open and every 6 hours). */
	calendarRefreshedAt?: string;
	/** The phone link (F-112, spec §7 runtime). The secrets stay on this laptop. */
	pairId?: string;
	laptopSecret?: string;
	phoneToken?: string;
	eventCursor?: number;
	scheduleVersion?: number;
	scheduleFingerprint?: string;
	scheduleUploadedAt?: string;
	eventsPulledAt?: string;
	/** Phone event ids already replayed (dedupe, §5.2 item 3). */
	replayedPhoneEvents?: string[];
	/** Facilitator "send a question to the phone now": kept in every upload until it expires (real time). */
	phoneNowNudge?: Record<string, unknown> & { id: string; expiresAt: string };
}

const FILES = {
	profile: "profile.json",
	lectures: "lectures.json",
	blocks: "blocks.json",
	sessions: "sessions.json",
	misses: "misses.json",
	nudges: "nudges.jsonl",
	events: "events.jsonl",
	demo: "demo.json",
	runtime: "runtime.json",
} as const;

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;

export function assertSafeId(id: string, what = "id"): string {
	if (!ID_RE.test(id)) throw badRequest(`invalid ${what}`);
	return id;
}

export class CompanionStore {
	constructor(readonly dir: string) {}

	private path(name: string): string {
		return path.join(/* turbopackIgnore: true */ this.dir, name);
	}

	private readJson<T>(name: string, fallback: T): T {
		try {
			return JSON.parse(fs.readFileSync(/* turbopackIgnore: true */ this.path(name), "utf-8")) as T;
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === "ENOENT") return fallback;
			// A corrupt document must never be silently replaced: keep it and fail loudly.
			throw new Error(`companion store: cannot read ${name}: ${(err as Error).message}`);
		}
	}

	private writeJson(name: string, value: unknown): void {
		fs.mkdirSync(/* turbopackIgnore: true */ this.dir, { recursive: true });
		writeFileAtomicSync(/* turbopackIgnore: true */ this.path(name), `${JSON.stringify(value, null, "\t")}\n`);
	}

	private readJsonl<T>(name: string): T[] {
		let text: string;
		try {
			text = fs.readFileSync(/* turbopackIgnore: true */ this.path(name), "utf-8");
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
			throw err;
		}
		const out: T[] = [];
		for (const line of text.split("\n")) {
			if (!line.trim()) continue;
			try {
				out.push(JSON.parse(line) as T);
			} catch {
				// A torn final line from a crash mid-append: skip it.
			}
		}
		return out;
	}

	private appendJsonl(name: string, value: unknown): void {
		fs.mkdirSync(/* turbopackIgnore: true */ this.dir, { recursive: true });
		fs.appendFileSync(/* turbopackIgnore: true */ this.path(name), `${JSON.stringify(value)}\n`, "utf-8");
	}

	// ─── documents ──────────────────────────────────────────────────────────

	profile(): Profile | null {
		const p = this.readJson<Profile | null>(FILES.profile, null);
		// v0.0 profiles have appearance.reduceMotion instead of motion (F-118).
		return p ? { ...p, appearance: migrateAppearance(p.appearance ?? {}) as Profile["appearance"] } : null;
	}
	saveProfile(p: Profile): void {
		this.writeJson(FILES.profile, p);
	}

	/** Lectures and course units in use: archived ones (gone from the calendar, removed units) are hidden. */
	lectures(): Lecture[] {
		return this.allLectures().filter((l) => !l.archived);
	}
	/** Every record, archived ones included (history, merges). */
	allLectures(): Lecture[] {
		return this.readJson<Lecture[]>(FILES.lectures, []);
	}
	/** Replaces the whole list: pass allLectures()-based lists so archived records survive. */
	saveLectures(l: Lecture[]): void {
		this.writeJson(FILES.lectures, l);
	}
	updateLecture(id: string, fn: (l: Lecture) => Lecture): Lecture | null {
		const all = this.allLectures();
		const i = all.findIndex((l) => l.id === id);
		if (i < 0) return null;
		all[i] = fn(all[i]!);
		this.saveLectures(all);
		return all[i]!;
	}

	/** Dated blocks (v0.1 F-110). v0.0's weekly slots (no date, never had a screen) are dropped on read. */
	blocks(): StudyBlock[] {
		return this.readJson<StudyBlock[]>(FILES.blocks, []).filter((b) => typeof b.date === "string" && typeof b.status === "string");
	}
	saveBlocks(b: StudyBlock[]): void {
		this.writeJson(FILES.blocks, b);
	}

	sessions(): CompanionSession[] {
		return this.readJson<CompanionSession[]>(FILES.sessions, []);
	}
	session(id: string): CompanionSession | null {
		return this.sessions().find((s) => s.id === id) ?? null;
	}
	saveSession(s: CompanionSession): void {
		const all = this.sessions();
		const i = all.findIndex((x) => x.id === s.id);
		if (i >= 0) all[i] = s;
		else all.push(s);
		this.writeJson(FILES.sessions, all);
	}
	updateSession(id: string, fn: (s: CompanionSession) => CompanionSession): CompanionSession | null {
		const all = this.sessions();
		const i = all.findIndex((x) => x.id === id);
		if (i < 0) return null;
		all[i] = fn(all[i]!);
		this.writeJson(FILES.sessions, all);
		return all[i]!;
	}

	misses(): Miss[] {
		return this.readJson<Miss[]>(FILES.misses, []);
	}
	saveMisses(m: Miss[]): void {
		this.writeJson(FILES.misses, m);
	}

	// ─── nudges: append-only, last record per id wins ───────────────────────

	nudges(): NudgeRecord[] {
		const byId = new Map<string, NudgeRecord>();
		for (const n of this.readJsonl<NudgeRecord>(FILES.nudges)) byId.set(n.id, n);
		return [...byId.values()].sort((a, b) => a.firedAt.localeCompare(b.firedAt));
	}
	nudge(id: string): NudgeRecord | null {
		return this.nudges().find((n) => n.id === id) ?? null;
	}
	appendNudge(n: NudgeRecord): void {
		this.appendJsonl(FILES.nudges, n);
	}

	// ─── event log ──────────────────────────────────────────────────────────

	appendEvent(e: EventLogEntry): void {
		this.appendJsonl(FILES.events, e);
	}
	events(): EventLogEntry[] {
		return this.readJsonl<EventLogEntry>(FILES.events);
	}

	// ─── demo + runtime ─────────────────────────────────────────────────────

	demo(): DemoState {
		return { clockOffsetMs: 0, ...this.readJson<Partial<DemoState>>(FILES.demo, {}) };
	}
	saveDemo(patch: Partial<DemoState>): DemoState {
		const next = { ...this.demo(), ...patch };
		this.writeJson(FILES.demo, next);
		return next;
	}
	runtime(): RuntimeState {
		return this.readJson<RuntimeState>(FILES.runtime, {});
	}
	saveRuntime(patch: Partial<RuntimeState>): void {
		this.writeJson(FILES.runtime, { ...this.runtime(), ...patch });
	}

	// ─── materials ──────────────────────────────────────────────────────────

	materialsDir(lectureId: string): string {
		return path.join(/* turbopackIgnore: true */ this.dir, "materials", assertSafeId(lectureId, "lecture id"));
	}

	state(): CompanionState {
		return {
			profile: this.profile(),
			lectures: this.lectures(),
			blocks: this.blocks(),
			sessions: this.sessions(),
			misses: this.misses(),
			nudges: this.nudges(),
		};
	}

	/**
	 * Delete the student's data. Facilitator state (demo clock, participant)
	 * survives unless `everything`. With `archiveEvents` the event log is
	 * moved to archive/ first (facilitator resets between participants must
	 * never lose T23 data); without it the log is deleted (the student's
	 * "delete all my data").
	 */
	wipe(opts: { everything?: boolean; keepMaterials?: boolean; archiveEvents?: boolean } = {}): string | null {
		if (!fs.existsSync(/* turbopackIgnore: true */ this.dir)) return null;
		let archived: string | null = null;
		const events = this.path(FILES.events);
		if (opts.archiveEvents && fs.existsSync(/* turbopackIgnore: true */ events) && fs.statSync(/* turbopackIgnore: true */ events).size > 0) {
			const dir = path.join(/* turbopackIgnore: true */ this.dir, "archive");
			fs.mkdirSync(/* turbopackIgnore: true */ dir, { recursive: true });
			const who = this.demo().participant ?? "unassigned";
			archived = path.join(/* turbopackIgnore: true */ dir, `events-${new Date().toISOString().replace(/[:.]/g, "-")}-${who}.jsonl`);
			fs.renameSync(/* turbopackIgnore: true */ events, archived);
		}
		for (const entry of fs.readdirSync(/* turbopackIgnore: true */ this.dir)) {
			if (!opts.everything && entry === FILES.demo) continue;
			if (opts.keepMaterials && entry === "materials") continue;
			if (opts.archiveEvents && entry === "archive") continue;
			fs.rmSync(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ this.dir, entry), { recursive: true, force: true });
		}
		return archived;
	}
}
