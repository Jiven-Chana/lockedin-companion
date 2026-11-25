/**
 * What LockedIn knows about you (v2.0 step 6; V-52, V-53): the pure rules
 * for the per-module notes.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildLearnOpening, capWords, cleanPrefs, howFromOthers, howNote, NOTE_RULES, notesForTutor, owesHowCard, wordCount, type HowPrefs, type Lecture, type ModuleNotes } from "../src/core/companion/index.ts";

describe("the first-time card's taps become one readable note (V-52)", () => {
	const cases: [string, HowPrefs, string][] = [
		["every row tapped", { start: "examples", steps: "small", check: "often" }, "Start each idea with a worked example. Small steps. Check me often."],
		["one row tapped: the others are left to the tutor", { steps: "big" }, "Bigger jumps: don't spell out what I can see."],
		["the student's own line comes last, as a sentence", { start: "explanations", more: "I hate analogies" }, "Explain each idea first, then ask. I hate analogies."],
		["only the typed line", { more: "Use football examples." }, "Use football examples."],
		["nothing chosen: no note", {}, ""],
	];
	for (const [name, prefs, expected] of cases) it(name, () => assert.equal(howNote(prefs), expected));

	it("only the card's own choices are kept, and the line is trimmed", () => {
		assert.deepEqual(cleanPrefs({ start: "examples", steps: "sideways", check: 3, more: "  two   words  ", extra: "x" }), { start: "examples", more: "two words" });
		assert.deepEqual(cleanPrefs(null), {});
		assert.equal(cleanPrefs({ more: "x".repeat(500) }).more?.length, NOTE_RULES.moreMax);
	});
});

describe("the notes are capped, so they can be handed over every session (V-53)", () => {
	it("a note over its cap is cut on a word", () => {
		const long = Array.from({ length: 130 }, (_, i) => `w${i}`).join(" ");
		const cut = capWords(long, NOTE_RULES.howWords);
		assert.equal(wordCount(cut), NOTE_RULES.howWords);
		assert.ok(cut.endsWith("w119…"));
		assert.equal(capWords("  short one ", 5), "short one");
	});
	it("the caps are the plan's: 120 words and 250 words", () => assert.deepEqual([NOTE_RULES.howWords, NOTE_RULES.whereWords], [120, 250]));
});

describe("once per module, and the same as my other modules", () => {
	const notes: Record<string, ModuleNotes> = {
		GT: { asked: true, how: { text: "Small steps.", at: "2026-11-20T10:00:00.000Z" } },
		HCI: { asked: true, how: { text: "Check me often.", at: "2026-11-22T10:00:00.000Z" } },
		NC: { asked: true },
	};
	it("a module is asked until it has been answered or skipped", () => {
		assert.equal(owesHowCard(notes, "LALP"), true);
		assert.equal(owesHowCard(notes, "NC"), false, "skipped counts as asked");
		assert.equal(owesHowCard({ LALP: { where: { text: "x", at: "", by: "ai" } } }, "LALP"), true);
	});
	it("the newest answer from another module is the one reused", () => {
		assert.equal(howFromOthers(notes, "LALP")?.text, "Check me often.");
		assert.equal(howFromOthers(notes, "HCI")?.text, "Small steps.");
		assert.equal(howFromOthers({ NC: { asked: true } }, "GT"), null);
	});
});

describe("the tutor is handed the notes at the start of a session", () => {
	it("as the student's own words, each on a line", () => {
		assert.deepEqual(notesForTutor({ how: "Small steps.", where: "Secure: best responses.\nShaky: mixed strategies.", last: "stopped at idea 2 of 5 (Mutual best replies)." }), [
			"",
			"ABOUT ME IN THIS MODULE (notes the app keeps; I can see and edit them)",
			"How I like to learn it: Small steps.",
			"Where I am: Secure: best responses. Shaky: mixed strategies.",
			"Last session: stopped at idea 2 of 5 (Mutual best replies).",
		]);
	});
	it("nothing is said when there is nothing to say", () => assert.deepEqual(notesForTutor({ how: "  " }), []));

	it("they sit in the first message, before the ideas and the slides", () => {
		const lecture: Lecture = { id: "gt-w2-nash", module: "GT", title: "Nash equilibrium", week: 2, order: 2, hasMaterials: true };
		const { text } = buildLearnOpening({
			spec: { kind: "learn", lectureId: lecture.id, mode: "question-first", budget: { questions: 0, minutes: 50 }, study: "learn", learn: { scope: "lecture", minutes: 50 } },
			lecture, now: new Date("2026-11-20T10:00:00.000Z"),
			units: [{ lecture, slidesMarkdown: "## Slide 1: Games\nA game has players.", slidesFile: "/x/slides.md", conceptMap: "graph TD\n  nash[\"Nash · S1\"]" }],
			notes: { how: "Start each idea with a worked example." },
		});
		assert.match(text, /Plan: at most 5 ideas\.\n\nABOUT ME IN THIS MODULE \(notes the app keeps; I can see and edit them\)\nHow I like to learn it: Start each idea with a worked example\.\n\nIDEAS/);
	});
});
