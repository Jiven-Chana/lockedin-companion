/** Opening-message builder (Appendix B) and slide handling (§7.5), plan §12.1. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	DEFAULT_PREFS,
	assembleSlidesMarkdown,
	buildOpeningMessage,
	estimateSlideTokens,
	parseSlideRefs,
	parseSlides,
	specFor,
	trimSlides,
	type Lecture,
	type Miss,
	type SessionKind,
} from "../src/core/companion/index.ts";

const now = new Date(2026, 10, 17, 13, 5);
const lecture: Lecture = {
	id: "hci-w3-personas", module: "HCI", title: "Personas and scenarios", week: 3, order: 3,
	start: new Date(2026, 10, 17, 11).toISOString(), end: new Date(2026, 10, 17, 13).toISOString(), kind: "lecture", hasMaterials: true,
};
const slides = "# Personas\n\n## Slide 1 — Intro\n\nHello\n\n## Slide 2 — Why personas\n\nBecause.\n";

describe("buildOpeningMessage", () => {
	it("post-lecture follows the Appendix B structure exactly", () => {
		const { text } = buildOpeningMessage({ spec: specFor("post-lecture", lecture.id, DEFAULT_PREFS), lecture, slidesMarkdown: slides, now });
		const lines = text.split("\n");
		assert.deepEqual(lines.slice(0, 9), [
			"APP SESSION",
			"Kind: post-lecture",
			"Module: HCI",
			"Lecture: Personas and scenarios (week 3), ended 13:00 today",
			"Goal: help me recall and use the main ideas from this lecture.",
			"Budget: 5 questions, about 10 minutes.",
			"Mode: question me first.",
			"Revisit: none.",
			"",
		]);
		assert.equal(lines[9], 'SLIDES (cite as "(Slide n)")');
		assert.match(text, /## Slide 2 — Why personas/);
	});

	for (const kind of ["post-lecture", "missed-lecture", "retest", "try-now", "block"] as SessionKind[]) {
		it(`builds a message for every kind: ${kind}`, () => {
			const { text } = buildOpeningMessage({ spec: specFor(kind, lecture.id, DEFAULT_PREFS), lecture, slidesMarkdown: slides, now });
			assert.match(text, new RegExp(`^Kind: ${kind}$`, "m"));
			assert.match(text, /^Budget: /m);
			assert.match(text, /^Mode: (question|show) me first\.$/m);
		});
	}

	it("missed lecture: show me first, three parts", () => {
		const { text } = buildOpeningMessage({ spec: specFor("missed-lecture", lecture.id, DEFAULT_PREFS), lecture: { ...lecture, attended: false }, slidesMarkdown: slides, now: new Date(2026, 10, 17, 19) });
		assert.match(text, /^Mode: show me first\.$/m);
		assert.match(text, /^Budget: 3 parts\. Each part: one short worked example, then 2 questions, about 5 minutes\. I may stop after any part\.$/m);
		assert.match(text, /\(I missed it\)/);
	});

	it("retest lists the misses and asks for fresh wording", () => {
		const misses: Miss[] = [{
			id: "m1", lectureId: lecture.id, sessionId: "s", questionId: "q", questionText: "Which is the main purpose\nof a persona?",
			correctLabels: ["Focus decisions"], explanation: "Because (Slide 4).", reason: "wrong", status: "open", timesSeen: 0, nextDue: now.toISOString(), createdAt: now.toISOString(),
		}];
		const { text } = buildOpeningMessage({ spec: specFor("retest", lecture.id, DEFAULT_PREFS, ["m1"]), lecture, slidesMarkdown: slides, misses, now });
		assert.match(text, /^Budget: 3 questions, about 4 minutes\.$/m);
		assert.match(text, /^1\. Q: Which is the main purpose of a persona\? \| Answer: Focus decisions \| Why: Because \(Slide 4\)\.$/m);
		assert.match(text, /Never reuse the wording\./);
	});

	it("keeps the slides under the token budget", () => {
		const big = Array.from({ length: 40 }, (_, i) => `## Slide ${i + 1} — Topic ${i + 1}\n\n${"word ".repeat(400)}`).join("\n\n");
		const { text, slidesTrimmed } = buildOpeningMessage({ spec: specFor("post-lecture", lecture.id, DEFAULT_PREFS), lecture, slidesMarkdown: big, now, slideTokenBudget: 2_000 });
		assert.ok(slidesTrimmed);
		assert.ok(estimateSlideTokens(text) < 2_300, `${estimateSlideTokens(text)} tokens`);
		assert.match(text, /## Slide 40 — Topic 40/, "every slide heading survives, so citations stay valid");
	});
});

describe("trimSlides", () => {
	it("drops speaker notes and repeated footers before cutting content", () => {
		const md = [1, 2, 3, 4].map((n) => `## Slide ${n} — T${n}\n\nPoint ${n}\nCOMP1001 · University of Birmingham\nNotes:\nsay this out loud`).join("\n\n");
		const { markdown, trimmed } = trimSlides(md, 10_000);
		assert.ok(trimmed);
		assert.doesNotMatch(markdown, /University of Birmingham/);
		assert.doesNotMatch(markdown, /say this out loud/);
		assert.match(markdown, /Point 4/);
	});

	it("leaves small decks alone", () => {
		assert.equal(trimSlides(slides, 8_000).trimmed, false);
	});
});

describe("slides", () => {
	it("assembles converted PDF pages and flags pages with no text (no OCR)", () => {
		const a = assembleSlidesMarkdown([
			{ number: 1, kind: "text", markdown: "# Personas\nWhy they matter" },
			{ number: 2, kind: "image-only" },
			{ number: 3, kind: "text", markdown: "Scenarios" },
		], "Personas and scenarios");
		assert.deepEqual(a.needsCaption, [2]);
		assert.deepEqual(parseSlides(a.markdown).map((s) => [s.number, s.title]), [[1, "Personas"], [2, "(no text on this slide: add a one-line caption)"], [3, "Scenarios"]]);
		assert.match(a.markdown, /^### Personas$/m, "page headings are demoted below slide headings");
	});

	it("parses slide citations", () => {
		assert.deepEqual(parseSlideRefs("See (Slide 4). Also (Slides 6–8) and (slide 2, 10) and (Slides 3 and 5)."), [2, 3, 4, 5, 6, 7, 8, 10]);
		assert.deepEqual(parseSlideRefs("Slide 4 without brackets"), []);
		assert.deepEqual(parseSlideRefs(undefined), []);
	});
});
