/**
 * Local-time helpers for the companion rules. Every rule reads "now" from
 * the companion clock (real time plus the demo offset) and works in the
 * server's local time zone, which is the student's for this prototype.
 */

const MINUTE = 60_000;
export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** "13:05" → 785. Throws on a malformed time. */
export function parseHM(hm: string): number {
	const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
	if (!m) throw new Error(`invalid time "${hm}" (expected HH:MM)`);
	const h = Number(m[1]);
	const min = Number(m[2]);
	if (h > 23 || min > 59) throw new Error(`invalid time "${hm}"`);
	return h * 60 + min;
}

export function isValidHM(hm: unknown): hm is string {
	if (typeof hm !== "string") return false;
	try {
		parseHM(hm);
		return true;
	} catch {
		return false;
	}
}

export function formatHM(d: Date): string {
	return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function minutesOfDay(d: Date): number {
	return d.getHours() * 60 + d.getMinutes();
}

export function startOfDay(d: Date): Date {
	return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, n: number): Date {
	const out = new Date(d);
	out.setDate(out.getDate() + n);
	return out;
}

export function addMinutes(d: Date, n: number): Date {
	return new Date(d.getTime() + n * MINUTE);
}

export function minutesBetween(a: Date, b: Date): number {
	return (b.getTime() - a.getTime()) / MINUTE;
}

/** The given day at "HH:MM" local time. */
export function atTime(day: Date, hm: string): Date {
	const mins = parseHM(hm);
	const out = startOfDay(day);
	out.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
	return out;
}

export function sameDay(a: Date | string, b: Date | string): boolean {
	const x = typeof a === "string" ? new Date(a) : a;
	const y = typeof b === "string" ? new Date(b) : b;
	return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

/** Local "YYYY-MM-DD". */
export function dateKey(d: Date): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function isoWeekday(d: Date): number {
	return d.getDay() === 0 ? 7 : d.getDay();
}

/** Monday 00:00 of the week containing d. */
export function startOfWeek(d: Date): Date {
	return addDays(startOfDay(d), 1 - isoWeekday(d));
}

export function weekdayName(d: Date | string): string {
	return WEEKDAY_NAMES[(typeof d === "string" ? new Date(d) : d).getDay()]!;
}

/** Quiet hours may wrap midnight (22:00–08:00). */
export function inQuietHours(now: Date, quiet: { from: string; to: string }): boolean {
	const t = minutesOfDay(now);
	const from = parseHM(quiet.from);
	const to = parseHM(quiet.to);
	if (from === to) return false;
	return from < to ? t >= from && t < to : t >= from || t < to;
}

/** The waking window of a day: [end of morning quiet hours, start of evening quiet hours). */
export function wakingWindow(day: Date, quiet: { from: string; to: string }): { start: Date; end: Date } {
	const from = parseHM(quiet.from);
	const to = parseHM(quiet.to);
	if (from > to) return { start: atTime(day, quiet.to), end: atTime(day, quiet.from) };
	// Quiet hours inside the day (unusual): treat the whole day as waking.
	return { start: startOfDay(day), end: addDays(startOfDay(day), 1) };
}

/** "today", "yesterday", or "on Tuesday" relative to now. */
export function relativeDay(d: Date, now: Date): string {
	if (sameDay(d, now)) return "today";
	if (sameDay(d, addDays(now, -1))) return "yesterday";
	return `on ${weekdayName(d)}`;
}
