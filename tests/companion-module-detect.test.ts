/**
 * Modules from a calendar (v0.1 onboarding, DECISIONS.md V-17). Titles are
 * invented but follow the formats seen in real feeds (Canvas brackets,
 * "CODE: title", plain repeating titles).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { codeFromName, detectModules, icsToLectures, MODULE_CODE_RE, parseSlashTitle, type IcsEvent } from "../src/core/companion/index.ts";

const ev = (...summaries: string[]) => summaries.map((summary) => ({ summary }));
const brief = (events: ReturnType<typeof ev>) => detectModules(events).map((m) => `${m.code}|${m.name}|${m.events}|${m.confident ? "tick" : "untick"}`);

describe("modules found in a calendar", () => {
	const cases: Array<[string, ReturnType<typeof ev>, string[]]> = [
		[
			"Canvas-style bracket tags, one module per tag",
			ev("Summative assignment 1 [2LALG(4) - Linear Algebra]", "Summative assignment 2 [2LALG(4) - Linear Algebra]", "Problem sheet 3 [2STAT - Statistics]"),
			["2LALG|Linear Algebra|2|tick", "2STAT|Statistics|1|tick"],
		],
		[
			'"CODE: title" lectures',
			ev("HCI: Personas and scenarios", "HCI: Fieldwork", "GT - Nash equilibrium"),
			["HCI|HCI|2|tick", "GT|GT|1|tick"],
		],
		[
			"plain titles that repeat become an unticked suggestion",
			ev("Organic Chemistry Lecture 1", "Organic Chemistry Lecture 2", "Organic Chemistry Lab", "Dentist"),
			["OC|Organic Chemistry|3|untick"],
		],
		["one-off events are not modules", ev("Dentist", "Birthday party"), []],
		[
			"a repeating title is not suggested twice when a tag already named it",
			ev("Linear Algebra", "Linear Algebra", "Quiz [2LALG(4) - Linear Algebra]"),
			["2LALG|Linear Algebra|1|tick"],
		],
		["an empty calendar", ev(), []],
	];
	for (const [name, events, expected] of cases) it(name, () => assert.deepEqual(brief(events), expected));

	it("every detected code is a valid module code", () => {
		const events = ev("[2LALG(4) - Linear Algebra] x", "Mid-Module Survey", "Mid-Module Survey", "HCI: a");
		for (const m of detectModules(events)) assert.match(m.code, MODULE_CODE_RE, m.code);
	});
});

describe("a code for a typed module", () => {
	const cases: Array<[string, string, string[], string]> = [
		["initials of a multi-word name", "Organic Chemistry", [], "OC"],
		["a single word keeps its start", "Statistics", [], "STATIS"],
		["a clash gets a number", "Game Theory", ["GT"], "GT2"],
		["punctuation is ignored", "Human-Computer Interaction", [], "HCI"],
	];
	for (const [name, input, taken, code] of cases) it(name, () => assert.equal(codeFromName(input, new Set(taken)), code));
});

describe("Birmingham's timetable feed (mybhamtimetable, 24 Nov)", () => {
	// Made-up events in the feed's exact title format: level prefix, name, (number), "/", activity.
	const at = (d: number, h: number) => new Date(2026, 10, d, h);
	const ev = (summary: string, d: number, h: number): IcsEvent => ({ uid: `${summary}@${d}`, summary, start: at(d, h), end: at(d, h + 1) });
	const events = [
		ev("LH Human Computer Interaction (11939)/Lecture", 23, 15),
		ev("LH Human Computer Interaction (11939)/Drop-In", 24, 11),
		ev("LH Human Computer Interaction (11939)/Lecture", 30, 15),
		ev("LH Game Theory and Multicriteria Decision Making(12571)/Lecture", 24, 10),
		ev("LH Game Theory and Multicriteria Decision Making(12571)/Guided Study", 25, 10),
		ev("LI Neural Computation (13716)/Tutorial", 26, 12),
		ev("LH Research Skills in Mathematics(10629)/Introduction to Research Skills in Mathematics", 24, 9),
	];
	it("one clean module per number, ticked, whatever the activity", () => {
		const mods = detectModules(events);
		assert.deepEqual(mods.map((m) => [m.code, m.name, m.events, m.confident]), [
			["HCI", "Human Computer Interaction", 3, true],
			["GTAMDM", "Game Theory and Multicriteria Decision Making", 2, true],
			["NC", "Neural Computation", 1, true],
			["RSIM", "Research Skills in Mathematics", 1, true],
		]);
	});
	it("only a Lecture is a lecture; the rest is busy time, titled by its activity", () => {
		const mods = detectModules(events).map((m) => ({ code: m.code, name: m.name }));
		const { lectures, unmapped } = icsToLectures(events, mods);
		assert.equal(unmapped.length, 0);
		const row = (l: (typeof lectures)[number]) => `${l.module} ${l.kind} ${l.title}`;
		assert.deepEqual(lectures.map(row), [
			"HCI lecture Lecture",
			"HCI event Drop-In",
			"HCI lecture Lecture",
			"GTAMDM lecture Lecture",
			"GTAMDM event Guided Study",
			"NC event Tutorial",
			"RSIM event Introduction to Research Skills in Mathematics",
		]);
	});
	it("parses the title parts, and leaves other formats alone", () => {
		assert.deepEqual(parseSlashTitle("LH Linear Algebra & Linear Programming(11542)/Guided Study"), { name: "Linear Algebra & Linear Programming", id: "11542", activity: "Guided Study" });
		assert.equal(parseSlashTitle("Lecture [2LALG(4) - Linear Algebra]"), null);
		assert.equal(parseSlashTitle("HCI: Personas"), null);
	});
});
