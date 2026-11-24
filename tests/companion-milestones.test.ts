/**
 * Milestones you keep, and "needs attention" (v1.1, V-35, V-36): what earns
 * each milestone and when, that none needs an unbroken chain, and which
 * gaps Progress names.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	earnedMilestones,
	MILESTONES,
	needsAttention,
	replayScore,
	SCORE_RULES,
	type EventLogEntry,
	type PackIdea,
	type StudyBlock,
} from "../src/core/companion/index.ts";

const day = (d: number, h = 12, m = 0) => new Date(2026, 10, d, h, m); // November 2026: Mondays are the 2nd, 9th, 16th, 23rd, 30th
const lectures = [
	{ id: "nc-gans", module: "NC", title: "GANs" },
	{ id: "gt-nash", module: "GT", title: "Nash equilibrium" },
	{ id: "gt-many", module: "GT", title: "Many ideas" },
];
const ideas: PackIdea[] = [
	{ lectureId: "nc-gans", nodeId: "generator", title: "The generator" },
	{ lectureId: "nc-gans", nodeId: "discriminator", title: "The discriminator" },
	{ lectureId: "gt-nash", nodeId: "best-response", title: "Best responses" },
];
const answer = (at: Date, lectureId: string, nodeId: string, over: Record<string, unknown> = {}): EventLogEntry => ({ t: at.toISOString(), wall: at.toISOString(), type: "answer", data: { sessionId: "s", lectureId, questionId: "q", nodeId, graded: true, correct: true, dontKnow: false, ...over } });
const log = (type: EventLogEntry["type"], at: Date, data: Record<string, unknown> = {}): EventLogEntry => ({ t: at.toISOString(), wall: at.toISOString(), type, data });
const block = (date: string, status: StudyBlock["status"], startedAt?: Date, over: Partial<StudyBlock> = {}): StudyBlock => ({ id: `${date}-${status}-${startedAt?.getTime() ?? 0}`, date, start: "14:00", minutes: 50, status, source: "planner", ...(startedAt ? { startedAt: startedAt.toISOString() } : {}), ...over });
const MODS = [{ code: "NC", hasMaterial: true }, { code: "GT", hasMaterial: true }];

function earned(events: EventLogEntry[], blocks: StudyBlock[] = [], now = day(30), modules = MODS) {
	const replay = replayScore({ events, blocks, lectures, ideas, questionInfo: () => undefined, now });
	return { replay, got: earnedMilestones({ replay, events, blocks, ideas, modules, now }) };
}
const dates = (got: Record<string, Date | undefined>) => Object.fromEntries(Object.entries(got).map(([k, v]) => [k, v!.getTime()]));

describe("learning milestones", () => {
	it("the first idea secured, dated when it happened", () => {
		const { got } = earned([answer(day(24), "nc-gans", "generator", { correct: false }), answer(day(25), "nc-gans", "discriminator")]);
		assert.equal(got["first-idea"]?.getTime(), day(25).getTime());
		assert.equal(got["came-back"], undefined);
	});

	it("an idea first got wrong, then right, is both a comeback and secured", () => {
		const { got } = earned([answer(day(24), "nc-gans", "generator", { correct: false }), answer(day(26), "nc-gans", "generator")]);
		assert.deepEqual(dates({ "first-idea": got["first-idea"], "came-back": got["came-back"] }), { "first-idea": day(26).getTime(), "came-back": day(26).getTime() });
	});

	it("10 ideas secured is earned on the tenth, and 25 is still to come", () => {
		const events = Array.from({ length: 12 }, (_, i) => answer(day(10 + i), "gt-many", `idea-${i}`));
		const { got } = earned(events);
		assert.equal(got["ideas-10"]?.getTime(), day(19).getTime());
		assert.equal(got["ideas-25"], undefined);
	});

	it("a whole unit: when the last idea in its study pack is secured", () => {
		const one = earned([answer(day(24), "nc-gans", "generator")]);
		assert.equal(one.got["unit-secured"], undefined, "one of two isn't the unit");
		const both = earned([answer(day(24), "nc-gans", "generator"), answer(day(27), "nc-gans", "discriminator")]);
		assert.equal(both.got["unit-secured"]?.getTime(), day(27).getTime());
	});

	it("ten comebacks", () => {
		const events = Array.from({ length: 10 }, (_, i) => [answer(day(2 + i, 9), "gt-many", `idea-${i}`, { correct: false }), answer(day(2 + i, 10), "gt-many", `idea-${i}`)]).flat();
		assert.equal(earned(events).got["comebacks-10"]?.getTime(), day(11, 10).getTime());
	});
});

describe("discipline milestones", () => {
	it("the first block started; a block only accepted isn't kept yet", () => {
		assert.equal(earned([], [block("2026-11-24", "accepted")]).got["first-block"], undefined);
		assert.equal(earned([], [block("2026-11-24", "started", day(24, 14))]).got["first-block"]?.getTime(), day(24, 14).getTime());
	});

	it("a full week: every accepted block started, and only once the week is over", () => {
		const kept = [block("2026-11-17", "started", day(17, 14)), block("2026-11-19", "started", day(19, 9))];
		assert.equal(earned([], kept, day(30)).got["full-week"]?.getTime(), day(19, 9).getTime());
		assert.equal(earned([], kept, day(20)).got["full-week"], undefined, "not while the week is still running");
		assert.equal(earned([], [...kept, block("2026-11-20", "accepted")], day(30)).got["full-week"], undefined, "one left unstarted");
		assert.ok(earned([], [...kept, block("2026-11-20", "removed"), block("2026-11-21", "proposed")], day(30)).got["full-week"], "removed and merely suggested blocks don't count against it");
	});

	it("three full weeks are any three: a week off in between loses nothing", () => {
		const weeks = [3, 10, 24].map((d) => block(`2026-11-${String(d).padStart(2, "0")}`, "started", day(d, 14)));
		const missed = block("2026-11-17", "accepted"); // the week of the 16th wasn't kept
		const { got } = earned([], [...weeks, missed], new Date(2026, 11, 2));
		assert.equal(got["full-weeks-3"]?.getTime(), day(24, 14).getTime());
	});

	it("the first Sunday check-in, and the first question answered on the phone", () => {
		const phone: EventLogEntry = { t: day(25).toISOString(), wall: day(25).toISOString(), type: "answered", data: { questionId: "q", lectureId: "nc-gans", correct: false, source: "phone", phoneAt: day(24, 18).toISOString() } };
		const { got } = earned([log("checkin_answered", day(22, 19)), phone]);
		assert.deepEqual(dates({ a: got["first-checkin"], b: got["first-phone"] }), { a: day(22, 19).getTime(), b: day(24, 18).getTime() });
	});
});

describe("well-rounded milestones", () => {
	it("two modules in one week; the same two in different weeks is not it", () => {
		assert.equal(earned([answer(day(17), "nc-gans", "generator"), answer(day(24), "gt-nash", "best-response")]).got["two-modules"], undefined);
		assert.equal(earned([answer(day(24), "nc-gans", "generator"), answer(day(26), "gt-nash", "best-response")]).got["two-modules"]?.getTime(), day(26).getTime());
	});

	it("every module with material in one week ignores modules that have none", () => {
		const events = [answer(day(24), "nc-gans", "generator"), answer(day(26), "gt-nash", "best-response")];
		assert.ok(earned(events, [], day(30), [...MODS, { code: "HCI", hasMaterial: false }]).got["all-modules"]);
		assert.equal(earned(events.slice(0, 1), [], day(30)).got["all-modules"], undefined);
	});

	it("a wrong answer in a module isn't points in it", () => {
		assert.equal(earned([answer(day(24), "nc-gans", "generator"), answer(day(26), "gt-nash", "best-response", { correct: false })]).got["two-modules"], undefined);
	});

	it("material for every module: dated by the upload that covered the last one", () => {
		const events = [log("materials_saved", day(20), { module: "NC" }), log("materials_saved", day(23), { module: "GT" })];
		assert.equal(earned(events).got["all-material"]?.getTime(), day(23).getTime());
		assert.equal(earned(events, [], day(30), [...MODS, { code: "HCI", hasMaterial: false }]).got["all-material"], undefined);
	});
});

describe("milestones in general", () => {
	it("a new student has none, and every milestone says how it is earned", () => {
		assert.deepEqual(earned([], [], day(30), [{ code: "NC", hasMaterial: false }, { code: "GT", hasMaterial: false }]).got, {});
		assert.equal(MILESTONES.length, 15);
		for (const m of MILESTONES) assert.ok(m.title && m.how.endsWith("."), m.id);
		assert.equal(new Set(MILESTONES.map((m) => m.id)).size, MILESTONES.length);
	});

	it("none of them is a streak: no wording about days in a row or keeping something going", () => {
		for (const m of MILESTONES) assert.doesNotMatch(`${m.title} ${m.how}`.replace("needn't be in a row", ""), /streak|in a row|consecutive|every day|daily|don't break/i, m.id);
	});
});

describe("needs attention", () => {
	const attention = (events: EventLogEntry[], modules = MODS, now = day(30)) => needsAttention({ replay: replayScore({ events, blocks: [], lectures, ideas, questionInfo: () => undefined, now }), modules, now });

	it("the module with nothing in the last two weeks, and for how long", () => {
		const items = attention([answer(day(29), "nc-gans", "generator"), answer(day(10), "gt-nash", "best-response")]);
		assert.deepEqual(items, [{ kind: "module", module: "GT", daysSince: 20 }]);
	});

	it("a module never touched says so, without a number of days", () => {
		assert.deepEqual(attention([answer(day(29), "nc-gans", "generator")])[0], { kind: "module", module: "GT", daysSince: null });
	});

	it("when every module has had something, only a clear laggard is named", () => {
		const even = [answer(day(28), "nc-gans", "generator"), answer(day(29), "gt-nash", "best-response")];
		assert.deepEqual(attention(even), [], "roughly even: nothing to say");
		const lopsided = [...Array.from({ length: 6 }, (_, i) => answer(day(22 + i), "gt-many", `idea-${i}`)), answer(day(29), "nc-gans", "generator")];
		assert.deepEqual(attention(lopsided), [{ kind: "module", module: "NC" }], "some, but far less than the others");
	});

	it("ideas fading: the unit with the most, and which ideas", () => {
		const items = attention([answer(day(1), "nc-gans", "generator"), answer(day(1, 13), "nc-gans", "discriminator"), answer(day(29), "gt-nash", "best-response")], MODS, day(30));
		assert.deepEqual(items.find((i) => i.kind === "fading"), { kind: "fading", module: "NC", lectureId: "nc-gans", nodes: ["generator", "discriminator"], count: 2 });
		assert.ok(SCORE_RULES.fadeAfterDays < 29);
	});

	it("modules with no material are named together, and are never the 'least done' one", () => {
		const items = attention([answer(day(29), "nc-gans", "generator"), answer(day(29), "gt-nash", "best-response")], [...MODS, { code: "HCI", hasMaterial: false }, { code: "RAC", hasMaterial: false }]);
		assert.deepEqual(items, [{ kind: "material", modules: ["HCI", "RAC"] }]);
	});

	it("at most one line of each kind", () => {
		const items = attention([answer(day(1), "nc-gans", "generator")], [...MODS, { code: "HCI", hasMaterial: false }]);
		assert.deepEqual(items.map((i) => i.kind), ["module", "fading", "material"]);
	});
});
