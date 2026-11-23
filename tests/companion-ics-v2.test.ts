/**
 * Calendars in (v0.1 F-108): ical.js parsing over Google, Outlook and Apple
 * exports and a multi-day weekly rule, with a cancelled and a moved
 * occurrence, a TZID across the October clock change, DURATION, all-day
 * events and floating times. Times are checked as London wall-clock times,
 * so the tests pass on any machine's zone.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { icsToLectures, parseIcs, zonedTime, type IcsEvent } from "../src/core/companion/index.ts";

const FIX = path.join(import.meta.dirname, "fixtures", "companion", "ics");
const read = (f: string) => fs.readFileSync(path.join(FIX, f), "utf-8");
const range = { from: new Date(Date.UTC(2026, 9, 1)), to: new Date(Date.UTC(2026, 11, 31)) };
/** "Tue 13 Oct 11:00" in London, built from parts so it doesn't depend on the ICU version's punctuation. */
const london = (d: Date) => {
	const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
	const v = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
	return `${v("weekday")} ${v("day")} ${v("month")} ${v("hour")}:${v("minute")}`;
};
const brief = (es: IcsEvent[]) => es.map((e) => `${london(e.start)}–${london(e.end).slice(-5)}${e.allDay ? " all-day" : ""}`);

describe("Google export", () => {
	const events = parseIcs(read("google.ics"), range, 500, { timeZone: "Europe/London" });
	it("expands Tue/Thu weekly, drops the cancelled one, keeps 11:00 London time across the clock change, and moves one", () => {
		assert.deepEqual(brief(events), [
			"Tue 13 Oct 11:00–13:00",
			"Thu 15 Oct 11:00–13:00",
			"Tue 20 Oct 11:00–13:00",
			// Thu 22 Oct: EXDATE (cancelled). Tue 27 Oct: moved to Wed 28 Oct 15:00, after the clock change.
			"Wed 28 Oct 15:00–17:00",
			"Thu 29 Oct 11:00–13:00",
		]);
	});
	it("the moved occurrence remembers its original slot", () => {
		const moved = events.find((e) => e.summary.includes("moved"));
		assert.equal(london(moved!.recurrenceId!), "Tue 27 Oct 11:00");
	});
});

describe("Outlook export (a Windows zone name with its VTIMEZONE)", () => {
	it("reads GMT Standard Time as London, three Wednesdays", () => {
		assert.deepEqual(brief(parseIcs(read("outlook.ics"), range)), ["Wed 21 Oct 10:00–12:00", "Wed 28 Oct 10:00–12:00", "Wed 04 Nov 10:00–12:00"]);
	});
});

describe("Apple export (floating times, DURATION, every two weeks)", () => {
	it("reads floating times in the student's zone and applies the duration", () => {
		assert.deepEqual(brief(parseIcs(read("apple.ics"), range, 500, { timeZone: "Europe/London" })), ["Mon 02 Nov 09:00–10:30", "Mon 16 Nov 09:00–10:30", "Mon 30 Nov 09:00–10:30"]);
	});
});

describe("multi-day weekly rule, all-day and cancelled events", () => {
	const events = parseIcs(read("multiday.ics"), range);
	it("Mon/Wed/Fri six times, the all-day reading day kept as all-day, the cancelled event dropped", () => {
		const timed = events.filter((e) => !e.allDay);
		assert.equal(timed.length, 6);
		assert.deepEqual(timed.map((e) => london(e.start).slice(0, 3)), ["Mon", "Wed", "Fri", "Mon", "Wed", "Fri"]);
		assert.ok(!events.some((e) => e.summary.includes("Cancelled")));
		assert.deepEqual(events.filter((e) => e.allDay).map((e) => e.summary), ["GT reading day"]);
	});
	it("all-day events become busy events, never lectures", () => {
		const { lectures } = icsToLectures(events, [{ code: "GT", name: "Game Theory" }]);
		const day = lectures.find((l) => l.title.includes("reading day"));
		assert.equal(day?.kind, "event");
		assert.match(day!.id, /-allday$/);
	});
});

describe("stable ids", () => {
	it("a moved occurrence keeps the id of the slot it was moved from", () => {
		const { lectures } = icsToLectures(parseIcs(read("google.ics"), range, 500, { timeZone: "Europe/London" }), [{ code: "HCI", name: "HCI" }]);
		const moved = lectures.find((l) => l.title.includes("moved"));
		assert.equal(moved?.id, "hci-2026-10-27-1100");
	});
});

describe("zoned wall-clock times", () => {
	const cases: Array<[string, Parameters<typeof zonedTime>, string]> = [
		["summer time in London", [2026, 7, 1, 11, 0, 0, "Europe/London"], "2026-07-01T10:00:00.000Z"],
		["winter time in London", [2026, 12, 1, 11, 0, 0, "Europe/London"], "2026-12-01T11:00:00.000Z"],
		["New York", [2026, 12, 1, 9, 0, 0, "America/New_York"], "2026-12-01T14:00:00.000Z"],
	];
	for (const [name, args, iso] of cases) it(name, () => assert.equal(zonedTime(...args).toISOString(), iso));
	it("garbage in gives no events, not a crash", () => assert.deepEqual(parseIcs("not a calendar", range), []));
});
