/**
 * Screen copy that states figures (v0.1 F-120): every number comes from
 * policy.ts, so changing a budget or a default changes the copy with it.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	DEFAULT_PREFS,
	readsSummary,
	SESSION_BUDGETS,
	SESSION_COPY,
	SESSION_FAILURES,
	sessionFailure,
	sessionKindForNudge,
	type Lecture,
	type NudgeType,
	type SessionKind,
} from "../src/core/companion/index.ts";

describe("session copy reads its figures from policy", () => {
	const tryNow = SESSION_BUDGETS["try-now"];
	const post = SESSION_BUDGETS["post-lecture"];
	const cases: Array<[string, string, string]> = [
		["try-now card", SESSION_COPY.tryNow(), `${tryNow.questions} questions on your last lecture, about ${tryNow.minutes} minutes`],
		["first taste", SESSION_COPY.firstTaste(), `${tryNow.questions} questions on a sample lecture, about ${tryNow.minutes} minutes`],
		["quiz me", SESSION_COPY.quizMe(), `${post.questions} questions, about ${post.minutes} minutes`],
		["welcome back title", SESSION_COPY.welcomeBackQuestion(), `${tryNow.questions} questions on last week?`],
		["welcome back line", SESSION_COPY.welcomeBack(), `Welcome back. ${tryNow.questions} questions on last week?`],
		[
			"nudge limits",
			SESSION_COPY.nudgeLimits(DEFAULT_PREFS.quietHours),
			`Never during a lecture, never between ${DEFAULT_PREFS.quietHours.from} and ${DEFAULT_PREFS.quietHours.to}.`,
		],
	];
	for (const [name, actual, expected] of cases) it(name, () => assert.equal(actual, expected));

	it("the v0.0 wording is unchanged at today's budgets", () => {
		assert.equal(SESSION_COPY.tryNow(), "3 questions on your last lecture, about 3 minutes");
		assert.equal(SESSION_COPY.quizMe(), "5 questions, about 10 minutes");
		assert.equal(SESSION_COPY.nudgeLimits({ from: "22:00", to: "08:00" }), "Never during a lecture, never between 22:00 and 08:00.");
	});
});

describe("the session a nudge opens", () => {
	const cases: Array<[NudgeType, SessionKind]> = [
		["N-1", "post-lecture"],
		["N-2", "retest"],
		["N-3", "missed-lecture"],
		["N-4", "post-lecture"],
		["block", "block"],
	];
	for (const [type, kind] of cases) it(`${type} → ${kind}`, () => assert.equal(sessionKindForNudge(type), kind));
});

describe('"What I read" names the source', () => {
	const lectures: Lecture[] = [];
	const cases: Array<[string, "sample" | "ics", "file" | "link" | undefined, string]> = [
		["sample timetable", "sample", undefined, "Sample timetable"],
		["uploaded .ics file", "ics", "file", "Your timetable (.ics)"],
		["calendar link", "ics", "link", "Your calendar link"],
		["ics with no via defaults to file", "ics", undefined, "Your timetable (.ics)"],
	];
	for (const [name, source, via, label] of cases) it(name, () => assert.equal(readsSummary(lectures, source, undefined, via).label, label));
});

describe("a failed session says what happened and offers one action (v1.0 T-6)", () => {
	const cases: Array<[string | undefined, keyof typeof SESSION_FAILURES]> = [
		["no_question", "no_question"],
		["probe_not_done", "no_question"],
		["timeout", "timeout"],
		["turn_failed", "no_answer"],
		["engine_error", "no_answer"],
		["lh_502", "no_answer"],
		["ChatGPT request failed. Check your connection and ChatGPT usage, then retry.", "no_answer"],
		["models_not_configured", "not_connected"],
		["provider_key_missing", "not_connected"],
		["no_scripted_set", "other"],
		["unsupported_question:probe", "other"],
		[undefined, "other"],
	];
	for (const [code, kind] of cases) it(`${code ?? "(no code)"} → ${kind}`, () => assert.equal(sessionFailure(code).kind, kind));

	it("only a missing connection sends the student to Connect; everything else is Try again", () => {
		for (const [kind, f] of Object.entries(SESSION_FAILURES)) assert.equal(f.action, kind === "not_connected" ? "connect" : "retry");
	});

	it("no failure names the engine, a code or 'stuck'", () => {
		for (const f of Object.values(SESSION_FAILURES)) assert.doesNotMatch(f.says, /engine|stuck|code|error|_/i);
	});
});
