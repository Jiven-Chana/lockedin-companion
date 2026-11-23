/** Miss log (§6.8), progress (§7.8), timetable + .ics (§7.4), blocks + lock (§7.7), CSV (§12.3). */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	activeBlock,
	applyRetestAnswer,
	eventsToCsv,
	icsToLectures,
	lockDecision,
	materializeSampleTimetable,
	missFromAnswer,
	nextDueAfter,
	parseIcs,
	scenarioClock,
	searchLectures,
	validateBlocks,
	weekSummary,
	type AnswerRecord,
	type CompanionState,
	type SampleTimetable,
} from "../src/core/companion/index.ts";

const now = new Date(2026, 10, 17, 13, 10);
const ans = (over: Partial<AnswerRecord> = {}): AnswerRecord => ({
	questionId: "q1", questionText: "Q?", graded: true, correct: false, dontKnow: false, shown: false, correctLabels: ["A"], answeredAt: now.toISOString(), ...over,
});
const ctx = { sessionId: "s1", lectureId: "hci", now };

describe("miss log", () => {
	it("a miss is wrong, I-don't-know, or right at ≤ 30% confidence", () => {
		assert.equal(missFromAnswer(ans(), ctx)?.reason, "wrong");
		assert.equal(missFromAnswer(ans({ dontKnow: true }), ctx)?.reason, "dont-know");
		assert.equal(missFromAnswer(ans({ correct: true, confidence: 30 }), ctx)?.reason, "low-confidence");
		assert.equal(missFromAnswer(ans({ correct: true, confidence: 50 }), ctx), null);
		assert.equal(missFromAnswer(ans({ correct: true }), ctx), null);
	});

	it("\"show me first\" and ungraded answers are not misses", () => {
		assert.equal(missFromAnswer(ans({ dontKnow: true, shown: true }), ctx), null);
		assert.equal(missFromAnswer(ans({ graded: false }), ctx), null);
	});

	it("spacing is 1, 3, then 7 days; ids are stable per session and question", () => {
		const m = missFromAnswer(ans(), ctx)!;
		assert.equal(m.id, "s1:q1");
		assert.equal(m.nextDue, new Date(2026, 10, 18, 13, 10).toISOString());
		assert.equal(nextDueAfter(1, now).getDate(), 20);
		assert.equal(nextDueAfter(2, now).getDate(), 24);
		assert.equal(nextDueAfter(9, now).getDate(), 24);
	});

	it("a retest makes a miss solid on correct at ≥ 70%, otherwise reschedules it", () => {
		const m = missFromAnswer(ans(), ctx)!;
		const solid = applyRetestAnswer([m], [m.id], 1, ans({ correct: true, confidence: 70 }), now);
		assert.equal(solid[0]!.status, "solid");
		const unsure = applyRetestAnswer([m], [m.id], 1, ans({ correct: true, confidence: 50 }), now);
		assert.equal(unsure[0]!.status, "open");
		assert.equal(unsure[0]!.timesSeen, 1);
		assert.equal(unsure[0]!.nextDue, nextDueAfter(1, now).toISOString());
	});

	it("retest answers map to misses in order", () => {
		const a = { ...missFromAnswer(ans(), ctx)!, id: "a" };
		const b = { ...missFromAnswer(ans(), ctx)!, id: "b" };
		const out = applyRetestAnswer([a, b], ["a", "b"], 2, ans({ correct: true, confidence: 90 }), now);
		assert.deepEqual(out.map((m) => m.status), ["open", "solid"]);
	});
});

describe("sample timetable", () => {
	const sample: SampleTimetable = {
		label: "Sample timetable", currentWeek: 2,
		modules: [{ code: "HCI", name: "HCI" }, { code: "GT", name: "GT" }],
		slots: { HCI: { weekday: 2, start: "11:00", end: "13:00" }, GT: { weekday: 3, start: "10:00", end: "12:00" } },
		lectures: [
			{ id: "h1", module: "HCI", title: "One", week: 1 },
			{ id: "h2", module: "HCI", title: "Two", week: 2 },
			{ id: "g2", module: "GT", title: "Nash", week: 2, weekday: 4, start: "09:00", end: "10:00" },
		],
		events: [{ title: "HCI lab", module: "HCI", weekday: 4, start: "14:00", end: "16:00" }],
		scenarios: { tayo: { description: "", clock: { weekday: 2, time: "12:58" } } },
	};

	it("puts the current teaching week on this week, earlier weeks before it, in course order", () => {
		const ls = materializeSampleTimetable(sample, now, { hasMaterials: (id) => id !== "h1" });
		const h2 = ls.find((l) => l.id === "h2")!;
		assert.equal(new Date(h2.start!).toISOString(), new Date(2026, 10, 17, 11).toISOString());
		assert.equal(new Date(ls.find((l) => l.id === "h1")!.start!).toISOString(), new Date(2026, 10, 10, 11).toISOString());
		assert.equal(ls.find((l) => l.id === "g2")!.start, new Date(2026, 10, 19, 9).toISOString(), "a lecture can override its slot");
		assert.deepEqual(ls.filter((l) => l.kind === "event").map((l) => l.id).sort(), ["hci-lab-w1", "hci-lab-w2"]);
		assert.equal(h2.order, 2);
		assert.equal(ls.find((l) => l.id === "h1")!.hasMaterials, false);
	});

	it("filters to the chosen modules", () => {
		assert.ok(materializeSampleTimetable(sample, now, { modules: ["GT"] }).every((l) => l.module !== "HCI"));
	});

	it("scenario clocks land on this week's weekday", () => {
		assert.equal(scenarioClock(sample.scenarios!.tayo!, new Date(2026, 10, 21, 9)).toISOString(), new Date(2026, 10, 17, 12, 58).toISOString());
	});
});

describe(".ics import", () => {
	const ics = [
		"BEGIN:VCALENDAR",
		"BEGIN:VEVENT",
		"UID:1",
		"SUMMARY:HCI Lecture: Personas",
		"DTSTART:20261117T110000",
		"DTEND:20261117T130000",
		"RRULE:FREQ=WEEKLY;COUNT=3",
		"END:VEVENT",
		"BEGIN:VEVENT",
		"UID:2",
		"SUMMARY:HCI Lab",
		"DTSTART;TZID=Europe/London:20261119T140000",
		"DTEND;TZID=Europe/London:20261119T160000",
		"END:VEVENT",
		"BEGIN:VEVENT",
		"UID:3",
		"SUMMARY:Chess club",
		"DTSTART:20261118T180000Z",
		"DTEND:20261118T190000Z",
		"END:VEVENT",
		"BEGIN:VEVENT",
		"UID:4",
		"SUMMARY:Reading week",
		"DTSTART;VALUE=DATE:20261123",
		"DTEND;VALUE=DATE:20261130",
		"END:VEVENT",
		"END:VCALENDAR",
	].join("\r\n");

	it("expands weekly recurrences, skips all-day events, maps by module code", () => {
		const events = parseIcs(ics, { from: new Date(2026, 10, 1), to: new Date(2026, 11, 31) });
		assert.equal(events.length, 5);
		const { lectures, unmapped } = icsToLectures(events, [{ code: "HCI", name: "Human-Computer Interaction" }]);
		assert.deepEqual(unmapped.map((e) => e.summary), ["Chess club"]);
		const lec = lectures.filter((l) => l.kind === "lecture");
		assert.deepEqual(lec.map((l) => l.week), [1, 2, 3]);
		assert.deepEqual(lec.map((l) => l.order), [1, 2, 3]);
		assert.equal(lec[0]!.title, "Lecture: Personas");
		assert.equal(lectures.find((l) => l.kind === "event")?.title, "Lab");
	});
});

describe("study blocks and the lock", () => {
	const block = { id: "b1", weekday: 2, start: "13:00", minutes: 60, skippedDates: [] };

	it("validates: at most 2, sane times, ids", () => {
		assert.equal(validateBlocks([block]).ok, true);
		const bad = validateBlocks([{ ...block, weekday: 8, start: "25:00", minutes: 5 }]);
		assert.equal(bad.ok, false);
		assert.equal((bad as { errors: string[] }).errors.length, 3);
	});

	it("Pomodoro phases inside a block", () => {
		assert.equal(activeBlock([block], new Date(2026, 10, 17, 13, 10))?.onBreak, false);
		assert.equal(activeBlock([block], new Date(2026, 10, 17, 13, 26))?.onBreak, true);
		assert.equal(activeBlock([block], new Date(2026, 10, 17, 13, 31))?.onBreak, false);
		assert.equal(activeBlock([block], new Date(2026, 10, 17, 14, 0)), null);
		assert.equal(activeBlock([{ ...block, skippedDates: ["2026-11-17"] }], new Date(2026, 10, 17, 13, 10)), null);
	});

	it("there is always a way out", () => {
		const active = activeBlock([block], new Date(2026, 10, 17, 13, 10));
		const t = new Date(2026, 10, 17, 13, 10);
		for (const strictness of ["gentle", "firm"] as const) {
			assert.equal(lockDecision({ strictness, active, now: t }).allowed, false);
			assert.equal(lockDecision({ strictness, active, now: t, confirmed: true, reason: "need it" }).allowed, true);
		}
		assert.equal(lockDecision({ strictness: "off", active, now: t }).allowed, true);
	});
});

describe("progress and search", () => {
	it("counts this week's work without streaks or overdue", () => {
		const state: CompanionState = {
			profile: null, lectures: [], blocks: [], nudges: [], misses: [],
			sessions: [
				{ id: "a", engine: "scripted", spec: { kind: "try-now", lectureId: "x", mode: "question-first", budget: { questions: 3, minutes: 3 } }, budget: 3, answered: 3, createdAt: "", openedAt: new Date(2026, 10, 16).toISOString(), state: "done" },
				{ id: "b", engine: "scripted", spec: { kind: "try-now", lectureId: "x", mode: "question-first", budget: { questions: 3, minutes: 3 } }, budget: 3, answered: 2, createdAt: "", openedAt: new Date(2026, 10, 9).toISOString(), state: "done" },
			],
		};
		assert.deepEqual(weekSummary(state, now), { sessions: 1, questionsAnswered: 3, readyToRevisit: 0 });
	});

	it("searches lecture and slide titles", () => {
		const lectures = [
			{ id: "a", module: "HCI", title: "Personas and scenarios", week: 3, order: 3, start: "", end: "", hasMaterials: true },
			{ id: "b", module: "HCI", title: "Fieldwork", week: 4, order: 4, start: "", end: "", hasMaterials: true },
		];
		assert.deepEqual(searchLectures(lectures, "ethnography", (id) => (id === "b" ? ["What ethnography is"] : [])).map((l) => l.id), ["b"]);
		assert.deepEqual(searchLectures(lectures, "", () => []).length, 2);
	});
});

describe("event CSV", () => {
	it("quotes commas, quotes and newlines", () => {
		const csv = eventsToCsv([{ t: "t1", wall: "w1", participant: "P01", type: "answer", data: { why: 'a, "b"\nc' } }]);
		assert.equal(csv, 't,wall,participant,type,data\nt1,w1,P01,answer,"{""why"":""a, \\""b\\""\\nc""}"\n');
	});
});
