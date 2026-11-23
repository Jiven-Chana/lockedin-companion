/**
 * Course units and the module calendar (v0.1 V-18, spec §5.5, F-104).
 * Pure: the server converts files to pages and asks the AI for a split;
 * these rules decide when the AI is needed, check what it proposes, and
 * work out which teaching week a module is in.
 */

import { addDays, dateKey, startOfWeek } from "./time.ts";
import type { ModuleInfo } from "./types.ts";

/** One page of an uploaded file, as the split sees it. */
export interface UnitPage {
	number: number;
	/** The page's first line or heading ("" when the page has no text). */
	title: string;
	/** How much text the page has (0 = image-only: "no text found"). */
	chars: number;
}

/** A proposed course unit: a run of pages from one file. */
export interface ProposedUnit {
	title: string;
	/** Teaching week, or 0 when the material doesn't say. */
	week: number;
	pages: [number, number];
}

export type ProposalVia = "name" | "ai" | "fallback";

const WEEK_IN_NAME = /(?:^|[^a-z])(?:week|wk|w)[\s_.-]*0?(\d{1,2})(?![\d])/i;
const WEEK_HEADING = /^\s*(?:week|wk)\s*0?(\d{1,2})\b/i;

/** "GT_Week03_nash.pdf" → 3; null when the name carries no week. */
export function weekFromName(name: string): number | null {
	const m = WEEK_IN_NAME.exec(name.replace(/\.[a-z0-9]+$/i, ""));
	if (!m) return null;
	const w = Number(m[1]);
	return w >= 1 && w <= 52 ? w : null;
}

/** A readable unit title from a file name: "GT_Week03_nash-equilibrium.pdf" → "nash equilibrium". */
export function titleFromName(name: string): string {
	const base = name.replace(/\.[a-z0-9]+$/i, "").replace(WEEK_IN_NAME, " ").replace(/[_-]+/g, " ").replace(/\s{2,}/g, " ").trim();
	return base || name;
}

/**
 * Units without an AI call. A file named for one week is one unit. A file
 * whose pages start "Week N" headings splits there. Anything else is one
 * unit with an unknown week, which the AI split can improve on.
 */
export function proposeWithoutAi(file: { name: string; pages: UnitPage[] }): { units: ProposedUnit[]; via: ProposalVia; confident: boolean } {
	const n = Math.max(1, file.pages.length);
	const firstTitle = file.pages.find((p) => p.title)?.title;
	const week = weekFromName(file.name);
	if (week !== null) return { units: [{ title: firstTitle || titleFromName(file.name), week, pages: [1, n] }], via: "name", confident: true };

	const starts = file.pages.map((p) => ({ p, m: WEEK_HEADING.exec(p.title) })).filter((x) => x.m);
	if (starts.length >= 2) {
		const units: ProposedUnit[] = starts.map((x, i) => {
			const from = i === 0 ? 1 : x.p.number;
			const to = i + 1 < starts.length ? starts[i + 1]!.p.number - 1 : n;
			const title = x.p.title.replace(WEEK_HEADING, "").replace(/^[\s:–-]+/, "").trim() || `Week ${x.m![1]}`;
			return { title, week: Number(x.m![1]), pages: [from, to] as [number, number] };
		});
		return { units, via: "name", confident: true };
	}
	return { units: [{ title: firstTitle || titleFromName(file.name), week: 0, pages: [1, n] }], via: "fallback", confident: false };
}

/** Ask the AI to split this file? Only when no rule above was confident and there's enough to split. */
export function wantsAiSplit(file: { name: string; pages: UnitPage[] }, minPages: number): boolean {
	return !proposeWithoutAi(file).confident && file.pages.length >= minPages;
}

/**
 * Check an AI proposal against the file: titles present and short, page
 * ranges inside the file, in order and not overlapping, weeks 0 to 52.
 * Returns a problem for the model to fix, or null.
 */
export function checkProposal(units: readonly ProposedUnit[], pageCount: number): string | null {
	if (units.length === 0) return "propose at least one unit";
	let last = 0;
	for (const [i, u] of units.entries()) {
		if (!u.title?.trim() || u.title.length > 80) return `unit ${i + 1}: the title must be 1 to 80 characters`;
		if (!Number.isInteger(u.week) || u.week < 0 || u.week > 52) return `unit ${i + 1}: week must be 0 (unknown) to 52`;
		const [from, to] = u.pages;
		if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to > pageCount || from > to) return `unit ${i + 1}: pages must be within 1 to ${pageCount}, from ≤ to`;
		if (from <= last) return `unit ${i + 1}: pages overlap or are out of order`;
		last = to;
	}
	return null;
}

/**
 * Notes or pasted text (a Canvas weekly summary) as pages: one page per
 * heading ("# …" or "Week N…" lines), or fixed-size pages when it has
 * none, so the same split and citations work as for a PDF.
 */
export function textToPages(text: string, pageChars: number): { number: number; markdown: string }[] {
	const lines = text.replace(/\r\n?/g, "\n").split("\n");
	const out: string[][] = [];
	for (const line of lines) {
		if ((/^#{1,3}\s+\S/.test(line) || WEEK_HEADING.test(line)) && out.length > 0 && out[out.length - 1]!.some((l) => l.trim())) out.push([line]);
		else (out[out.length - 1] ?? (out.push([]), out[0]!)).push(line);
	}
	const chunks = out.length > 1 ? out.map((p) => p.join("\n").trim()) : chunk(text.trim(), pageChars);
	return chunks.filter(Boolean).map((markdown, i) => ({ number: i + 1, markdown }));
}

function chunk(text: string, size: number): string[] {
	const paras = text.split(/\n{2,}/);
	const out: string[] = [];
	let cur = "";
	for (const p of paras) {
		if (cur && cur.length + p.length > size) {
			out.push(cur);
			cur = "";
		}
		cur = cur ? `${cur}\n\n${p}` : p;
	}
	if (cur) out.push(cur);
	return out;
}

// ─── the module calendar ────────────────────────────────────────────────────

/** Reading weeks that fall before teaching week `week` (a reading week after week 6 is before week 7). */
function readingWeeksBefore(module: Pick<ModuleInfo, "readingWeeks">, week: number): number {
	return (module.readingWeeks ?? []).filter((r) => r < week).length;
}

/**
 * "This is week N": the Monday of teaching week 1, counting back over the
 * reading weeks already passed. `inReadingWeek` means this calendar week is
 * the reading week after teaching week N.
 */
export function weekOneStartFor(now: Date, week: number, readingWeeks: readonly number[] = [], inReadingWeek = false): string {
	const passed = readingWeeks.filter((r) => r < week || (inReadingWeek && r === week)).length;
	const back = week - 1 + passed;
	return dateKey(addDays(startOfWeek(now), -7 * back));
}

export interface ModuleWeek {
	/** The current teaching week (the last one taught, during a reading week), or null when unknown. */
	week: number | null;
	/** This calendar week is a reading week. */
	reading: boolean;
}

/** Which teaching week a module is in now (spec §5.5). Reading weeks don't advance the count. */
export function currentWeek(module: Pick<ModuleInfo, "weekOneStart" | "readingWeeks">, now: Date): ModuleWeek {
	if (!module.weekOneStart) return { week: null, reading: false };
	const [y, m, d] = module.weekOneStart.split("-").map(Number);
	const start = new Date(y!, m! - 1, d!);
	const elapsed = Math.floor((startOfWeek(now).getTime() - startOfWeek(start).getTime()) / (7 * 86_400_000));
	if (elapsed < 0) return { week: null, reading: false };
	// Walk calendar weeks, inserting each reading week after its teaching week.
	let teaching = 1;
	let reading = false;
	const readingAfter = new Set(module.readingWeeks ?? []);
	for (let w = 0; w < elapsed; w++) {
		if (reading) {
			reading = false;
			teaching++;
		} else if (readingAfter.has(teaching)) reading = true;
		else teaching++;
	}
	return { week: teaching, reading };
}

export { readingWeeksBefore };
