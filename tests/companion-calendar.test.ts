/**
 * Calendars in, the service side (v0.1 F-108): the student's time zone,
 * refresh on open and every 6 hours, a masked link, and the events.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { ManualClock } from "../src/server/companion/clock.ts";
import { CompanionContent } from "../src/server/companion/content.ts";
import { ScriptedEngine } from "../src/server/companion/engines/scripted.ts";
import { CompanionService, maskLink } from "../src/server/companion/service.ts";
import { CompanionStore } from "../src/server/companion/store.ts";

const CONTENT = path.join(import.meta.dirname, "..", "companion", "content");
const URL1 = "https://calendar.example.ac.uk/feeds/user_9f8e7d6c5b4a39281706f5e4d3c2b1a0.ics";
const ICS = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:a", "SUMMARY:GT: Lecture", "DTSTART:20261124T100000", "DTEND:20261124T110000", "END:VEVENT", "END:VCALENDAR"].join("\r\n");

function make(dir: string, fetches: string[]) {
	const store = new CompanionStore(dir);
	const content = new CompanionContent(store, CONTENT);
	const clock = new ManualClock(new Date(2026, 10, 23, 12));
	const scripted = new ScriptedEngine((id) => content.scriptedSet(id));
	const svc = new CompanionService({
		store, content, clock,
		clockControl: { set: (t) => clock.set(t), reset: () => undefined },
		engines: { scripted, learnharness: scripted },
		defaultEngine: "scripted",
		fetchCalendar: async (url) => { fetches.push(url); return ICS; },
	});
	return { svc, store };
}

describe("calendars in (F-108)", () => {
	it("onboarding keeps the student's zone; floating times are read in it", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "companion-cal-"));
		const { svc, store } = make(dir, []);
		await svc.onboardFlow({ calendar: { kind: "link", url: URL1 }, modules: [{ code: "GT", name: "Game Theory" }], timeZone: "America/New_York" });
		assert.equal(store.profile()?.timeZone, "America/New_York");
		const lecture = store.lectures().find((l) => l.start)!;
		assert.equal(lecture.start, "2026-11-24T15:00:00.000Z", "10:00 floating, read in New York (UTC−5)");
		assert.equal(svc.reads().timeZone, "America/New_York");
	});

	it("a bad zone is ignored", async () => {
		const { svc, store } = make(fs.mkdtempSync(path.join(os.tmpdir(), "companion-cal-")), []);
		await svc.onboardFlow({ calendar: { kind: "none" }, modules: [{ name: "X" }], timeZone: "Mars/Olympus" });
		assert.equal(store.profile()?.timeZone, undefined);
	});

	it("refreshes on open (once per run) and again after 6 hours, never right after connecting", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "companion-cal-"));
		const fetches: string[] = [];
		const first = make(dir, fetches);
		await first.svc.onboardFlow({ calendar: { kind: "none" }, modules: [{ code: "GT", name: "Game Theory" }] });
		await first.svc.subscribeCalendar(URL1);
		assert.equal(fetches.length, 1);
		assert.equal(first.svc.refreshCalendarIfDue(), null, "just connected: not due");

		const reopened = make(dir, fetches); // the app opens again
		await reopened.svc.refreshCalendarIfDue();
		assert.equal(fetches.length, 2, "refreshed on open");
		assert.equal(reopened.svc.refreshCalendarIfDue(), null, "not again in the same run");
		reopened.store.saveRuntime({ calendarRefreshedAt: new Date(Date.now() - 7 * 3_600_000).toISOString() });
		await reopened.svc.refreshCalendarIfDue();
		assert.equal(fetches.length, 3, "due again after 6 hours");
		const types = reopened.store.events().map((e) => e.type);
		assert.ok(types.includes("calendar_connected") && types.includes("calendar_refreshed"));
	});

	it("a failed refresh is logged, never thrown", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "companion-cal-"));
		const { svc, store } = make(dir, []);
		await svc.onboardFlow({ calendar: { kind: "none" }, modules: [{ name: "X" }] });
		store.saveRuntime({ calendarUrl: "https://calendar.example/gone.ics" });
		(svc as unknown as { deps: { fetchCalendar: () => Promise<string> } }).deps.fetchCalendar = async () => { throw new Error("404"); };
		await svc.refreshCalendarIfDue();
		assert.ok(store.events().some((e) => e.type === "calendar_error"));
	});

	it("the link is shown masked: host and the end of the file name, never the token", () => {
		const m = maskLink(URL1);
		assert.ok(m.startsWith("calendar.example.ac.uk/…"), m);
		assert.ok(!m.includes("9f8e7d6c5b4a39281706"), m);
	});
});
