/**
 * Timetables (plan §7.4): the labelled sample week (the MVP default) and a
 * minimal `.ics` import (stretch, cut-list item 1). The importer is
 * dependency-free on purpose: weekly RRULEs, UTC/floating/TZID times, no
 * all-day events. That covers a university timetable export; anything it
 * cannot map is returned as `unmapped` for the mapping screen.
 */

import { addDays, atTime, dateKey, formatHM, isoWeekday, parseHM, startOfWeek } from "./time.ts";
import type { Lecture } from "./types.ts";

// ─── the sample timetable ───────────────────────────────────────────────────

export interface SampleSlot {
	weekday: number;
	start: string;
	end: string;
}

export interface SampleTimetable {
	label: string;
	/** The teaching week that contains "today" when the timetable is read. */
	currentWeek: number;
	modules: { code: string; name: string }[];
	/** Each module's weekly lecture slot. */
	slots: Record<string, SampleSlot>;
	/** Lectures in course order per module. A lecture may override its slot. */
	lectures: ({ id: string; module: string; title: string; week: number } & Partial<SampleSlot>)[];
	/** Weekly commitments without material (labs, seminars): they block nudges. */
	events?: ({ title: string; module?: string } & SampleSlot)[];
	/** Facilitator presets (§7.10). */
	scenarios?: Record<string, SampleScenario>;
}

export interface SampleScenario {
	description: string;
	/** Where to put the demo clock: ISO weekday of the current week + time. */
	clock: { weekday: number; time: string };
	/** Lecture ids to mark "I wasn't there". */
	missed?: string[];
	/** Pretend the student was last active this many days ago (J6). */
	lastActiveDaysAgo?: number;
	nudgesPerDay?: 1 | 2;
}

function slug(s: string): string {
	return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Put the sample's lectures on real dates, relative to the week containing `now`. */
export function materializeSampleTimetable(
	sample: SampleTimetable,
	now: Date,
	opts: { modules?: string[]; hasMaterials?: (lectureId: string) => boolean } = {},
): Lecture[] {
	const monday = startOfWeek(now);
	const wanted = opts.modules && opts.modules.length > 0 ? new Set(opts.modules) : null;
	const dayOf = (week: number, weekday: number) => addDays(monday, 7 * (week - sample.currentWeek) + weekday - 1);
	const out: Lecture[] = [];
	const orderByModule = new Map<string, number>();
	const weeks = new Set<number>();
	for (const l of sample.lectures) {
		if (wanted && !wanted.has(l.module)) continue;
		const slot = { ...sample.slots[l.module], ...pickSlot(l) } as Partial<SampleSlot>;
		if (slot.weekday === undefined || !slot.start || !slot.end) throw new Error(`sample lecture ${l.id} has no slot`);
		const day = dayOf(l.week, slot.weekday);
		const order = (orderByModule.get(l.module) ?? 0) + 1;
		orderByModule.set(l.module, order);
		weeks.add(l.week);
		out.push({
			id: l.id,
			module: l.module,
			title: l.title,
			week: l.week,
			order,
			start: atTime(day, slot.start).toISOString(),
			end: atTime(day, slot.end).toISOString(),
			kind: "lecture",
			hasMaterials: opts.hasMaterials?.(l.id) ?? false,
		});
	}
	for (const e of sample.events ?? []) {
		if (wanted && e.module && !wanted.has(e.module)) continue;
		for (const week of weeks) {
			const day = dayOf(week, e.weekday);
			out.push({
				id: `${slug(e.title)}-w${week}`,
				module: e.module ?? "",
				title: e.title,
				week,
				order: 0,
				start: atTime(day, e.start).toISOString(),
				end: atTime(day, e.end).toISOString(),
				kind: "event",
				hasMaterials: false,
			});
		}
	}
	return out.sort((a, b) => a.start.localeCompare(b.start));
}

function pickSlot(l: Partial<SampleSlot>): Partial<SampleSlot> {
	const out: Partial<SampleSlot> = {};
	if (l.weekday !== undefined) out.weekday = l.weekday;
	if (l.start) out.start = l.start;
	if (l.end) out.end = l.end;
	return out;
}

/** The demo clock position for a scenario: that weekday of the current week, at that time. */
export function scenarioClock(scenario: SampleScenario, now: Date): Date {
	parseHM(scenario.clock.time);
	return atTime(addDays(startOfWeek(now), scenario.clock.weekday - 1), scenario.clock.time);
}

// ─── .ics import ────────────────────────────────────────────────────────────

export interface IcsEvent {
	uid: string;
	summary: string;
	start: Date;
	end: Date;
}

function unfold(text: string): string[] {
	return text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n");
}

function parseIcsDate(value: string, params: string): Date | null {
	if (/VALUE=DATE(?!-)/i.test(params) || /^\d{8}$/.test(value)) return null; // all-day: not a timetable slot
	const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value.trim());
	if (!m) return null;
	const [, y, mo, d, h, mi, s, z] = m;
	return z
		? new Date(Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!, +s!))
		: // Floating or TZID: read as local time (the student's zone for this prototype).
			new Date(+y!, +mo! - 1, +d!, +h!, +mi!, +s!);
}

function parseRrule(rule: string): { freq: string; count?: number; until?: Date; interval: number } {
	const parts = Object.fromEntries(rule.split(";").map((p) => p.split("=") as [string, string]));
	return {
		freq: (parts.FREQ ?? "").toUpperCase(),
		...(parts.COUNT ? { count: Number(parts.COUNT) } : {}),
		...(parts.UNTIL ? { until: parseIcsDate(parts.UNTIL.length === 8 ? `${parts.UNTIL}T235959` : parts.UNTIL, "") ?? undefined } : {}),
		interval: Math.max(1, Number(parts.INTERVAL ?? 1) || 1),
	};
}

/** Parse VEVENTs and expand weekly recurrences inside [from, to]. */
export function parseIcs(text: string, range: { from: Date; to: Date }, maxEvents = 500): IcsEvent[] {
	const out: IcsEvent[] = [];
	let cur: Record<string, { value: string; params: string }> | null = null;
	for (const line of unfold(text)) {
		if (line === "BEGIN:VEVENT") cur = {};
		else if (line === "END:VEVENT" && cur) {
			const start = cur.DTSTART && parseIcsDate(cur.DTSTART.value, cur.DTSTART.params);
			const end = cur.DTEND && parseIcsDate(cur.DTEND.value, cur.DTEND.params);
			if (start && end && end > start) {
				const base = { uid: cur.UID?.value ?? `${start.getTime()}`, summary: (cur.SUMMARY?.value ?? "").replace(/\\([,;\\])/g, "$1").replace(/\\n/gi, " ").trim() };
				const rule = cur.RRULE ? parseRrule(cur.RRULE.value) : null;
				const durationMs = end.getTime() - start.getTime();
				const occurrences = rule && rule.freq === "WEEKLY" ? (rule.count ?? 400) : 1;
				for (let i = 0; i < occurrences && out.length < maxEvents; i++) {
					const s = addDays(start, 7 * (rule?.interval ?? 1) * i);
					if (rule?.until && s > rule.until) break;
					if (s > range.to) break;
					if (s >= range.from) out.push({ ...base, start: s, end: new Date(s.getTime() + durationMs) });
					if (!rule) break;
				}
			}
			cur = null;
		} else if (cur) {
			const idx = line.indexOf(":");
			if (idx <= 0) continue;
			const [name, ...params] = line.slice(0, idx).split(";");
			cur[name!.toUpperCase()] = { value: line.slice(idx + 1), params: params.join(";") };
		}
	}
	return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}

const NON_LECTURE = /\b(lab|labs|seminar|tutorial|workshop|practical|exam)\b/i;

/** Map events to the student's modules by module code in the title. */
export function icsToLectures(
	events: IcsEvent[],
	modules: { code: string; name: string }[],
	hasMaterials: (lectureId: string) => boolean = () => false,
): { lectures: Lecture[]; unmapped: IcsEvent[] } {
	const lectures: Lecture[] = [];
	const unmapped: IcsEvent[] = [];
	const firstWeek = new Map<string, number>();
	const order = new Map<string, number>();
	for (const e of events) {
		const mod = modules.find((m) => new RegExp(`\\b${m.code.replace(/[^A-Za-z0-9]/g, "")}\\b`, "i").test(e.summary) || e.summary.toLowerCase().includes(m.name.toLowerCase()));
		if (!mod) {
			unmapped.push(e);
			continue;
		}
		const kind = NON_LECTURE.test(e.summary) ? "event" : "lecture";
		const weekStart = startOfWeek(e.start).getTime();
		if (!firstWeek.has(mod.code)) firstWeek.set(mod.code, weekStart);
		const week = Math.round((weekStart - firstWeek.get(mod.code)!) / (7 * 86_400_000)) + 1;
		const n = kind === "lecture" ? (order.get(mod.code) ?? 0) + 1 : 0;
		if (kind === "lecture") order.set(mod.code, n);
		const id = `${mod.code.toLowerCase()}-${dateKey(e.start)}-${formatHM(e.start).replace(":", "")}`;
		const title = e.summary.replace(new RegExp(`\\b${mod.code}\\b[\\s:–-]*`, "i"), "").trim() || e.summary;
		lectures.push({ id, module: mod.code, title, week, order: n, start: e.start.toISOString(), end: e.end.toISOString(), kind, hasMaterials: kind === "lecture" && hasMaterials(id) });
	}
	return { lectures, unmapped };
}

/** "What I read" (R-7, Q-10). Location is never read. */
export function readsSummary(lectures: Lecture[], source: "sample" | "ics", readAt: string | undefined, via: "file" | "link" = "file") {
	return {
		source,
		label: source === "sample" ? "Sample timetable" : via === "link" ? "Your calendar link" : "Your timetable (.ics)",
		events: lectures.length,
		lectures: lectures.filter((l) => (l.kind ?? "lecture") === "lecture").length,
		modules: [...new Set(lectures.map((l) => l.module).filter(Boolean))],
		weekdays: [...new Set(lectures.map((l) => isoWeekday(new Date(l.start))))].sort(),
		lastReadAt: readAt ?? null,
		location: "never read" as const,
	};
}
