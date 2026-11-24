/**
 * The learning score (v1.1, V-34): what earns points, what never costs any,
 * the one way the score dips, and the series, steady-pace line and module
 * shares the Progress chart draws.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	fadingAt,
	IDEA_WORTH,
	moduleShares,
	paceAt,
	replayScore,
	SCORE_RULES,
	scoreAt,
	scoreSeries,
	termFor,
	type EventLogEntry,
	type PackIdea,
	type StudyBlock,
} from "../src/core/companion/index.ts";

const day = (d: number, h = 12, m = 0) => new Date(2026, 10, d, h, m); // November 2026; the 23rd is a Monday
const lectures = [
	{ id: "nc-gans", module: "NC", title: "GANs" },
	{ id: "gt-nash", module: "GT", title: "Nash equilibrium" },
];
const ideas: PackIdea[] = [
	{ lectureId: "nc-gans", nodeId: "generator", title: "The generator" },
	{ lectureId: "nc-gans", nodeId: "discriminator", title: "The discriminator" },
	{ lectureId: "gt-nash", nodeId: "best-response", title: "Best responses" },
];
/** Bank questions end -d1/-d2/-d3 by difficulty; anything else is a question the teacher wrote. */
const questionInfo = (id: string) => (/-d([123])$/.test(id) ? { difficulty: Number(id.at(-1)) } : undefined);

function answer(at: Date, lectureId: string, nodeId: string, over: Record<string, unknown> = {}): EventLogEntry {
	return { t: at.toISOString(), wall: at.toISOString(), type: "answer", data: { sessionId: "s1", lectureId, questionId: "q-d2", nodeId, graded: true, correct: true, dontKnow: false, msOnQuestion: 120_000, ...over } };
}
const block = (at: Date, over: Partial<StudyBlock> = {}): StudyBlock => ({ id: `b${at.getTime()}`, date: "2026-11-24", start: "14:00", minutes: 50, status: "started", source: "planner", startedAt: at.toISOString(), ...over });
const replay = (events: EventLogEntry[], blocks: StudyBlock[] = [], now = day(30)) => replayScore({ events, blocks, lectures, ideas, questionInfo, now });

describe("what earns points", () => {
	const cases: Array<[string, EventLogEntry[], number]> = [
		["a right answer on a medium question secures the idea", [answer(day(24), "nc-gans", "generator")], 15 + 20],
		["an easy one", [answer(day(24), "nc-gans", "generator", { questionId: "q-d1" })], 10 + 20],
		["a hard one", [answer(day(24), "nc-gans", "generator", { questionId: "q-d3" })], 20 + 20],
		["a question the teacher wrote counts as medium", [answer(day(24), "nc-gans", "generator", { questionId: "call_abc" })], 15 + 20],
		["a second right answer on the same idea earns the answer only", [answer(day(24), "nc-gans", "generator"), answer(day(24, 13), "nc-gans", "generator")], 35 + 15],
		["two ideas are secured separately", [answer(day(24), "nc-gans", "generator"), answer(day(24, 13), "nc-gans", "discriminator")], 70],
		["a wrong answer earns nothing and costs nothing", [answer(day(24), "nc-gans", "generator"), answer(day(24, 13), "nc-gans", "discriminator", { correct: false })], 35],
		["'I don't know' earns nothing and costs nothing", [answer(day(24), "nc-gans", "generator"), answer(day(24, 13), "nc-gans", "discriminator", { correct: false, dontKnow: true })], 35],
		["getting a wrong one right later is a comeback, worth more than a first try", [answer(day(24), "nc-gans", "generator", { correct: false }), answer(day(25), "nc-gans", "generator")], 15 + 25],
		["a secured idea got wrong keeps its points; getting it back is a comeback", [answer(day(24), "nc-gans", "generator"), answer(day(25), "nc-gans", "generator", { correct: false }), answer(day(26), "nc-gans", "generator")], 35 + 0 + 40],
		["an ungraded answer (a free-text reply) is not scored", [answer(day(24), "nc-gans", "generator", { graded: false })], 0],
	];
	for (const [name, events, expected] of cases) it(name, () => assert.equal(scoreAt(replay(events), day(27)), expected));

	it("the phone's answer to a notification's question counts, at the time it was answered on the phone", () => {
		const heard = day(25, 9);
		const onPhone = day(24, 18);
		const phone: EventLogEntry = { t: heard.toISOString(), wall: heard.toISOString(), type: "answered", data: { questionId: "nc-q-d1", lectureId: "nc-gans", correct: true, source: "phone", phoneAt: onPhone.toISOString() } };
		const r = replayScore({ events: [phone], blocks: [], lectures, ideas, questionInfo: () => ({ difficulty: 1, nodeId: "generator" }), now: day(30) });
		assert.equal(scoreAt(r, day(24, 19)), 10 + 20, "scored when the phone answered, not when the laptop heard");
		assert.deepEqual([r.moments[0]!.source, r.moments[0]!.ideaKey], ["phone", "nc-gans#generator"], "the idea comes from the study pack's question");
	});

	it("starting a planned study block earns a little; a block only accepted, or only announced, earns nothing", () => {
		const notification: EventLogEntry = { t: day(24).toISOString(), wall: day(24).toISOString(), type: "block_started", data: { nudgeId: "n1" } };
		const r = replay([notification], [block(day(24, 14), { module: "GT" }), block(day(25, 14), { status: "accepted", startedAt: undefined })]);
		assert.equal(scoreAt(r, day(27)), SCORE_RULES.blockStarted);
		assert.deepEqual([r.moments[0]!.kind, r.moments[0]!.module, r.moments[0]!.minutes], ["block", "GT", 50]);
	});

	it("learning earns far more than discipline", () => assert.ok(SCORE_RULES.rightAnswer[1]! + SCORE_RULES.ideaSecured >= 5 * SCORE_RULES.blockStarted));
});

describe("fading: the one way the score dips", () => {
	const events = [answer(day(1), "nc-gans", "generator"), answer(day(1, 13), "nc-gans", "discriminator")];

	it("an idea secured and left for 21 days takes a little off, and one right answer brings it back", () => {
		const r = replay([...events, answer(day(26), "nc-gans", "generator")]);
		assert.equal(scoreAt(r, day(21)), 70, "20 days on: nothing yet");
		assert.deepEqual(fadingAt(r, day(23)).sort(), ["nc-gans#discriminator", "nc-gans#generator"]);
		assert.equal(scoreAt(r, day(23)), 70 - 2 * SCORE_RULES.fadePoints);
		assert.deepEqual(fadingAt(r, day(27)), ["nc-gans#discriminator"], "the one got right again is back");
		assert.equal(scoreAt(r, day(27)), 70 + 15 - SCORE_RULES.fadePoints);
	});

	it("a wrong answer doesn't stop an idea fading: only getting it right does", () => {
		const r = replay([...events, answer(day(26), "nc-gans", "generator", { correct: false })]);
		assert.ok(fadingAt(r, day(27)).includes("nc-gans#generator"));
	});

	it("an idea never got right can't fade, and the score never goes below zero", () => {
		const r = replay([answer(day(1), "nc-gans", "generator", { correct: false })]);
		assert.deepEqual(fadingAt(r, day(30)), []);
		assert.equal(scoreAt(r, day(30)), 0);
	});

	it("the dip is small beside what securing an idea earns", () => assert.ok(SCORE_RULES.fadePoints * 4 <= SCORE_RULES.ideaSecured));
});

describe("the steady-pace line", () => {
	const r = replay([answer(day(24), "nc-gans", "generator")]);

	it("climbs straight from the first scored day to the last lecture, to what the whole course is worth", () => {
		const term = termFor(r, { ideas, lastLecture: day(24 + 10, 0), now: day(26) });
		assert.equal(term.target, 3 * IDEA_WORTH);
		assert.equal(term.start.getTime(), day(24, 0).getTime());
		assert.equal(paceAt(term, day(24, 0)), 0);
		assert.equal(paceAt(term, day(29, 0)), Math.round((3 * IDEA_WORTH) / 2), "halfway through, halfway up");
		assert.equal(paceAt(term, day(24 + 10, 0)), 3 * IDEA_WORTH);
		assert.equal(paceAt(term, day(24 + 20)), 3 * IDEA_WORTH, "and it stays there after the end of term");
	});

	it("with no timetable the term is 12 weeks; with no study packs there is no line", () => {
		const term = termFor(r, { ideas, lastLecture: null, now: day(26) });
		assert.equal(Math.round((term.end.getTime() - term.start.getTime()) / 86_400_000), SCORE_RULES.termWeeksWithoutTimetable * 7);
		assert.equal(paceAt(termFor(r, { ideas: [], lastLecture: null, now: day(26) }), day(26)), null);
	});

	it("before anything is scored, the term starts today", () => {
		const term = termFor(replay([]), { ideas, lastLecture: null, now: day(26, 15) });
		assert.equal(term.start.getTime(), day(26, 0).getTime());
	});
});

describe("the chart's points", () => {
	// Mon 23: one idea secured. Wed 25: a wrong answer, then a comeback and a block. Thu 26 is "now".
	const events = [answer(day(23, 10), "nc-gans", "generator"), answer(day(25, 10), "gt-nash", "best-response", { correct: false }), answer(day(25, 11), "gt-nash", "best-response")];
	const now = day(26, 9);
	const r = replay(events, [block(day(25, 14), { module: "GT" })], now);
	const term = termFor(r, { ideas, lastLecture: day(30 + 11, 0), now });

	it("this week, a point a day: the score so far, what the day earned, and nothing for days to come", () => {
		const week = scoreSeries(r, term, "week", now);
		assert.deepEqual(week.map((p) => p.date), ["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"]);
		assert.deepEqual(week.map((p) => p.score), [35, 35, 35 + 40 + 5, 80, 0, 0, 0]);
		assert.deepEqual(week.map((p) => p.gained), [35, 0, 45, 0, 0, 0, 0]);
		assert.deepEqual(week.map((p) => p.future), [false, false, false, false, true, true, true]);
		assert.ok(week.every((p) => p.pace !== null), "the pace line runs through the whole week");
		assert.ok(week[6]!.pace! > week[0]!.pace!);
	});

	it("a point says what happened that day", () => {
		const wed = scoreSeries(r, term, "week", now)[2]!.detail;
		assert.deepEqual([wed.answered, wed.right, wed.blocks], [2, 1, 1]);
		assert.deepEqual([wed.secured, wed.cameBack, wed.modules], [[], ["gt-nash#best-response"], ["GT"]]);
		assert.deepEqual(scoreSeries(r, term, "week", now)[0]!.detail.secured, ["nc-gans#generator"]);
	});

	it("the month is the last 30 days, ending today", () => {
		const month = scoreSeries(r, term, "month", now);
		assert.equal(month.length, 30);
		assert.deepEqual([month.at(-1)!.date, month.at(-1)!.score, month[0]!.score], ["2026-11-26", 80, 0]);
	});

	it("the term is a point a week from its start to its end", () => {
		const points = scoreSeries(r, term, "term", now);
		assert.equal(points[0]!.date, "2026-11-23");
		assert.equal(points.at(-1)!.pace, term.target, "the last week reaches the target");
		assert.deepEqual(points.map((p) => p.future), [false, true, true]);
		assert.equal(points[0]!.score, 80, "this week's point is the score now");
	});
});

describe("where it came from", () => {
	it("splits points and time by module; a module with nothing is still there", () => {
		const events = [answer(day(24, 10), "nc-gans", "generator"), answer(day(24, 10, 5), "nc-gans", "discriminator"), answer(day(25, 14, 10), "gt-nash", "best-response")];
		const r = replay(events, [block(day(25, 14), { module: "GT" })]);
		const shares = moduleShares(r, ["NC", "GT", "HCI"], day(23, 0), day(30, 0));
		assert.deepEqual(shares.map((s) => [s.module, s.points]), [["NC", 70], ["GT", 35 + 5], ["HCI", 0]]);
		assert.equal(shares[0]!.minutes, 4, "two answers of two minutes each");
		assert.equal(shares[1]!.minutes, 50, "an answer inside a started block is already in the block's time");
		assert.deepEqual([shares[2]!.minutes, shares[2]!.lastActivity], [0, null]);
		assert.equal(shares[0]!.lastActivity!.getTime(), day(24, 10, 5).getTime());
	});

	it("only counts the range asked for, but remembers when a module was last touched", () => {
		const r = replay([answer(day(3), "nc-gans", "generator")]);
		const [nc] = moduleShares(r, ["NC"], day(23, 0), day(30, 0));
		assert.deepEqual([nc!.points, nc!.lastActivity!.getTime()], [0, day(3).getTime()]);
	});

	it("a tab left open on a question is not an hour of study", () => {
		const r = replay([answer(day(24), "nc-gans", "generator", { msOnQuestion: 3_600_000 })]);
		assert.equal(moduleShares(r, ["NC"], day(23, 0), day(30, 0))[0]!.minutes, SCORE_RULES.maxMinutesPerAnswer);
	});
});
