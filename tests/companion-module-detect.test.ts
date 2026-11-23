/**
 * Modules from a calendar (v0.1 onboarding, DECISIONS.md V-17). Titles are
 * invented but follow the formats seen in real feeds (Canvas brackets,
 * "CODE: title", plain repeating titles).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { codeFromName, detectModules, MODULE_CODE_RE } from "../src/core/companion/index.ts";

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
