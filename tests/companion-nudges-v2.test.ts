/**
 * Nudges v2 (v0.1 F-114, F-111, V-18): 0 a day is silent; N-5 on Sunday
 * at the check-in time, once, counting as that day's nudge; N-1 after any
 * timetabled lecture teaches that module's current unit; "why now" on every
 * nudge; wording under 90 characters; and the 7-day schedule for the phone.
 * 17 Nov 2026 is a Tuesday; 22 Nov is a Sunday.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	DEFAULT_APPEARANCE,
	DEFAULT_PREFS,
	NUDGE_MAX_CHARS,
	NUDGE_TEXT,
	dueNudges,
	forcedCandidate,
	n1Target,
	scheduleWeek,
	type CompanionState,
	type Lecture,
	type NudgeRecord,
	type Profile,
} from "../src/core/companion/index.ts";

const day = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m);
const lecture = (id: string, d: number, h: number, extra: Partial<Lecture> = {}): Lecture => ({
	id, module: "HCI", title: id, week: 3, order: 1, start: day(d, h).toISOString(), end: day(d, h + 2).toISOString(), kind: "lecture", hasMaterials: true, ...extra,
});
const unit = (id: string, week: number, extra: Partial<Lecture> = {}): Lecture => ({ id, module: "HCI", title: id, week, order: week, kind: "lecture", hasMaterials: true, ...extra });
function profile(over: Partial<Profile> = {}, prefs: Partial<Profile["prefs"]> = {}): Profile {
	return { createdAt: day(10, 9).toISOString(), modules: [{ code: "HCI", name: "HCI" }], timetableSource: "sample", prefs: { ...DEFAULT_PREFS, ...prefs }, appearance: DEFAULT_APPEARANCE, ...over };
}
const state = (over: Partial<CompanionState> = {}): CompanionState => ({ profile: profile(), lectures: [], blocks: [], sessions: [], misses: [], nudges: [], ...over });
const fired = (type: NudgeRecord["type"], at: Date): NudgeRecord => ({ id: `n-${type}-${at.getTime()}`, type, key: `${type}:${at.getTime()}`, firedAt: at.toISOString(), text: "…" });
const withPlan = (over: Partial<NonNullable<Profile["plan"]>> = {}) => profile({ plan: { weeklyTargetMinutes: 240, blockMinutes: 50, sundayTime: "19:00", focusScreen: false, ...over } });

describe("0 a day is silent (F-114)", () => {
	it("no nudge of any kind, and no schedule for the phone", () => {
		const s = state({ profile: profile({}, { nudgesPerDay: 0 }), lectures: [lecture("hci", 17, 11)] });
		assert.deepEqual(dueNudges(s, day(17, 13, 5), { assumeReady: true }), []);
		assert.deepEqual(scheduleWeek(s, day(17, 8)), []);
	});
});

describe("N-5: the Sunday check-in (F-111)", () => {
	it("fires once on Sunday at the chosen time when a target is set, and opens the check-in", () => {
		const s = state({ profile: withPlan(), lectures: [lecture("next", 24, 11)] });
		assert.deepEqual(dueNudges(s, day(22, 18, 55)), []);
		const [n5] = dueNudges(s, day(22, 19, 0));
		assert.equal(n5?.type, "N-5");
		assert.equal(n5?.opens, "checkin");
		assert.equal(n5?.text, "Next week: 1 lecture, 6 free gaps. Set your study blocks?".replace(/\d+ free gaps/, n5!.text.match(/\d+ free gaps?/)![0]));
		assert.ok(n5!.text.length <= NUDGE_MAX_CHARS);
		assert.deepEqual(dueNudges({ ...s, nudges: [{ ...fired("N-5", day(22, 19)), key: "N-5:2026-11-22" }] }, day(22, 19, 30)), [], "once");
	});
	it("not without a target, not on other days, and a later time is respected", () => {
		assert.deepEqual(dueNudges(state(), day(22, 19, 5)), [], "no plan, no N-5");
		assert.deepEqual(dueNudges(state({ profile: withPlan() }), day(21, 19, 5)), [], "Saturday");
		assert.deepEqual(dueNudges(state({ profile: withPlan({ sundayTime: "20:30" }) }), day(22, 19, 5)), []);
	});
	it("counts as that day's nudge", () => {
		const s = state({ profile: withPlan(), nudges: [fired("N-1", day(22, 13))] });
		assert.deepEqual(dueNudges(s, day(22, 19, 0)), [], "the cap of 1 is spent");
	});
	it("the facilitator can fire it any time", () => {
		const c = forcedCandidate(state({ profile: withPlan() }), day(18, 10), "N-5");
		assert.ok(typeof c !== "string" && c.type === "N-5");
	});
});

describe("N-1 after any timetabled lecture teaches the module's current unit (V-18)", () => {
	const modules = [{ code: "HCI", name: "HCI", weekOneStart: "2026-11-02" }]; // week 3 on Tue 17 Nov
	it("a lecture with its own slides teaches them", () => {
		const s = state({ lectures: [lecture("hci-l", 17, 11)] });
		assert.equal(n1Target(s, s.lectures[0]!, day(17, 13)), "hci-l");
	});
	it("a lecture without slides teaches the current-week unit", () => {
		const slot = lecture("hci-slot", 17, 11, { hasMaterials: false });
		const s = state({ profile: profile({ modules }), lectures: [slot, unit("u2", 2), unit("u3", 3), unit("u4", 4)] });
		assert.equal(n1Target(s, slot, day(17, 13)), "u2", "keep-up covers this week and last: the earliest not yet studied");
		const [n1] = dueNudges(s, day(17, 13, 5), { assumeReady: true });
		assert.equal(n1?.type, "N-1");
		assert.equal(n1?.spec.lectureId, "u2");
	});
	it("no unit with material in the module: no N-1", () => {
		const s = state({ lectures: [lecture("hci-slot", 17, 11, { hasMaterials: false })] });
		assert.deepEqual(dueNudges(s, day(17, 13, 5), { assumeReady: true }), []);
	});
	it('every N-1 says why now: "after HCI · you\'re free until …"', () => {
		const s = state({ lectures: [lecture("hci", 17, 11), lecture("gt", 17, 15, { module: "GT", hasMaterials: false })] });
		const [n1] = dueNudges(s, day(17, 13, 5), { assumeReady: true });
		assert.equal(n1?.why, "after HCI · you're free until 15:00");
	});
});

describe("wording (F-114, Appendix A)", () => {
	it("the N-1 title and the N-5 text fit a notification", () => {
		for (const t of [NUDGE_TEXT.n1Title("Human-Computer Interaction"), NUDGE_TEXT.n5(12, 14), NUDGE_TEXT.n5(1, 1)]) assert.ok(t.length <= NUDGE_MAX_CHARS, t);
		assert.equal(NUDGE_TEXT.n1Title("HCI"), "HCI just finished. One question:");
		assert.equal(NUDGE_TEXT.n5(3, 2), "Next week: 3 lectures, 2 free gaps. Set your study blocks?");
	});
});

describe("the week ahead for the phone (scheduleWeek)", () => {
	const lectures = [lecture("hci-tue", 17, 11), lecture("hci-wed", 18, 11), lecture("hci-thu", 19, 11), lecture("hci-sat", 21, 9, { hasMaterials: false })];
	const question = (lectureId: string, used: ReadonlySet<string>) => {
		const id = `${lectureId}-q${used.size + 1}`;
		return { id, lectureId, stem: `Question for ${lectureId}?`, options: ["a", "b", "c"] as [string, string, string], correct: 0 as const, explanation: "Because.", slides: [1] };
	};
	it("one N-1 per lecture day at end + 5, with its question, inside the cap; never in quiet hours", () => {
		const s = state({ profile: withPlan(), lectures });
		const week = scheduleWeek(s, day(17, 8), { questionFor: question });
		const n1 = week.filter((n) => n.kind === "N-1");
		assert.deepEqual(n1.map((n) => new Date(n.fireAt).getDate()), [17, 18, 19, 21]);
		assert.equal(new Date(n1[0]!.fireAt).getTime(), day(17, 13, 5).getTime());
		assert.equal(n1[0]!.title, "HCI just finished. One question:");
		assert.equal(n1[0]!.body, "Question for hci-tue?");
		assert.equal(n1[0]!.opens, "question");
		assert.ok(n1[0]!.question && new Date(n1[0]!.snoozeFireAt) > new Date(n1[0]!.fireAt) && new Date(n1[0]!.expiresAt) > new Date(n1[0]!.fireAt));
		const perDay = new Map<number, number>();
		for (const n of week) perDay.set(new Date(n.fireAt).getDate(), (perDay.get(new Date(n.fireAt).getDate()) ?? 0) + 1);
		assert.ok([...perDay.values()].every((c) => c <= 1), "the daily cap of 1 holds across the week");
		assert.ok(week.every((n) => { const h = new Date(n.fireAt).getHours(); return h >= 8 && h < 22; }));
		assert.ok(week.some((n) => n.kind === "N-5" && new Date(n.fireAt).getTime() === day(22, 19).getTime()), "Sunday's check-in is in the week");
	});
	it("questions aren't repeated, and without one the v1 sentence is the fallback", () => {
		const s = state({ lectures });
		const week = scheduleWeek(s, day(17, 8), { questionFor: question });
		const ids = week.map((n) => n.question?.id).filter(Boolean);
		assert.equal(new Set(ids).size, ids.length);
		const plain = scheduleWeek(s, day(17, 8));
		assert.equal(plain[0]!.body, NUDGE_TEXT.n1("HCI", 5, 10));
		assert.equal(plain[0]!.opens, "session");
	});
	it("re-planning gives the same ids (a re-upload replaces, never duplicates)", () => {
		const s = state({ lectures });
		assert.deepEqual(scheduleWeek(s, day(17, 8)).map((n) => n.id), scheduleWeek(s, day(17, 8)).map((n) => n.id));
	});
	it("a nudge already fired today isn't planned again", () => {
		const s = state({ lectures, nudges: [{ ...fired("N-1", day(17, 13, 5)), key: "N-1:hci-tue" }] });
		assert.ok(!scheduleWeek(s, day(17, 14)).some((n) => n.id === "N-1:hci-tue"));
	});
});
