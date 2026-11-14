/**
 * The nudge engine's rules (plan §7.6, §12.1): cap of 1 and 2; quiet hours;
 * never inside an event or block; N-2 only without N-1; snooze return not
 * counted; "I wasn't there" makes N-3 eligible; at most one N-3 a week;
 * priority; pre-warming; wording under 90 characters.
 *
 * Times are local. 17 Nov 2026 is a Tuesday.
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
	freeGapsOn,
	prewarmCandidates,
	snoozeReturnTime,
	specFor,
	type CompanionSession,
	type CompanionState,
	type Lecture,
	type Miss,
	type NudgeRecord,
	type Profile,
	type StudyBlock,
} from "../src/core/companion/index.ts";

const day = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m);
const TUE = (h: number, m = 0) => day(17, h, m);

function lecture(id: string, start: Date, end: Date, extra: Partial<Lecture> = {}): Lecture {
	return { id, module: "HCI", title: id, week: 3, order: 1, start: start.toISOString(), end: end.toISOString(), kind: "lecture", hasMaterials: true, ...extra };
}

function profile(prefs: Partial<Profile["prefs"]> = {}): Profile {
	return { createdAt: day(10, 9).toISOString(), modules: [{ code: "HCI", name: "HCI" }], timetableSource: "sample", prefs: { ...DEFAULT_PREFS, ...prefs }, appearance: DEFAULT_APPEARANCE };
}

function state(over: Partial<CompanionState> = {}): CompanionState {
	return { profile: profile(), lectures: [], blocks: [], sessions: [], misses: [], nudges: [], ...over };
}

function session(id: string, over: Partial<CompanionSession> = {}): CompanionSession {
	return { id, engine: "scripted", spec: specFor("post-lecture", "hci", DEFAULT_PREFS), budget: 5, answered: 0, createdAt: TUE(13).toISOString(), state: "ready", ...over };
}

function fired(type: NudgeRecord["type"], at: Date, over: Partial<NudgeRecord> = {}): NudgeRecord {
	return { id: `n-${type}-${at.getTime()}`, type, key: `${type}:${at.getTime()}`, firedAt: at.toISOString(), text: "…", ...over };
}

function miss(id: string, due: Date, over: Partial<Miss> = {}): Miss {
	return {
		id, lectureId: "hci", sessionId: "s0", questionId: id, questionText: "Q?", correctLabels: ["A"], reason: "wrong",
		status: "open", timesSeen: 0, nextDue: due.toISOString(), createdAt: day(16, 14).toISOString(), ...over,
	};
}

const HCI = lecture("hci", TUE(11), TUE(13));
const readyN1 = session("pre", { nudgeKey: "N-1:hci" });

const types = (s: CompanionState, now: Date) => dueNudges(s, now).map((c) => c.type);

describe("N-1 post-lecture", () => {
	it("fires 5 minutes after the lecture when the pre-warmed session is ready", () => {
		const s = state({ lectures: [HCI], sessions: [readyN1] });
		assert.deepEqual(types(s, TUE(13, 4)), []);
		const [c] = dueNudges(s, TUE(13, 5));
		assert.equal(c?.type, "N-1");
		assert.equal(c?.sessionId, "pre");
		assert.equal(c?.text, "HCI just finished. 5 questions on it, about 10 minutes?");
	});

	it("waits for the session until end + 15, then fires anyway", () => {
		const preparing = session("pre", { nudgeKey: "N-1:hci", state: "preparing" });
		assert.deepEqual(types(state({ lectures: [HCI], sessions: [preparing] }), TUE(13, 10)), []);
		assert.deepEqual(types(state({ lectures: [HCI], sessions: [preparing] }), TUE(13, 15)), ["N-1"]);
		assert.deepEqual(types(state({ lectures: [HCI] }), TUE(13, 15)), ["N-1"]);
	});

	it("needs 45 free minutes after the lecture", () => {
		const next = lecture("lab", TUE(13, 30), TUE(15), { kind: "event", hasMaterials: false });
		assert.deepEqual(types(state({ lectures: [HCI, next], sessions: [readyN1] }), TUE(13, 15)), []);
		const later = lecture("lab", TUE(13, 45), TUE(15), { kind: "event", hasMaterials: false });
		assert.deepEqual(types(state({ lectures: [HCI, later], sessions: [readyN1] }), TUE(13, 15)), ["N-1"]);
	});

	it("never for a lecture the student wasn't at, or one without slides", () => {
		assert.deepEqual(types(state({ lectures: [{ ...HCI, attended: false }] }), TUE(13, 20)), []);
		assert.deepEqual(types(state({ lectures: [{ ...HCI, hasMaterials: false }] }), TUE(13, 20)), []);
	});

	it("once a day at most, and never twice for the same lecture", () => {
		const second = lecture("hci2", TUE(15), TUE(16));
		const s = state({ lectures: [HCI, second], nudges: [fired("N-1", TUE(13, 5), { key: "N-1:hci" })] });
		assert.deepEqual(types({ ...s, profile: profile({ nudgesPerDay: 2 }) }, TUE(16, 20)), []);
	});

	it("is not needed when the student already opened a session on that lecture", () => {
		const studying = session("own", { spec: specFor("try-now", "hci", DEFAULT_PREFS), openedAt: TUE(13, 2).toISOString() });
		assert.deepEqual(types(state({ lectures: [HCI], sessions: [studying] }), TUE(13, 20)), []);
	});
});

describe("global rules", () => {
	it("daily cap: 1 by default, 2 when chosen", () => {
		const missed = lecture("gt", day(16, 10), day(16, 12), { attended: false, module: "GT" });
		const base = state({ lectures: [missed], nudges: [fired("N-1", TUE(13, 5))] });
		assert.deepEqual(types(base, TUE(19, 1)), []);
		assert.deepEqual(types({ ...base, profile: profile({ nudgesPerDay: 2 }) }, TUE(19, 11)), ["N-3"]);
	});

	it("never in quiet hours", () => {
		const missed = lecture("gt", day(16, 10), day(16, 12), { attended: false });
		const s = state({ lectures: [missed], profile: profile({ eveningTime: "21:30", quietHours: { from: "21:00", to: "08:00" } }) });
		assert.deepEqual(types(s, TUE(21, 45)), []);
	});

	it("never inside a timetabled event; fires once it is over", () => {
		const missed = lecture("gt", day(16, 10), day(16, 12), { attended: false });
		const evening = lecture("society", TUE(18, 30), TUE(19, 30), { kind: "event", hasMaterials: false });
		const s = state({ lectures: [missed, evening] });
		assert.deepEqual(types(s, TUE(19, 5)), []);
		assert.deepEqual(types(s, TUE(19, 31)), ["N-3"]);
	});

	it("never inside a study block (except the block's own start)", () => {
		const block: StudyBlock = { id: "b1", weekday: 2, start: "13:00", minutes: 60, skippedDates: [] };
		const s = state({ lectures: [HCI], blocks: [block], sessions: [readyN1] });
		assert.deepEqual(types(s, TUE(13, 5)), ["block"]);
		assert.deepEqual(types({ ...s, nudges: [fired("block", TUE(13), { key: "block:b1:2026-11-17" })] }, TUE(13, 20)), []);
	});

	it("a skipped block does not fire", () => {
		const block: StudyBlock = { id: "b1", weekday: 2, start: "15:00", minutes: 25, skippedDates: ["2026-11-17"] };
		assert.deepEqual(types(state({ lectures: [HCI], blocks: [block], nudges: [fired("N-1", TUE(13, 5))] }), TUE(15, 1)), []);
	});

	it("a block start does not count toward the cap (open decision 6 default)", () => {
		const block: StudyBlock = { id: "b1", weekday: 2, start: "16:00", minutes: 25, skippedDates: [] };
		const s = state({ lectures: [HCI], blocks: [block], nudges: [fired("N-1", TUE(13, 5))] });
		assert.deepEqual(types(s, TUE(16, 2)), ["block"]);
	});

	it("priority: N-4 beats N-1, one at a time", () => {
		// Snoozed at 10:00: the return is the first free gap an hour later, 13:00 (after the lecture).
		const snoozed = fired("N-2", TUE(9, 59), { id: "snz", sessionId: "s4", outcome: "snoozed", outcomeAt: TUE(10).toISOString() });
		const s = state({ lectures: [HCI], sessions: [readyN1, session("s4", { answered: 1 })], nudges: [snoozed] });
		const due = dueNudges(s, TUE(13, 5));
		assert.equal(due.length, 1);
		assert.equal(due[0]!.type, "N-4");
	});
});

describe("N-2 resurfaced miss", () => {
	const misses = [miss("m1", day(17, 8)), miss("m2", day(17, 8))];

	it("fires in a free gap when misses are due", () => {
		const [c] = dueNudges(state({ misses }), TUE(9, 15));
		assert.equal(c?.type, "N-2");
		assert.equal(c?.text, "The one you missed on Monday. 3 questions, about 4 minutes.");
		assert.deepEqual(c?.spec.missIds, ["m1", "m2"]);
	});

	it("never when N-1 fired today, or is still due later today", () => {
		assert.deepEqual(types(state({ misses, nudges: [fired("N-1", TUE(8, 30))], profile: profile({ nudgesPerDay: 2 }) }), TUE(9, 15)), []);
		assert.deepEqual(types(state({ misses, lectures: [HCI], profile: profile({ nudgesPerDay: 2 }) }), TUE(9, 15)), []);
	});

	it("needs at least 30 minutes left in the gap", () => {
		const soon = lecture("x", TUE(9, 30), TUE(10, 30), { hasMaterials: false, kind: "event" });
		assert.deepEqual(types(state({ misses, lectures: [soon] }), TUE(9, 15)), []);
	});

	it("only for misses that are due", () => {
		assert.deepEqual(types(state({ misses: [miss("m1", day(18, 8))] }), TUE(9, 15)), []);
		assert.deepEqual(types(state({ misses: [miss("m1", day(16, 8), { status: "solid" })] }), TUE(9, 15)), []);
	});
});

describe("N-3 missed lecture", () => {
	const missedTue = lecture("hci", TUE(11), TUE(13), { attended: false });

	it("\"I wasn't there\" makes the lecture eligible in the evening slot", () => {
		assert.deepEqual(types(state({ lectures: [HCI] }), TUE(19, 1)), []);
		const [c] = dueNudges(state({ lectures: [missedTue] }), TUE(19, 11));
		assert.equal(c?.type, "N-3");
		assert.equal(c?.text, "Missed Tuesday's lecture? Here it is in three 5-minute pieces.");
		assert.equal(c?.spec.mode, "show-first");
		assert.equal(c?.spec.budget.parts, 3);
	});

	it("at most once a week", () => {
		const recent = fired("N-3", day(14, 19), { key: "N-3:other" });
		assert.deepEqual(types(state({ lectures: [missedTue], nudges: [recent] }), TUE(19, 11)), []);
		const old = fired("N-3", day(9, 19), { key: "N-3:other" });
		assert.deepEqual(types(state({ lectures: [missedTue], nudges: [old] }), TUE(19, 11)), ["N-3"]);
	});

	it("not once the missed lecture has been studied to the end", () => {
		const done = session("d", { spec: specFor("missed-lecture", "hci", DEFAULT_PREFS), state: "done" });
		assert.deepEqual(types(state({ lectures: [missedTue], sessions: [done] }), TUE(19, 11)), []);
	});
});

describe("N-4 snooze return", () => {
	it("returns in the next free gap at least an hour later and does not count toward the cap", () => {
		const snoozed = fired("N-1", TUE(13, 5), { id: "n1", key: "N-1:hci", sessionId: "pre", outcome: "snoozed", outcomeAt: TUE(13, 6).toISOString() });
		const s = state({ lectures: [HCI], sessions: [{ ...readyN1, answered: 1 }], nudges: [snoozed] });
		assert.deepEqual(types(s, TUE(14, 5)), []);
		const [c] = dueNudges(s, TUE(14, 6));
		assert.equal(c?.type, "N-4");
		assert.equal(c?.sessionId, "pre");
		assert.equal(c?.text, "Picking up where you left off. 4 questions left, about 8 minutes.");
		assert.ok(c!.text.length < NUDGE_MAX_CHARS);
	});

	it("comes back tomorrow at the same point when today has no gap", () => {
		const busy = lecture("lab", TUE(14), TUE(22), { kind: "event", hasMaterials: false });
		const s = state({ lectures: [HCI, busy] });
		assert.equal(snoozeReturnTime(s, TUE(13, 6)).toISOString(), day(18, 13, 6).toISOString());
	});

	it("never for a finished session", () => {
		const snoozed = fired("N-1", TUE(13, 5), { id: "n1", sessionId: "pre", outcome: "snoozed", outcomeAt: TUE(13, 6).toISOString() });
		assert.deepEqual(types(state({ sessions: [{ ...readyN1, state: "done" }], nudges: [snoozed] }), TUE(14, 30)), []);
	});
});

describe("pre-warming (§6.3)", () => {
	it("starts preparing N-1 when the lecture ends, not before, and only once", () => {
		const s = state({ lectures: [HCI] });
		assert.deepEqual(prewarmCandidates(s, TUE(12, 59)), []);
		assert.deepEqual(types(s, TUE(14, 1)), [], "N-1 is stale an hour after the lecture");
		assert.equal(prewarmCandidates(s, TUE(13))[0]?.key, "N-1:hci");
		assert.deepEqual(prewarmCandidates(state({ lectures: [HCI], sessions: [readyN1] }), TUE(13, 1)), []);
	});

	it("does not prepare what the cap would never let fire", () => {
		const s = state({ lectures: [HCI], nudges: [fired("N-2", TUE(9))] });
		assert.deepEqual(prewarmCandidates(s, TUE(13, 1)), []);
	});

	it("prepares N-3 ten minutes before the evening slot", () => {
		const s = state({ lectures: [lecture("hci", TUE(11), TUE(13), { attended: false })] });
		assert.deepEqual(prewarmCandidates(s, TUE(18, 49)), []);
		assert.equal(prewarmCandidates(s, TUE(18, 50))[0]?.type, "N-3");
	});
});

describe("free gaps", () => {
	it("cover the waking day minus commitments", () => {
		const gaps = freeGapsOn({ lectures: [HCI], blocks: [] }, TUE(12), DEFAULT_PREFS.quietHours);
		assert.deepEqual(gaps.map((g) => [g.start.getHours(), g.end.getHours()]), [[8, 11], [13, 22]]);
	});
});

describe("wording and forced nudges", () => {
	it("every template stays under 90 characters", () => {
		for (const text of [
			NUDGE_TEXT.n1("HCI", 5, 10),
			NUDGE_TEXT.n1("COMP3001", 20, 40),
			NUDGE_TEXT.n2("Wednesday", 3, 4),
			NUDGE_TEXT.n3("Wednesday"),
			NUDGE_TEXT.n4(20, 40),
			NUDGE_TEXT.block(120),
		]) assert.ok(text.length < NUDGE_MAX_CHARS, text);
	});

	it("the facilitator can fire any type, or gets a reason", () => {
		const s = state({ lectures: [HCI] });
		const n1 = forcedCandidate(s, TUE(9), "N-1");
		assert.equal(typeof n1 === "object" && n1.type, "N-1");
		assert.equal(forcedCandidate(s, TUE(9), "N-2"), "no open misses to retest");
		assert.equal(forcedCandidate(s, TUE(9), "N-4"), "no snoozed nudge with a live session");
	});
});
