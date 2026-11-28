/**
 * v3.0.1: what Jiven's own run-through of v3.0 changed. The Library says a
 * week once and only says something under a title when there is something to
 * say; Learn's bar says "Step 1 of 3"; a page change is a short fade-and-rise
 * in Calm as well as Full; Week sizes its hours to the window.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { LEARN_COPY, LIBRARY_COPY, MOTION, PROGRESS_COPY, WEEK_FIT, milestoneSummary, unitNotes, weekScale } from "../src/core/companion/index.ts";

const ROOT = path.join(import.meta.dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf-8");

describe("the line under a unit's title in the Library", () => {
	const cases: Array<[string, { attended?: boolean | null; hasMaterials: boolean }, boolean, string[]]> = [
		["a unit with material, in another week: nothing to say", { hasMaterials: true }, false, []],
		["this week's unit says so", { hasMaterials: true }, true, ["this week"]],
		["a lecture you missed", { hasMaterials: true, attended: false }, false, ["you weren't there"]],
		["a unit with no slides yet", { hasMaterials: false }, false, ["no material yet"]],
		["all three, in that order", { hasMaterials: false, attended: false }, true, ["this week", "you weren't there", "no material yet"]],
		["attended, or not known, says nothing", { hasMaterials: true, attended: null }, false, []],
	];
	for (const [name, unit, thisWeek, expected] of cases) it(name, () => assert.deepEqual(unitNotes(unit, thisWeek), expected));

	it("the words are the policy's", () => {
		assert.deepEqual(unitNotes({ hasMaterials: false, attended: false }, true), [LIBRARY_COPY.thisWeek, LIBRARY_COPY.notThere, LIBRARY_COPY.noMaterial]);
	});

	it("the Library no longer says where a unit came from, and names a week once", () => {
		const src = read("components/lockedin/screens/library.tsx");
		assert.ok(!src.includes("From your course material"));
		assert.equal(src.split("weekLabel(").length - 1, 1, "the week is written in one place: on the unit's row");
	});
});

describe("Learn's bar says which step you are on", () => {
	it("as 'Step 1 of 3'", () => {
		assert.equal(LEARN_COPY.stepOf(1, 3), "Step 1 of 3");
		assert.equal(LEARN_COPY.stepOf(3, 3), "Step 3 of 3");
	});
	it("a step still to come is not drawn with dashes, in the bar or in the plan", () => {
		const css = read("components/lockedin/lockedin.css");
		for (const rule of css.split("\n").filter((l) => /^\.li-(steps|plan)\b/.test(l))) assert.ok(!/dashed|dotted/.test(rule), rule.slice(0, 80));
	});
});

describe("a page change is a short fade-and-rise", () => {
	const css = read("components/lockedin/lockedin.css");
	it("lasts about a fifth of a second", () => {
		assert.ok(MOTION.pageMs >= 180 && MOTION.pageMs <= 240, String(MOTION.pageMs));
	});
	it("in Calm as well as Full: the rule is not tied to Full", () => {
		const rule = css.split("\n").find((l) => l.includes(".li-page > *") && l.includes("animation"));
		assert.ok(rule, "no rule animates what arrives on a page");
		assert.ok(!rule.includes('data-motion="full"'), rule);
		assert.match(rule, /var\(--li-m-page\)/);
	});
	it("Off and the system's reduce motion still switch every animation off", () => {
		assert.match(css, /\.li-root\[data-motion="off"\] \* \{ transition: none !important; animation: none !important; \}/);
		assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.li-root, \.li-root \* \{ transition: none !important; animation: none !important; \} \}/);
	});
});

describe("the Week timetable sizes its hours to the window", () => {
	const day = 14 * 60; // 08:00 to 22:00
	const cases: Array<[string, number | null, number, number]> = [
		["before the window is measured, the largest size", null, day, WEEK_FIT.maxPxPerMinute],
		["a 13-inch laptop: the whole day in the room there is", 470, day, 470 / day],
		["a tall window stops at the largest size, it does not stretch", 2000, day, WEEK_FIT.maxPxPerMinute],
		["a short window stops at the smallest size, and the page scrolls", 200, day, WEEK_FIT.minPxPerMinute],
		["no room at all", -50, day, WEEK_FIT.minPxPerMinute],
		["a shorter day gets taller hours in the same room", 470, 10 * 60, 470 / 600],
		["no minutes to show", 470, 0, WEEK_FIT.maxPxPerMinute],
	];
	for (const [name, room, minutes, expected] of cases) it(name, () => assert.equal(weekScale(room, minutes), expected));

	it("at the smallest size an hour is still tall enough for one line of text", () => {
		assert.ok(WEEK_FIT.minPxPerMinute * 50 >= 22, "a 50-minute block");
		assert.ok(WEEK_FIT.minPxPerMinute < WEEK_FIT.maxPxPerMinute);
	});
});

describe("the Milestones block on Progress says three things", () => {
	const m = (id: string, earnedAt: string | null) => ({ id, title: `T-${id}`, how: `how-${id}`, earnedAt });

	it("how many are earned, the latest one earned, and the next one to earn", () => {
		const s = milestoneSummary([m("a", "2026-11-24T10:00:00.000Z"), m("b", null), m("c", "2026-11-25T09:00:00.000Z"), m("d", null)]);
		assert.deepEqual([s.earned, s.total], [2, 4]);
		assert.equal(s.latest?.id, "c", "the most recent date");
		assert.equal(s.next?.id, "b", "the first in the list not yet earned");
	});
	it("nothing earned yet: no latest, and the first is next", () => {
		const s = milestoneSummary([m("a", null), m("b", null)]);
		assert.deepEqual([s.earned, s.total, s.latest, s.next?.id], [0, 2, null, "a"]);
	});
	it("everything earned: no next", () => {
		const s = milestoneSummary([m("a", "2026-11-24T10:00:00.000Z"), m("b", "2026-11-24T10:00:00.000Z")]);
		assert.deepEqual([s.earned, s.next], [2, null]);
		assert.equal(s.latest?.id, "b", "earned at the same moment: the later in the list");
	});
	it("no milestones at all", () => {
		assert.deepEqual(milestoneSummary([]), { earned: 0, total: 0, latest: null, next: null });
	});
	it("the words are the policy's", () => {
		assert.equal(PROGRESS_COPY.seeAll(15), "See all 15");
		assert.equal(PROGRESS_COPY.toRevisit, "To revisit");
		assert.equal(PROGRESS_COPY.latest, "Latest");
		assert.equal(PROGRESS_COPY.next, "Next");
	});
});

describe("Progress fits one screen: its long lists open in a panel", () => {
	const src = read("components/lockedin/screens/progress.tsx");
	it("the page marks itself as one that fills the window", () => {
		assert.ok(src.includes('className="li-fit li-fill"'));
	});
	it("all the milestones and every idea to revisit are in side panels, not down the page", () => {
		assert.equal(src.split("<SidePanel").length - 1, 2);
		assert.ok(src.indexOf("<GapsByIdea") > src.indexOf("<SidePanel"), "the ideas are inside a panel");
	});
});
