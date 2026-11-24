/**
 * Course units and the module calendar (v0.1 V-18, spec §5.5, F-104).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkProposal, currentWeek, proposeWithoutAi, titleFromName, wantsAiSplit, weekFromName, weekOneStartFor, type UnitPage } from "../src/core/companion/index.ts";

const pages = (...titles: string[]): UnitPage[] => titles.map((title, i) => ({ number: i + 1, title, chars: title ? 200 : 0 }));

describe("week from a file name", () => {
	const cases: Array<[string, number | null]> = [
		["GT_Week03_nash.pdf", 3],
		["week 10 - auctions.pdf", 10],
		["HCI-wk2.pdf", 2],
		["Lecture W7 slides.pdf", 7],
		["notes.md", null],
		["Year 2 revision pack.pdf", null],
		["week99.pdf", null],
		["2026 slides.pdf", null],
	];
	for (const [name, week] of cases) it(name, () => assert.equal(weekFromName(name), week));
	it("titles drop the week and the separators", () => assert.equal(titleFromName("GT_Week03_nash-equilibrium.pdf"), "GT nash equilibrium"));
});

describe("units without the AI", () => {
	it("a file named for one week is one confident unit, titled from its first slide", () => {
		const r = proposeWithoutAi({ name: "Week 4.pdf", pages: pages("Mixed strategies", "Example", "Summary") });
		assert.deepEqual(r, { units: [{ title: "Mixed strategies", week: 4, pages: [1, 3] }], via: "name", confident: true });
	});

	it("a semester file with Week headings splits at them", () => {
		const r = proposeWithoutAi({ name: "semester.pdf", pages: pages("Course overview", "Week 1: Dominance", "x", "Week 2 - Nash", "y", "z") });
		assert.equal(r.confident, true);
		assert.deepEqual(r.units, [
			{ title: "Dominance", week: 1, pages: [1, 3] },
			{ title: "Nash", week: 2, pages: [4, 6] },
		]);
	});

	it("anything else is one unit with an unknown week, and the AI may improve it", () => {
		const file = { name: "slides.pdf", pages: pages(...Array.from({ length: 40 }, (_, i) => `Slide ${i}`)) };
		assert.deepEqual(proposeWithoutAi(file), { units: [{ title: "Slide 0", week: 0, pages: [1, 40] }], via: "fallback", confident: false });
		assert.equal(wantsAiSplit(file, 12), true);
		assert.equal(wantsAiSplit({ name: "short.md", pages: pages("a", "b") }, 12), false, "a short file isn't worth a call");
		assert.equal(wantsAiSplit({ name: "Week 3.pdf", pages: file.pages }, 12), false, "a week in the name is enough");
	});
});

describe("checking an AI proposal", () => {
	const ok = [{ title: "Dominance", week: 1, pages: [1, 10] as [number, number] }, { title: "Nash", week: 2, pages: [11, 20] as [number, number] }];
	const cases: Array<[string, Parameters<typeof checkProposal>[0], RegExp | null]> = [
		["a good split", ok, null],
		["nothing proposed", [], /at least one/],
		["pages past the end", [{ ...ok[0]!, pages: [1, 25] }], /within 1 to 20/],
		["overlapping units", [ok[0]!, { ...ok[1]!, pages: [10, 20] }], /overlap/],
		["out of order", [ok[1]!, ok[0]!], /overlap or are out of order/],
		["an empty title", [{ ...ok[0]!, title: " " }], /title/],
		["a silly week", [{ ...ok[0]!, week: 60 }], /week must be/],
	];
	for (const [name, units, problem] of cases)
		it(name, () => {
			const r = checkProposal(units, 20);
			if (problem) assert.match(r ?? "", problem);
			else assert.equal(r, null);
		});
});

describe("the module calendar", () => {
	const monday = (d: number) => new Date(2026, 10, d, 12); // Mon 2, 9, 16, 23, 30 Nov 2026
	it("this is week 8 on Mon 23 Nov → week 1 began Mon 5 Oct", () => assert.equal(weekOneStartFor(monday(23), 8), "2026-10-05"));
	it("a reading week after week 6 pushes week 1 back a week", () => assert.equal(weekOneStartFor(monday(23), 8, [6]), "2026-09-28"));

	const cases: Array<[string, Parameters<typeof currentWeek>[0], Date, { week: number | null; reading: boolean }]> = [
		["not set", {}, monday(23), { week: null, reading: false }],
		["week 1", { weekOneStart: "2026-11-23" }, monday(23), { week: 1, reading: false }],
		["midweek counts as the same week", { weekOneStart: "2026-11-23" }, new Date(2026, 10, 27, 18), { week: 1, reading: false }],
		["three weeks on", { weekOneStart: "2026-11-02" }, monday(23), { week: 4, reading: false }],
		["the reading week after week 2", { weekOneStart: "2026-11-02", readingWeeks: [2] }, monday(16), { week: 2, reading: true }],
		["after the reading week, the count resumes", { weekOneStart: "2026-11-02", readingWeeks: [2] }, monday(23), { week: 3, reading: false }],
		["before term", { weekOneStart: "2026-11-30" }, monday(23), { week: null, reading: false }],
	];
	for (const [name, module, now, expected] of cases) it(name, () => assert.deepEqual(currentWeek(module, now), expected));

	it('"this is week N" and the current week agree, with reading weeks', () => {
		for (const week of [1, 5, 6, 7, 11]) {
			const start = weekOneStartFor(monday(23), week, [6]);
			assert.deepEqual(currentWeek({ weekOneStart: start, readingWeeks: [6] }, monday(23)), { week, reading: false }, `week ${week}`);
		}
		const inReading = weekOneStartFor(monday(23), 6, [6], true);
		assert.deepEqual(currentWeek({ weekOneStart: inReading, readingWeeks: [6] }, monday(23)), { week: 6, reading: true });
	});
});

describe("notes and pasted text as pages", () => {
	it("one page per heading, so a Canvas summary splits by week", async () => {
		const { textToPages } = await import("../src/core/companion/index.ts");
		const p = textToPages("Intro line\n\nWeek 1: Dominance\nDominated strategies...\n\nWeek 2 Nash\nBest responses...", 2500);
		assert.deepEqual(p.map((x) => x.markdown.split("\n")[0]), ["Intro line", "Week 1: Dominance", "Week 2 Nash"]);
	});
	it("text with no headings is cut by size at paragraph breaks", async () => {
		const { textToPages } = await import("../src/core/companion/index.ts");
		const para = "x".repeat(60);
		const p = textToPages(Array.from({ length: 10 }, () => para).join("\n\n"), 200);
		assert.ok(p.length >= 3 && p.every((x) => x.markdown.length <= 200 + 70), `${p.length} pages`);
	});
});
