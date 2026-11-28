/**
 * Content and config guards — the cheap checks that keep demo day safe:
 *  - every scripted question set is valid and matches its slides;
 *  - the sample timetable references real content and runnable scenarios;
 *  - the seed settings survive LearnHarness's own settings sanitizer;
 *  - every prompt override targets an existing source segment, and the
 *    derived overrides are up to date with the upstream source.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { NUDGE_MAX_CHARS, parseSlideRefs, parseSlides, validateScriptedSet, type SampleTimetable } from "../src/core/companion/index.ts";
import { sanitizeUserSettings } from "../src/core/settings.ts";
import { buildDerivedPrompts } from "../companion/build-prompts.mjs";

const ROOT = path.join(import.meta.dirname, "..");
const CONTENT = path.join(ROOT, "companion", "content");
const lectureDirs = fs.readdirSync(CONTENT, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
const sample = JSON.parse(fs.readFileSync(path.join(CONTENT, "sample-timetable.json"), "utf-8")) as SampleTimetable;

describe("demo content", () => {
	for (const id of lectureDirs) {
		it(`${id}: slides have numbered headings; questions are valid and cite real slides`, () => {
			const slides = parseSlides(fs.readFileSync(path.join(CONTENT, id, "slides.md"), "utf-8"));
			assert.ok(slides.length >= 3, "at least 3 slides");
			assert.deepEqual(slides.map((s) => s.number), slides.map((_, i) => i + 1), "slides numbered 1..n");
			const qFile = path.join(CONTENT, id, "questions.json");
			if (!fs.existsSync(qFile)) return;
			const parsed = validateScriptedSet(JSON.parse(fs.readFileSync(qFile, "utf-8")));
			assert.ok(parsed.ok, parsed.ok ? "" : parsed.errors.join("; "));
			assert.equal(parsed.set.lectureId, id);
			const max = slides.length;
			for (const q of parsed.set.questions) {
				for (const n of parseSlideRefs(`${q.leadIn ?? ""} ${q.explanation} ${q.workedExample ?? ""}`)) assert.ok(n <= max, `${q.id} cites Slide ${n} of ${max}`);
				assert.ok(parseSlideRefs(q.explanation).length > 0, `${q.id}: explanations cite a slide (INT-01-g)`);
			}
		});
	}

	it("the two T23 lectures have enough questions for a session plus retest siblings", () => {
		for (const id of ["hci-w3-personas", "hci-w4-fieldwork"]) {
			const set = JSON.parse(fs.readFileSync(path.join(CONTENT, id, "questions.json"), "utf-8"));
			assert.ok(set.questions.filter((q: { retestOnly?: boolean }) => !q.retestOnly).length >= 5, id);
			assert.ok(set.questions.some((q: { retestOnly?: boolean }) => q.retestOnly), `${id} has retest siblings`);
		}
	});

	it("the sample timetable only references lectures with content, and scenarios are valid", () => {
		for (const l of sample.lectures) assert.ok(lectureDirs.includes(l.id), `${l.id} has a content folder`);
		for (const [name, s] of Object.entries(sample.scenarios ?? {})) {
			assert.ok(s.clock.weekday >= 1 && s.clock.weekday <= 7, name);
			for (const id of s.missed ?? []) assert.ok(sample.lectures.some((l) => l.id === id), `${name}: ${id}`);
		}
		for (const m of sample.modules) assert.ok(`${m.code} just finished. 5 questions on it, about 10 minutes?`.length < NUDGE_MAX_CHARS);
	});
});

describe("seed config", () => {
	it("settings.json survives LearnHarness's sanitizer with every switch intact", () => {
		const seed = JSON.parse(fs.readFileSync(path.join(ROOT, "companion", "seed", "settings.json"), "utf-8"));
		const clean = sanitizeUserSettings(seed);
		assert.ok(clean, "seed parses");
		assert.equal(clean!.graph?.enabled, false);
		assert.equal(clean!.graph?.rendering, false);
		// Learn switches the tutor's demos, visuals and research back on (V-54). Reading the student's PDFs directly stays off.
		assert.deepEqual(clean!.agent?.tools, { research: true, demo: true, visual: true, pdf: false, explain: true });
		assert.deepEqual(clean!.agent?.graphTools, { enabled: false });
		assert.deepEqual(clean!.agent?.fileAccess, { restricted: true, folders: [] });
		assert.deepEqual(Object.keys(clean!.agent?.prompts ?? {}).sort(), ["prober/10-probe-doctrine.md", "shared/40-formatting.md", "teacher/05-method.md", "teacher/10-planning.md"]);
	});

	it("every override has a source segment and is enabled in the seed", () => {
		const seed = JSON.parse(fs.readFileSync(path.join(ROOT, "companion", "seed", "settings.json"), "utf-8"));
		for (const rel of Object.keys(seed.agent.prompts)) {
			assert.ok(fs.existsSync(path.join(ROOT, "src", "agent", "prompts", rel)), `source segment ${rel}`);
			assert.ok(fs.existsSync(path.join(ROOT, "companion", "seed", "prompts", rel)), `override file ${rel}`);
		}
	});

	it("derived overrides are up to date with the upstream source (run npm run companion:prompts)", () => {
		for (const [rel, text] of Object.entries(buildDerivedPrompts())) {
			assert.equal(fs.readFileSync(path.join(ROOT, "companion", "seed", "prompts", rel), "utf-8"), text, rel);
		}
	});

	it("the env example documents every companion variable the server reads", () => {
		const example = fs.readFileSync(path.join(ROOT, "companion", "seed", ".env.local.example"), "utf-8");
		const server = fs.readFileSync(path.join(ROOT, "src", "server", "companion", "default.ts"), "utf-8");
		for (const name of new Set(server.match(/COMPANION_[A-Z_]+/g))) assert.match(example, new RegExp(name), name);
	});
});
