/**
 * v3.1 Part B: how a Learn session starts. Jiven, 28 Nov: "we should ask the
 * user what their intention is for the session. If they dont know give
 * suggestions, if they do know let them type out, then enter an optional
 * probe stage, from this stage we figure out their current knowledge in
 * actionable blocks from basic to advanced then we generate the plan off that."
 *
 * The first step is plain screen: no AI call until the student has said what
 * they want and whether to be checked first.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { buildLearnOpening, intentSuggestions, LEARN_COPY, LEARN_RULES, LEARN_SAYS, learnWhere, probeSize, whereLevel, type Lecture, type SessionSpec } from "../src/core/companion/index.ts";
import { newUserMessage, type LhMessage } from "../src/core/native-messages.ts";
import { assistant, text } from "./helpers/companion-lh.ts";

const ROOT = path.join(import.meta.dirname, "..");
const lecture: Lecture = { id: "nc-w8", module: "NC", title: "Generative adversarial networks", week: 8, order: 8, hasMaterials: true } as Lecture;
const spec = (learn: Partial<NonNullable<SessionSpec["learn"]>> = {}): SessionSpec => ({ kind: "learn", lectureId: lecture.id, mode: "question-first", budget: { questions: 0, minutes: 50 }, study: "learn", learn: { scope: "lecture", minutes: 50, ...learn } });
const base = { lecture, moduleName: "Neural Computation", now: new Date("2026-11-28T10:00:00Z"), units: [{ lecture, slidesMarkdown: "## Slide 1: GANs\nA generator and a discriminator.", slidesFile: "/d/nc-w8/slides.md", conceptMap: 'graph TD\n  gan["GANs · S1"]' }] };

describe("\"What do you want from this session?\": suggestions from the student's own module", () => {
	it("the unit they started from comes first, so one tap still starts it", () => {
		const s = intentSuggestions({ unit: { title: "Generative adversarial networks", week: 8 }, stopped: null, thisWeek: [], revisit: [] });
		assert.deepEqual(s[0], { id: "unit", label: "This unit: Generative adversarial networks", goal: "Teach me Generative adversarial networks." });
	});
	it("then where they stopped, this week's unit, what to revisit, and working through a sheet", () => {
		const s = intentSuggestions({
			unit: { title: "Generative adversarial networks", week: 8 },
			stopped: { idea: "The minimax objective", unit: "Generative adversarial networks" },
			thisWeek: [{ title: "Diffusion models", week: 9 }],
			revisit: ["Discriminator", "Generator prior", "Sampling", "Expected values"],
		});
		assert.deepEqual(s.map((x) => x.id), ["unit", "stopped", "week", "revisit", "sheet"]);
		assert.equal(s[1]!.label, "Pick up: The minimax objective");
		assert.equal(s[1]!.goal, "Carry on from The minimax objective in Generative adversarial networks.");
		assert.equal(s[2]!.label, "This week: Diffusion models");
		assert.equal(s[3]!.label, "4 ideas to revisit");
		assert.equal(s[3]!.goal, "Go back over what I got wrong: Discriminator, Generator prior, Sampling and 1 more.");
		assert.equal(s[4]!.label, "Work through a sheet");
		assert.equal(s[4]!.attach, true);
		assert.match(s[4]!.goal, /walk me through it/);
	});
	it("this week's unit is not offered twice when it is the unit they started from", () => {
		const s = intentSuggestions({ unit: { title: "GANs", week: 8 }, stopped: null, thisWeek: [{ title: "GANs", week: 8 }], revisit: [] });
		assert.deepEqual(s.map((x) => x.id), ["unit", "sheet"]);
	});
	it("one idea to revisit reads as one", () => {
		const s = intentSuggestions({ unit: null, stopped: null, thisWeek: [], revisit: ["Sampling"] });
		assert.deepEqual([s[0]!.label, s[0]!.goal], ["1 idea to revisit", "Go back over what I got wrong: Sampling."]);
	});
	it("with nothing known about the module, working through a sheet is still there", () => {
		assert.deepEqual(intentSuggestions({ unit: null, stopped: null, thisWeek: [], revisit: [] }).map((x) => x.id), ["sheet"]);
	});
});

describe("what the tutor is told about the check", () => {
	it("asked for: how many questions at most", () => {
		const { text: t } = buildLearnOpening({ ...base, spec: spec({ goal: "solve problems on GANs", check: true }) });
		assert.match(t, /What I want: solve problems on GANs/);
		assert.match(t, new RegExp(`Opening check: yes, at most ${probeSize("lecture")} questions\\.`));
		assert.doesNotMatch(t, /skipped/);
	});
	it("skipped: said plainly, so nothing is asked", () => {
		const { text: t } = buildLearnOpening({ ...base, spec: spec({ goal: "solve problems on GANs", check: false }) });
		assert.match(t, /Opening check: skipped\. Ask nothing; start from what I want\./);
		assert.doesNotMatch(t, /at most \d+ questions/);
	});
	it("a session from before v3.1 has no choice recorded and keeps the old line", () => {
		assert.match(buildLearnOpening({ ...base, spec: spec() }).text, /Opening questions: at most \d+\./);
	});
	it("a check is a few short questions: about two minutes", () => {
		assert.deepEqual(LEARN_RULES.probe, { week: 4, lecture: 4, section: 2 });
	});
});

describe("\"Where you are\": the check's result as blocks", () => {
	const cases: Array<[string, ReturnType<typeof whereLevel>]> = [
		["Solid: explained the two networks and what each wants.", "solid"],
		["solid", "solid"],
		["Shaky: right idea, could not say why.", "shaky"],
		["Not yet: has not met the objective.", "notyet"],
		["Not asked.", "unchecked"],
		["Not checked: the check was skipped.", "unchecked"],
		// What the tutor wrote before v3.1.
		["got it, and sure", "solid"],
		["right but guessing", "shaky"],
		["not yet", "notyet"],
		["Something the tutor made up.", "unchecked"],
	];
	for (const [said, level] of cases) it(`"${said}" is ${level}`, () => assert.equal(whereLevel(said), level));

	const call = (id: string, name: string, args: Record<string, unknown>) => ({ type: "toolCall" as const, id, name, arguments: args });
	const result = (toolCallId: string, toolName: string): LhMessage => ({ id: `r_${toolCallId}`, role: "toolResult", toolCallId, toolName, content: [{ type: "text", text: "ok" }], details: { ok: true }, isError: false, timestamp: 0 }) as unknown as LhMessage;
	const done = (strands: { strand: string; assessment: string }[]): LhMessage[] => [
		newUserMessage("LEARN SESSION\nModule: NC\n…"),
		assistant([call("pd", "probe_done", { assessment: { strands, summary: "Wants to solve GAN problems." } }), text("Thanks.")]),
		result("pd", "probe_done"),
	];

	it("each idea the goal needs is a block, in the order the tutor gave: basic first", () => {
		const where = learnWhere(done([
			{ strand: "What a generative model is", assessment: "Solid: said it in their own words." },
			{ strand: "Generator and discriminator", assessment: "Solid." },
			{ strand: "The discriminator's optimal form", assessment: "Shaky: knew the result, not where it comes from." },
			{ strand: "Solving the minimax objective", assessment: "Not yet." },
		]));
		assert.deepEqual(where, [
			{ title: "What a generative model is", level: "solid", note: "said it in their own words." },
			{ title: "Generator and discriminator", level: "solid" },
			{ title: "The discriminator's optimal form", level: "shaky", note: "knew the result, not where it comes from." },
			{ title: "Solving the minimax objective", level: "notyet" },
		]);
	});
	it("before the check is over there are no blocks", () => {
		assert.equal(learnWhere([newUserMessage("LEARN SESSION\n…"), assistant([text("One question first.")])]), null);
	});
	it("the student corrects a block: what they say wins", () => {
		const msgs = [...done([{ strand: "Generator and discriminator", assessment: "Shaky." }, { strand: "The minimax objective", assessment: "Not yet." }]), newUserMessage(LEARN_SAYS.correct("Generator and discriminator", "solid"))];
		assert.deepEqual(learnWhere(msgs)!.map((w) => [w.title, w.level, w.corrected ?? false]), [["Generator and discriminator", "solid", true], ["The minimax objective", "notyet", false]]);
		assert.equal(LEARN_SAYS.correct("The minimax objective", "notyet"), 'Correction: "The minimax objective" is not yet for me. Plan from that.');
	});
	it("at most six blocks, and a strand with no name is left out", () => {
		const many = Array.from({ length: 9 }, (_, i) => ({ strand: i === 2 ? " " : `Idea ${i + 1}`, assessment: "Solid." }));
		assert.equal(learnWhere(done(many))!.length, LEARN_RULES.whereMax);
	});
});

describe("what the tutor is told to do in the check", () => {
	const prober = fs.readFileSync(path.join(ROOT, "companion", "seed", "prompts", "prober", "10-probe-doctrine.md"), "utf-8");
	it("skipped means nothing is asked", () => {
		assert.match(prober, /Opening check: skipped/);
		assert.match(prober, /call `probe_done` at once/);
	});
	it("it asks about what the goal needs, basic first, and stops where they cannot go on", () => {
		assert.match(prober, /basic first/i);
		assert.match(prober, /stop at the first/i);
	});
	it("a question never needs the lecture's own example", () => {
		assert.match(prober, /without the slides/);
		assert.doesNotMatch(prober, /Build every question from the slides and the concept map only/);
	});
	it("each idea is handed over as Solid, Shaky, Not yet or Not asked", () => {
		for (const w of ["Solid", "Shaky", "Not yet", "Not asked"]) assert.ok(prober.includes(`"${w}`), w);
	});
	it("it no longer says the goal needs no asking when the student gave none", () => {
		assert.doesNotMatch(prober, /Do not ask what they want to learn\.$/m);
	});
});

describe("the words on the first step", () => {
	it("are in one place", () => {
		assert.equal(LEARN_COPY.intent.title, "What do you want from this session?");
		assert.equal(LEARN_COPY.intent.check, "Check what I know first");
		assert.equal(LEARN_COPY.intent.skip, "Skip, start teaching");
		assert.match(LEARN_COPY.intent.checkNote, /2 minutes/);
		assert.equal(LEARN_COPY.where.title, "Where you are");
		assert.deepEqual(LEARN_COPY.where.levels, { solid: "Solid", shaky: "Shaky", notyet: "Not yet", unchecked: "Not checked" });
	});
});
