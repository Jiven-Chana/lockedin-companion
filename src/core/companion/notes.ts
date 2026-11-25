/**
 * What LockedIn knows about you (v2.0 step 6; V-52, V-53). Pure rules for
 * the per-module notes: the first-time card's taps as a sentence the
 * student can read and the tutor can follow, the caps, "the same as my
 * other modules", and the lines the tutor is handed at the start of a
 * session.
 */

import { HOW_ROWS, NOTE_RULES } from "./policy.ts";
import type { HowPrefs, ModuleNotes } from "./types.ts";

export const wordCount = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;

/** Cut a note to its cap, on a word. */
export function capWords(text: string, max: number): string {
	const words = text.trim().split(/\s+/).filter(Boolean);
	return words.length <= max ? text.trim() : `${words.slice(0, max).join(" ")}…`;
}

/** Only the taps the card offers, and a trimmed line. Anything else is dropped. */
export function cleanPrefs(raw: unknown): HowPrefs {
	const r = (raw ?? {}) as Record<string, unknown>;
	const out: HowPrefs = {};
	for (const row of HOW_ROWS) {
		const v = r[row.key];
		if (row.options.some((o) => o.value === v)) (out as Record<string, unknown>)[row.key] = v;
	}
	if (typeof r.more === "string" && r.more.trim()) out.more = r.more.replace(/\s+/g, " ").trim().slice(0, NOTE_RULES.moreMax);
	return out;
}

/** The "how you learn it" note from the card: one short sentence per tap, then the student's own line. Empty when nothing was chosen. */
export function howNote(prefs: HowPrefs): string {
	const parts: string[] = [];
	for (const row of HOW_ROWS) {
		const picked = row.options.find((o) => o.value === prefs[row.key]);
		if (picked) parts.push(picked.says);
	}
	if (prefs.more) parts.push(/[.!?]$/.test(prefs.more) ? prefs.more : `${prefs.more}.`);
	return capWords(parts.join(" "), NOTE_RULES.howWords);
}

/** Does this module still owe its first-time card? */
export const owesHowCard = (notes: Readonly<Record<string, ModuleNotes>>, module: string): boolean => notes[module]?.asked !== true;

/** "The same as my other modules": the newest "how you learn it" note from another module, if there is one. */
export function howFromOthers(notes: Readonly<Record<string, ModuleNotes>>, module: string): NonNullable<ModuleNotes["how"]> | null {
	const others = Object.entries(notes).filter(([code, n]) => code !== module && !!n.how?.text).map(([, n]) => n.how!);
	others.sort((a, b) => b.at.localeCompare(a.at));
	return others[0] ?? null;
}

export interface TutorNotes {
	how?: string;
	where?: string;
	/** The last session's plan and where it stopped, in one line. */
	last?: string;
}

/** The notes as the tutor reads them, in the session's first message. Nothing when there is nothing to say. */
export function notesForTutor(n: TutorNotes): string[] {
	const lines: string[] = [];
	if (n.how?.trim()) lines.push(`How I like to learn it: ${capWords(n.how.replace(/\s+/g, " "), NOTE_RULES.howWords)}`);
	if (n.where?.trim()) lines.push(`Where I am: ${capWords(n.where.replace(/\s+/g, " "), NOTE_RULES.whereWords)}`);
	if (n.last?.trim()) lines.push(`Last session: ${n.last.replace(/\s+/g, " ").trim()}`);
	return lines.length ? ["", "ABOUT ME IN THIS MODULE (notes the app keeps; I can see and edit them)", ...lines] : [];
}
