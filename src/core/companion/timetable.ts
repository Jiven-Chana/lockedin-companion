/**
 * Timetables (plan §7.4): the labelled sample week (the MVP default) and a
 * minimal `.ics` import (stretch, cut-list item 1). The importer is
 * dependency-free on purpose: weekly RRULEs, UTC/floating/TZID times, no
 * all-day events. That covers a university timetable export; anything it
 * cannot map is returned as `unmapped` for the mapping screen.
 */

import ICAL from "ical.js";
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
	return out.sort((a, b) => a.start!.localeCompare(b.start!));
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

// ─── timed lectures vs course units (V-18) ─────────────────────────────────

/** A timetabled lecture or event: has a start and an end. */
export type TimedLecture = Lecture & { start: string; end: string };

/** True for timetable entries; false for course units made from material (spec §5.5). */
export function isTimed(l: Lecture): l is TimedLecture {
	return typeof l.start === "string" && typeof l.end === "string";
}

// ─── .ics import (v0.1 F-108: ical.js) ─────────────────────────────────────

export interface IcsEvent {
	uid: string;
	summary: string;
	start: Date;
	end: Date;
	/** A whole-day event: a busy day for planning, never a lecture (F-108). */
	allDay?: boolean;
	/** For a moved occurrence of a repeating event: when it was originally due (keeps its id stable). */
	recurrenceId?: Date;
}

/** Minutes east of UTC for an IANA zone at an instant. */
function zoneOffsetMinutes(zone: string, at: number): number {
	const parts = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(at));
	const v = (t: string) => Number(parts.find((p) => p.type === t)?.value);
	return (Date.UTC(v("year"), v("month") - 1, v("day"), v("hour"), v("minute"), v("second")) - at) / 60_000;
}

function validZone(zone: string | undefined): zone is string {
	if (!zone) return false;
	try {
		new Intl.DateTimeFormat("en-GB", { timeZone: zone });
		return true;
	} catch {
		return false;
	}
}

/** A wall-clock time in an IANA zone as an instant (handles DST: re-checks the offset once). */
export function zonedTime(y: number, mo: number, d: number, h: number, mi: number, s: number, zone: string): Date {
	const guess = Date.UTC(y, mo - 1, d, h, mi, s);
	const first = guess - zoneOffsetMinutes(zone, guess) * 60_000;
	return new Date(guess - zoneOffsetMinutes(zone, first) * 60_000);
}

/** ICAL.Time → Date: UTC as is, registered VTIMEZONEs by ical.js, a bare IANA TZID or floating time via `fallbackZone`. */
function toDate(t: ICAL.Time, tzid: string | undefined, fallbackZone: string | undefined): Date {
	const zoneId = t.zone?.tzid;
	if (zoneId === "UTC" || (zoneId && zoneId !== "floating" && ICAL.TimezoneService.has(zoneId))) return t.toJSDate();
	const zone = validZone(tzid) ? tzid : validZone(fallbackZone) ? fallbackZone : undefined;
	if (!zone) return t.toJSDate(); // the server's local zone
	return zonedTime(t.year, t.month, t.day, t.hour, t.minute, t.second, zone);
}

/**
 * Parse an iCalendar file and expand its events inside [from, to] with
 * ical.js: TZID and VTIMEZONE, every RRULE (BYDAY, INTERVAL, COUNT,
 * UNTIL), EXDATE (cancelled occurrences), RECURRENCE-ID (moved ones),
 * DURATION, and all-day events (kept as busy days). Floating times and
 * IANA TZIDs without a VTIMEZONE are read in `timeZone` (the student's).
 */
export function parseIcs(text: string, range: { from: Date; to: Date }, maxEvents = 500, opts: { timeZone?: string } = {}): IcsEvent[] {
	let root: ICAL.Component;
	try {
		root = new ICAL.Component(ICAL.parse(text));
	} catch {
		return [];
	}
	for (const tz of root.getAllSubcomponents("vtimezone")) {
		try {
			ICAL.TimezoneService.register(tz);
		} catch {
			/* a broken VTIMEZONE: fall back to the TZID name */
		}
	}
	const vevents = root.getAllSubcomponents("vevent");
	const masters = new Map<string, ICAL.Event>();
	const singles: ICAL.Event[] = [];
	const exceptions: ICAL.Event[] = [];
	for (const v of vevents) {
		const ev = new ICAL.Event(v);
		if (ev.isRecurrenceException()) exceptions.push(ev);
		else if (ev.isRecurring()) masters.set(ev.uid, ev);
		else singles.push(ev);
	}
	const orphaned: ICAL.Event[] = [];
	for (const ex of exceptions) {
		const master = masters.get(ex.uid);
		if (master) master.relateException(ex);
		else orphaned.push(ex);
	}

	const out: IcsEvent[] = [];
	const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
	const tzidOf = (prop: ICAL.Property | null) => (prop?.getParameter("tzid") as string | undefined) ?? undefined;
	const push = (ev: ICAL.Event, start: ICAL.Time, end: ICAL.Time, recurrenceId?: ICAL.Time) => {
		const allDay = start.isDate;
		const s = allDay ? new Date(start.year, start.month - 1, start.day) : toDate(start, tzidOf(ev.component.getFirstProperty("dtstart")), opts.timeZone);
		let e = allDay ? new Date(end.year, end.month - 1, end.day) : toDate(end, tzidOf(ev.component.getFirstProperty("dtend")) ?? tzidOf(ev.component.getFirstProperty("dtstart")), opts.timeZone);
		if (allDay && e <= s) e = addDays(s, 1);
		if (!(e > s) || e < range.from || s > range.to) return;
		const status = clean(ev.component.getFirstPropertyValue("status") as string | null).toUpperCase();
		if (status === "CANCELLED") return;
		out.push({
			uid: ev.uid || `${s.getTime()}`,
			summary: clean(ev.summary),
			start: s,
			end: e,
			...(allDay ? { allDay: true } : {}),
			...(recurrenceId ? { recurrenceId: toDate(recurrenceId, tzidOf(ev.component.getFirstProperty("dtstart")), opts.timeZone) } : {}),
		});
	};

	for (const ev of [...singles, ...orphaned]) {
		if (out.length >= maxEvents) break;
		if (ev.startDate) push(ev, ev.startDate, ev.endDate, ev.recurrenceId ?? undefined);
	}
	for (const ev of masters.values()) {
		const it = ev.iterator();
		for (let next = it.next(), n = 0; next && n < 2000 && out.length < maxEvents; next = it.next(), n++) {
			const at = toDate(next, tzidOf(ev.component.getFirstProperty("dtstart")), opts.timeZone);
			if (at > range.to) break;
			const d = ev.getOccurrenceDetails(next);
			const moved = d.item !== ev;
			push(d.item, d.startDate, d.endDate, moved ? d.recurrenceId : undefined);
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
		const kind = e.allDay || NON_LECTURE.test(e.summary) ? "event" : "lecture";
		const weekStart = startOfWeek(e.start).getTime();
		if (!firstWeek.has(mod.code)) firstWeek.set(mod.code, weekStart);
		const week = Math.round((weekStart - firstWeek.get(mod.code)!) / (7 * 86_400_000)) + 1;
		const n = kind === "lecture" ? (order.get(mod.code) ?? 0) + 1 : 0;
		if (kind === "lecture") order.set(mod.code, n);
		// A moved occurrence keeps the id of the slot it was moved from, so its material and "I wasn't there" follow it.
		const slot = e.recurrenceId ?? e.start;
		const id = `${mod.code.toLowerCase()}-${dateKey(slot)}-${e.allDay ? "allday" : formatHM(slot).replace(":", "")}`;
		const title = e.summary.replace(new RegExp(`\\b${mod.code}\\b[\\s:–-]*`, "i"), "").trim() || e.summary;
		lectures.push({ id, module: mod.code, title, week, order: n, start: e.start.toISOString(), end: e.end.toISOString(), kind, hasMaterials: kind === "lecture" && hasMaterials(id) });
	}
	return { lectures, unmapped };
}

/**
 * A calendar re-import merges instead of replacing (F-104): course units
 * (untimed) are kept; an event still in the calendar keeps its id,
 * "I wasn't there" and its material; one that disappeared is archived
 * (hidden, history kept); new events are added.
 */
export function mergeTimetable(existing: readonly Lecture[], incoming: readonly Lecture[]): { lectures: Lecture[]; added: number; kept: number; archived: number } {
	const byId = new Map(incoming.map((l) => [l.id, l]));
	const out: Lecture[] = [];
	let kept = 0;
	let archived = 0;
	for (const old of existing) {
		if (!isTimed(old)) {
			out.push(old);
			continue;
		}
		const fresh = byId.get(old.id);
		if (fresh) {
			byId.delete(old.id);
			kept++;
			out.push({ ...fresh, ...(old.attended !== undefined ? { attended: old.attended } : {}), hasMaterials: fresh.hasMaterials || old.hasMaterials });
		} else {
			if (!old.archived) archived++;
			out.push({ ...old, archived: true });
		}
	}
	const added = [...byId.values()];
	return { lectures: [...out, ...added], added: added.length, kept, archived };
}

/** "What I read" (R-7, Q-10). Location is never read. */
export function readsSummary(lectures: Lecture[], source: "sample" | "ics" | "none", readAt: string | undefined, via: "file" | "link" = "file") {
	return {
		source,
		label: source === "sample" ? "Sample timetable" : source === "none" ? "No timetable connected" : via === "link" ? "Your calendar link" : "Your timetable (.ics)",
		events: lectures.filter(isTimed).length,
		lectures: lectures.filter((l) => isTimed(l) && (l.kind ?? "lecture") === "lecture").length,
		modules: [...new Set(lectures.map((l) => l.module).filter(Boolean))],
		weekdays: [...new Set(lectures.filter(isTimed).map((l) => isoWeekday(new Date(l.start))))].sort(),
		lastReadAt: readAt ?? null,
		location: "never read" as const,
	};
}
