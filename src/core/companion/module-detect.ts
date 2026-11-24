/**
 * Modules from a calendar (v0.1 F-101 onboarding, DECISIONS.md V-17): the
 * student connects a calendar first and confirms the modules LockedIn
 * found in its event titles, instead of typing them again. Typing is the
 * fallback when there is no calendar or one is missing.
 *
 * Title formats are messy and vary by source, so this only proposes:
 *   - "… [3GTMDM(4) - Game Theory]"  (Canvas) → code 3GTMDM, Game Theory  (confident)
 *   - "HCI: Personas" / "HCI - Lecture 3"     → code HCI                  (confident)
 *   - "LH Neural Computation (13716)/Lecture" (Birmingham's timetable) → Neural Computation,
 *     one module per number, whatever the activity after "/"           (confident)
 *   - anything else that repeats, with activity words and numbering
 *     stripped ("Organic Chemistry Lecture 2") → Organic Chemistry       (not confident)
 * Confident finds start ticked; the rest start unticked.
 */

import type { IcsEvent } from "./timetable.ts";

export interface DetectedModule {
	code: string;
	name: string;
	/** How many events in the calendar carry it. */
	events: number;
	/** Found by a tag format (ticked by default) rather than by repetition. */
	confident: boolean;
}

/** Codes are what lecture ids, hues and matching use: letters, digits, "-" and "_". */
export const MODULE_CODE_RE = /^[A-Za-z0-9_-]{1,32}$/;

const BRACKET_TAG = /\[\s*([A-Za-z0-9]{2,12})(?:\s*\([^)]*\))?\s*[-–:]\s*([^\]]+?)\s*\]/;
const LEADING_CODE = /^\s*([A-Z][A-Z0-9]{1,9})\s*[:–-]\s*\S/;
/**
 * Birmingham's timetable feed (mybhamtimetable, seen 24 Nov): an optional
 * level prefix (LC, LI, LH, LM), the module name, its number in brackets,
 * then "/" and the activity: "LH Game Theory and Multicriteria Decision
 * Making(12571)/Guided Study".
 */
const SLASH_TAG = /^\s*(?:L[CIHM]\s+)?(.+?)\s*\(\s*(\d{3,7})\s*\)\s*\/\s*(.*?)\s*$/;

export function parseSlashTitle(summary: string): { name: string; id: string; activity: string } | null {
	const m = SLASH_TAG.exec(summary);
	return m && m[1]!.trim().length >= 2 ? { name: m[1]!.trim(), id: m[2]!, activity: m[3]!.trim() } : null;
}

const ACTIVITY = /\b(lectures?|seminars?|tutorials?|labs?|workshops?|practicals?|classes|class|session|week\s*\d+|wk\s*\d+|part\s*\d+|\d+)\b/gi;

/** Initials for a typed module with no code: "Organic Chemistry" → "OC". */
export function codeFromName(name: string, taken: ReadonlySet<string> = new Set()): string {
	const words = name.replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
	let base = (words.length > 1 ? words.map((w) => w[0]!).join("") : (words[0] ?? "MOD").slice(0, 6)).toUpperCase().slice(0, 8) || "MOD";
	if (!/^[A-Z0-9]/.test(base)) base = `M${base}`;
	let code = base;
	for (let n = 2; taken.has(code); n++) code = `${base}${n}`;
	return code;
}

function cleanName(text: string): string {
	return text.replace(ACTIVITY, " ").replace(/[\s:–\-|,()]+$/g, "").replace(/^[\s:–\-|,()]+/g, "").replace(/\s{2,}/g, " ").trim();
}

/** Propose the modules in a calendar's events, most frequent first. */
export function detectModules(events: readonly Pick<IcsEvent, "summary">[]): DetectedModule[] {
	const found = new Map<string, DetectedModule>();
	const repeats = new Map<string, number>();
	const add = (code: string, name: string, confident: boolean) => {
		const key = code.toUpperCase();
		const prev = found.get(key);
		if (prev) {
			prev.events++;
			if (confident && !prev.confident) Object.assign(prev, { confident, name });
			return;
		}
		found.set(key, { code: key, name, events: 1, confident });
	};

	const slashCodes = new Map<string, string>();
	for (const { summary } of events) {
		const slash = parseSlashTitle(summary);
		if (slash) {
			let code = slashCodes.get(slash.id);
			if (!code) {
				code = codeFromName(slash.name, new Set(found.keys()));
				slashCodes.set(slash.id, code);
			}
			add(code, slash.name, true);
			continue;
		}
		const tag = BRACKET_TAG.exec(summary);
		if (tag) {
			add(tag[1]!, tag[2]!.trim(), true);
			continue;
		}
		const lead = LEADING_CODE.exec(summary);
		if (lead) {
			add(lead[1]!, lead[1]!, true);
			continue;
		}
		const name = cleanName(summary);
		if (name.length >= 3) repeats.set(name, (repeats.get(name) ?? 0) + 1);
	}

	const taken = new Set(found.keys());
	for (const [name, count] of repeats) {
		if (count < 2) continue;
		if ([...found.values()].some((m) => m.name.toLowerCase() === name.toLowerCase())) continue;
		const code = codeFromName(name, taken);
		taken.add(code);
		found.set(code, { code, name, events: count, confident: false });
	}

	return [...found.values()].sort((a, b) => Number(b.confident) - Number(a.confident) || b.events - a.events || a.name.localeCompare(b.name));
}
