/**
 * Laptop ↔ relay sync (v0.1 F-112, spec §5.2). Pure: what the laptop
 * uploads, and how phone events are replayed. Single writer per kind:
 * the laptop writes the schedule (versions only go up), the phone writes
 * events (each replayed exactly once, in order); plan edits from two
 * devices are last-write-wins per block, and an edit to a block the laptop
 * has since removed is ignored and logged.
 */

import type { NudgeQuestion, ScheduledNudge } from "./nudges.ts";
import type { StudyBlock } from "./types.ts";

export interface PhoneEvent {
	id: string;
	at: string;
	type: string;
	payload: Record<string, unknown> & { nudgeId?: string };
}

/** What the phone shows for a block (v2.1 part B), worked out on the laptop: the phone needs no laptop when the block starts. */
export interface PhoneBlockLines {
	/** "5 questions, about 10 min" */
	goal: string;
	/** "open slide 12, answer one question" */
	firstStep: string | null;
	/** "open Lecture 7 at slide 12 on your laptop and answer one question." */
	onLaptop: string | null;
	/** "because you have energy in the afternoon", or null for a block the student placed. */
	why: string | null;
	/** Where "Not now" can move it: later today, this evening, tomorrow, and the next free gap. */
	moves: { kind: "today" | "evening" | "tomorrow" | "next"; date: string; start: string; label: string }[];
	/** "On the move" (v2.2 part C): up to five questions from the block's unit, so they can be answered on the phone with the laptop closed. Only on blocks that are near. */
	round?: NudgeQuestion[];
}

/** The week on the phone (v2.1 part C; lo-fi task 3): the lectures shown between the blocks, the free times a block can move to, and the nudges setting. */
export interface PhoneWeek {
	lectures: { date: string; start: string; title: string }[];
	free: { date: string; start: string }[];
	nudgesPerDay: 0 | 1 | 2;
	/** A new block's length. */
	blockMinutes: number;
}

/** The upload body (relay PUT /schedule). */
export interface RelaySchedule {
	version: number;
	timeZone: string;
	nudges: (ScheduledNudge & Record<string, unknown>)[];
	blocks: (Pick<StudyBlock, "id" | "date" | "start" | "minutes" | "status"> & { focus?: { title: string; module: string } | null } & Partial<PhoneBlockLines>)[];
	/** v2.1 part C: what the phone's week screen needs beside the blocks. Only sent to a relay that knows it. */
	week?: PhoneWeek;
}

/** Versions only go up: the next one is now in ms, or one more than the last if the clock went back. */
export function nextVersion(last: number, nowMs: number): number {
	return Math.max(last + 1, Math.floor(nowMs));
}

/** A content hash for "has anything changed since the last upload?" (stable key order). */
export function scheduleFingerprint(s: Omit<RelaySchedule, "version">): string {
	const text = JSON.stringify(s, (_k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v));
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(16);
}

/** The events still to replay: not seen before, each id once, in the phone's order (timestamp, then arrival). */
export function eventsToReplay(events: readonly PhoneEvent[], replayed: ReadonlySet<string>): PhoneEvent[] {
	const seen = new Set(replayed);
	const out: PhoneEvent[] = [];
	for (const e of events) {
		if (seen.has(e.id)) continue;
		seen.add(e.id);
		out.push(e);
	}
	return out.map((e, i) => ({ e, i })).sort((a, b) => a.e.at.localeCompare(b.e.at) || a.i - b.i).map((x) => x.e);
}

export type PlanEdit = { blockId: string; at: string; change: { status?: StudyBlock["status"]; date?: string; start?: string }; /** "Undo" on the phone (v2.1 part C): brings back a block the phone removed. */ restore?: boolean };

/**
 * Apply phone plan edits to the laptop's blocks: last write wins per block
 * (by time), and an edit to a block that's gone or removed on the laptop is
 * ignored. `lastEditAt` is each block's newest laptop-side change.
 */
export function applyPlanEdits(blocks: readonly StudyBlock[], edits: readonly PlanEdit[], lastEditAt: (blockId: string) => string | undefined): { blocks: StudyBlock[]; ignored: { blockId: string; reason: string }[] } {
	const byId = new Map(blocks.map((b) => [b.id, { ...b }]));
	const ignored: { blockId: string; reason: string }[] = [];
	for (const e of [...edits].sort((a, b) => a.at.localeCompare(b.at))) {
		const b = byId.get(e.blockId);
		// A removed block only comes back by "Undo", and not if the laptop was the one that removed it afterwards.
		if (!b || (b.status === "removed" && !e.restore)) {
			ignored.push({ blockId: e.blockId, reason: b ? "removed on the laptop" : "not on the laptop any more" });
			continue;
		}
		const laptopAt = lastEditAt(e.blockId);
		if (laptopAt && laptopAt > e.at) {
			ignored.push({ blockId: e.blockId, reason: "changed on the laptop later" });
			continue;
		}
		Object.assign(b, e.change);
	}
	return { blocks: blocks.map((b) => byId.get(b.id)!), ignored };
}
