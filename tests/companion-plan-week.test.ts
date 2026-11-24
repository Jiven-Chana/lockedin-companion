/**
 * The weekly plan (v0.1 F-110), the pacing rule (spec §5.5, V-18), the
 * Sunday check-in (F-111) and the routine (F-109). Mon 23 Nov 2026 is the
 * week planned; "now" is Mon 23 Nov 07:00 unless a case says otherwise.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	CHECKIN_RULES,
	DEFAULT_PREFS,
	lastWeekSummary,
	NUDGE_TEXT,
	PLAN_COPY,
	PLAN_RULES,
	pacedUnits,
	proposeTarget,
	proposeWeek,
	validateRoutine,
	type Lecture,
	type PlanInput,
	type StudyBlock,
	type UnitStatus,
} from "../src/core/companion/index.ts";

const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m);
const lecture = (id: string, module: string, d: number, h: number, hours = 2): Lecture => ({ id, module, title: id, week: 8, order: 1, start: at(d, h).toISOString(), end: at(d, h + hours).toISOString(), kind: "lecture", hasMaterials: true });
const block = (date: string, start: string, status: StudyBlock["status"] = "accepted", minutes = 50): StudyBlock => ({ id: `${date}-${start}`, date, start, minutes, status, source: "student" });
const base = (over: Partial<PlanInput> = {}): PlanInput => ({
	week: at(23, 7), now: at(23, 7), lectures: [], quietHours: DEFAULT_PREFS.quietHours, targetMinutes: 200, blockMinutes: 50,
	existing: [], lastWeek: [], focus: [], newId: (i) => `p${i}`, ...over,
});
const overlaps = (a: { start: Date; end: Date }, b: { start: Date; end: Date }) => a.start < b.end && b.start < a.end;
const span = (b: StudyBlock) => {
	const start = new Date(`${b.date}T${b.start}:00`);
	return { start, end: new Date(start.getTime() + b.minutes * 60_000) };
};

describe("proposing the week", () => {
	it("meets the target with blocks of the chosen length", () => {
		const r = proposeWeek(base({ targetMinutes: 200 }));
		assert.equal(r.proposals.length, 4);
		assert.ok(r.proposals.every((p) => p.minutes === 50 && p.status === "proposed" && p.source === "planner"));
		assert.equal(r.plannedMinutes, 200);
		assert.equal(r.fits, true);
	});

	it("never overlaps a lecture, an event, a commitment or quiet hours (with a buffer)", () => {
		const lectures = [lecture("hci", "HCI", 23, 9), lecture("gt", "GT", 24, 13), { ...lecture("lab", "HCI", 25, 10, 6), kind: "event" as const }];
		const routine = { energy: [], commitments: [{ label: "Shift", weekdays: [1, 2, 3, 4, 5], start: "17:00", end: "21:00" }] };
		const r = proposeWeek(base({ lectures, routine, targetMinutes: 600 }));
		for (const p of r.proposals) {
			const s = span(p);
			for (const l of lectures) assert.ok(!overlaps(s, { start: new Date(new Date(l.start!).getTime() - 10 * 60_000), end: new Date(new Date(l.end!).getTime() + 10 * 60_000) }), `${p.date} ${p.start} vs ${l.id}`);
			const wd = s.start.getDay() || 7;
			if (wd <= 5) assert.ok(!overlaps(s, { start: new Date(`${p.date}T16:50:00`), end: new Date(`${p.date}T21:10:00`) }), `${p.date} ${p.start} vs shift`);
			assert.ok(s.start.getHours() >= 8 && (s.end.getHours() < 22 || (s.end.getHours() === 22 && s.end.getMinutes() === 0)), `${p.date} ${p.start} quiet hours`);
		}
	});

	it("at most two a day", () => {
		const r = proposeWeek(base({ targetMinutes: 900, now: at(23, 7) }));
		const perDay = new Map<string, number>();
		for (const p of r.proposals) perDay.set(p.date, (perDay.get(p.date) ?? 0) + 1);
		assert.ok([...perDay.values()].every((n) => n <= PLAN_RULES.maxBlocksPerDay));
	});

	it("never in the past: planning on Thursday afternoon starts after now", () => {
		const r = proposeWeek(base({ now: at(26, 15), targetMinutes: 200 }));
		assert.ok(r.proposals.every((p) => span(p).start > at(26, 15)));
	});

	it("last week's slots are used again (anchors)", () => {
		const r = proposeWeek(base({ targetMinutes: 100, lastWeek: [block("2026-11-17", "14:00"), block("2026-11-19", "10:00")] }));
		assert.deepEqual(r.proposals.map((p) => `${p.date} ${p.start} ${p.anchorOf}`), ["2026-11-24 14:00 2@14:00", "2026-11-26 10:00 4@10:00"]);
	});

	it("prefers the student's energy windows", () => {
		const r = proposeWeek(base({ targetMinutes: 150, routine: { energy: ["evening"], commitments: [] } }));
		assert.ok(r.proposals.every((p) => p.start >= "17:00"), r.proposals.map((p) => p.start).join(", "));
	});

	it("accepted blocks count toward the target and are busy", () => {
		const existing = [block("2026-11-24", "10:00"), block("2026-11-25", "10:00")];
		const r = proposeWeek(base({ targetMinutes: 150, existing }));
		assert.equal(r.proposals.length, 1);
		assert.equal(r.plannedMinutes, 150);
		assert.ok(!r.proposals.some((p) => (p.date === "2026-11-24" || p.date === "2026-11-25") && p.start === "10:00"));
	});

	it("a target bigger than the week plans what fits and says so", () => {
		// Busy 08:00–22:00 every day but Saturday: room for two blocks.
		const routine = { energy: [], commitments: [{ label: "Work", weekdays: [1, 2, 3, 4, 5, 7], start: "08:00", end: "22:00" }] };
		const r = proposeWeek(base({ routine, targetMinutes: 600 }));
		assert.equal(r.fits, false);
		assert.equal(r.roomMinutes, 100);
		assert.equal(r.proposals.length, 2);
		assert.equal(PLAN_COPY.weekTooFull(r.roomMinutes), "Your week only has room for 1 h 40. I've planned that.");
	});

	it("a block right after a lecture studies that module; the rest follow the pacing order", () => {
		const focus = [{ lectureId: "gt-u1", module: "GT", reason: "keep-up" as const }, { lectureId: "hci-u1", module: "HCI", reason: "keep-up" as const }];
		const r = proposeWeek(base({ targetMinutes: 50, lectures: [lecture("hci", "HCI", 23, 9)], focus, firstTask: (id) => `${id}-q1` }));
		assert.equal(r.proposals[0]!.start, "11:15");
		assert.equal(r.proposals[0]!.lectureId, "hci-u1");
		assert.equal(r.proposals[0]!.firstTaskQuestionId, "hci-u1-q1");
	});
});

describe("the pacing rule", () => {
	const unit = (id: string, module: string, week: number, status: UnitStatus["status"], order = week): UnitStatus => ({ id, module, week, order, status, hasMaterials: true });
	const gt = { code: "GT", weekOneStart: "2026-09-28" }; // week 9 on Mon 23 Nov
	const units = [
		unit("w3", "GT", 3, "revisit"), unit("w5", "GT", 5, "revisit"), unit("w6", "GT", 6, "answered"),
		unit("w8", "GT", 8, "not-started"), unit("w9", "GT", 9, "not-started"), unit("w9b", "GT", 9, "revisit", 10),
	];
	it("keep up first, then capped catch-up, most recent gap first", () => {
		const r = pacedUnits({ modules: [gt], units, now: at(23, 9), blocks: 6 });
		assert.deepEqual(r.map((u) => `${u.lectureId}:${u.reason}`), ["w8:keep-up", "w9:keep-up", "w9b:keep-up", "w5:gap", "w3:gap"]);
	});
	it("catch-up never takes more than a third of the week", () => {
		const r = pacedUnits({ modules: [gt], units, now: at(23, 9), blocks: 3 });
		assert.deepEqual(r.map((u) => u.reason), ["keep-up", "keep-up", "gap"]);
	});
	it("units more than six weeks back wait for revision", () => {
		const r = pacedUnits({ modules: [{ code: "GT", weekOneStart: "2026-08-31" }], units, now: at(23, 9), blocks: 9 }); // week 13
		assert.ok(!r.some((u) => u.lectureId === "w3" || u.lectureId === "w5"), JSON.stringify(r));
	});
	it("a reading week lifts the cap: catch-up time", () => {
		// Week 1 began Mon 28 Sep, so Mon 23 Nov is the reading week after week 8.
		const r = pacedUnits({ modules: [{ code: "GT", weekOneStart: "2026-09-28", readingWeeks: [8] }], units, now: at(23, 9), blocks: 3 });
		assert.equal(r.filter((u) => u.reason === "gap").length, 2);
	});
	it("modules take turns", () => {
		const hci = [unit("h8", "HCI", 8, "not-started"), unit("h9", "HCI", 9, "not-started")];
		const r = pacedUnits({ modules: [gt, { code: "HCI", weekOneStart: "2026-09-28" }], units: [...units, ...hci], now: at(23, 9), blocks: 4 });
		// Keep-up alternates between modules; one block in four is reserved for GT's catch-up.
		assert.deepEqual(r.map((u) => `${u.module}:${u.reason}`), ["GT:keep-up", "HCI:keep-up", "GT:keep-up", "GT:gap"]);
	});
	it("no week set: the first units not yet started", () => {
		const r = pacedUnits({ modules: [{ code: "GT" }], units, now: at(23, 9), blocks: 2 });
		assert.deepEqual(r.map((u) => u.lectureId), ["w8", "w9"]);
	});
});

describe("the Sunday check-in", () => {
	it("counts blocks started last week and their minutes; never what wasn't done", () => {
		const blocks = [block("2026-11-17", "10:00", "started"), block("2026-11-19", "10:00", "started", 80), block("2026-11-20", "10:00", "accepted"), block("2026-11-24", "10:00", "started")];
		const s = lastWeekSummary(blocks, at(23, 19));
		assert.deepEqual([s.started, s.minutes], [2, 130]);
		assert.equal(s.text, "Last week: 2 blocks started, 2 h 10 min. How did it feel?");
	});
	const cases: Array<[string, number, Parameters<typeof proposeTarget>[1], number, number]> = [
		["too much: a step down", 240, "too-much", 600, 210],
		["too little: a step up", 240, "too-little", 600, 270],
		["about right: the same", 240, "about-right", 600, 240],
		["never below the minimum", 30, "too-much", 600, CHECKIN_RULES.minTargetMinutes],
		["never above the free time next week", 240, "too-little", 250, 250],
	];
	for (const [name, current, feeling, room, expected] of cases) it(name, () => assert.equal(proposeTarget(current, feeling, room), expected));
	it("the wording matches Appendix A", () => {
		assert.equal(PLAN_COPY.targetProposal(210), "Try 3 h 30 next week?");
		assert.equal(PLAN_COPY.keepTarget(240), "Keep 4 h");
	});
});

describe("no guilt in any wording (R-6, BC §6)", () => {
	const strings = [
		PLAN_COPY.weekTooFull(200), PLAN_COPY.checkin(0, 0), PLAN_COPY.checkin(3, 130), PLAN_COPY.targetProposal(90), PLAN_COPY.keepTarget(60), ...Object.values(PLAN_COPY.feelings),
		NUDGE_TEXT.n1("HCI", 5, 10), NUDGE_TEXT.n3("Tuesday"), NUDGE_TEXT.n4(3, 6), NUDGE_TEXT.block(50),
	];
	for (const s of strings) it(s, () => assert.doesNotMatch(s, /\b(overdue|behind|streak|you haven't)\b/i));
});

describe("the routine", () => {
	const ok = { energy: ["evening", "evening", "dawn"], commitments: [{ label: "Shift", weekdays: [6, 7, 9], start: "09:00", end: "17:00" }], places: ["Library", ""], weeklyTargetMinutes: 240 };
	it("cleans and accepts a good draft", () => {
		const r = validateRoutine(ok, "2026-11-23T10:00:00.000Z");
		assert.ok(r.ok);
		assert.deepEqual(r.ok && r.routine, { energy: ["evening"], commitments: [{ label: "Shift", weekdays: [6, 7], start: "09:00", end: "17:00" }], places: ["Library"], weeklyTargetMinutes: 240, preferredBlockMinutes: 50, confirmedAt: "2026-11-23T10:00:00.000Z" });
	});
	const bad: Array<[string, Record<string, unknown>, RegExp]> = [
		["no target", { ...ok, weeklyTargetMinutes: undefined }, /weekly target/],
		["an end before the start", { ...ok, commitments: [{ label: "Gym", weekdays: [1], start: "18:00", end: "17:00" }] }, /end after start/],
		["a block too long", { ...ok, preferredBlockMinutes: 180 }, /block length/],
	];
	for (const [name, draft, problem] of bad)
		it(`refuses ${name}`, () => {
			const r = validateRoutine(draft, "x");
			assert.ok(!r.ok && r.errors.some((e) => problem.test(e)), JSON.stringify(r));
		});
});
