/**
 * v3.2, "Pictures that build up". Jiven, 28 Nov: "shouldnt we have a
 * unanimious blocks design (Explainer pages) I need it more dynamic for the
 * user to really get some solid visuals. Needs to be widely applicable too."
 * He tried four working designs (docs/companion/explainer-designs) and chose
 * "Build it up" with "Fill the gap" as its first step.
 *
 * The tutor and the explainer writer add a few comment lines to the diagram
 * they already write. LockedIn reads them here. Anything missing or wrong
 * and the whole picture shows, as it did before.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { CLIENT_EVENT_TYPES, PICTURE_COPY, PICTURE_RULES, parsePictureScript, parseSimpleFlow, pictureFrame, safeMermaid } from "../src/core/companion/index.ts";

const ROOT = path.join(import.meta.dirname, "..");
const GAN = `graph TD
  z["Noise z"] --> G["Generator G"]
  G --> fake["Fake image"]
  fake --> D["Discriminator D"]
  real["Real image"] --> D
  D --> score["Fake's score goes up"]
%% step z, G, fake :: A forger :: The generator turns noise into a fake image.
%% step real, D, score :: A judge :: The discriminator scores any image from 0 to 1.
%% step D=learning, G=held still, real, fake :: Hold G still, teach D :: Only D's weights change.
%% step G=learning, D=held still :: Only G's weights change, so that D scores the fake as real.
%% gap score :: With D held still, G is updated so that the fake's score… :: *goes up, towards 1 => G wins when D scores its fake as real. | goes down, towards 0 => That is D's aim on its own turn. | stays at 0.5`;
const ids = (src: string) => parseSimpleFlow(src)!.nodes.map((n) => n.id);

describe("reading the steps and the gap from a diagram's comment lines", () => {
	it("the diagram itself is still plain boxes and arrows: the extra lines are comments", () => {
		assert.deepEqual(ids(GAN), ["z", "G", "fake", "D", "real", "score"]);
		assert.ok(safeMermaid(GAN).includes("%% step z, G, fake"), "they survive the label check, so mermaid can still draw it if LockedIn cannot");
	});
	it("each step: the blocks it lights, a note on a block, a title and a sentence", () => {
		const s = parsePictureScript(GAN, ids(GAN))!;
		assert.equal(s.steps.length, 4);
		assert.deepEqual(s.steps[0], { title: "A forger", say: "The generator turns noise into a fake image.", lit: ["z", "G", "fake"], notes: {} });
		assert.deepEqual(s.steps[2], { title: "Hold G still, teach D", say: "Only D's weights change.", lit: ["D", "G", "real", "fake"], notes: { D: "learning", G: "held still" } });
		assert.deepEqual(s.steps[3], { say: "Only G's weights change, so that D scores the fake as real.", lit: ["G", "D"], notes: { G: "learning", D: "held still" } }, "a title is optional");
	});
	it("the gap: a block, what is asked, and the blocks to choose from, one of them right", () => {
		const g = parsePictureScript(GAN, ids(GAN))!.gap!;
		assert.equal(g.node, "score");
		assert.equal(g.ask, "With D held still, G is updated so that the fake's score…");
		assert.deepEqual(g.options, [
			{ label: "goes up, towards 1", why: "G wins when D scores its fake as real.", right: true },
			{ label: "goes down, towards 0", why: "That is D's aim on its own turn.", right: false },
			{ label: "stays at 0.5", why: "", right: false },
		]);
	});

	const base = "graph TD\n  A[One] --> B[Two]\n  B --> C[Three]\n";
	const cases: Array<[string, string, (s: ReturnType<typeof parsePictureScript>) => void]> = [
		["no extra lines: no script, the whole picture shows", base, (s) => assert.equal(s, null)],
		["one step is not a build-up", `${base}%% step A :: Only this.`, (s) => assert.equal(s, null)],
		["a block the diagram does not have is left out of the step", `${base}%% step A, X :: First.\n%% step B :: Second.`, (s) => assert.deepEqual(s!.steps[0]!.lit, ["A"])],
		["a step with no sentence is dropped", `${base}%% step A ::\n%% step B :: Second.\n%% step C :: Third.`, (s) => assert.deepEqual(s!.steps.map((x) => x.say), ["Second.", "Third."])],
		["at most eight steps are kept", `${base}${Array.from({ length: 11 }, (_, i) => `%% step A :: Step ${i + 1}.`).join("\n")}`, (s) => assert.equal(s!.steps.length, PICTURE_RULES.maxSteps)],
		["a long note on a block is cut short", `${base}%% step A=${"x".repeat(60)} :: First.\n%% step B :: Second.`, (s) => assert.equal(s!.steps[0]!.notes.A!.length, PICTURE_RULES.noteMax)],
		["capital letters and spacing do not matter", `${base}  %%STEP A::First.\n%%  Step  B  ::  A title  ::  Second.`, (s) => assert.deepEqual(s!.steps.map((x) => [x.title ?? null, x.say]), [[null, "First."], ["A title", "Second."]])],
		["a gap on a block the diagram does not have is dropped", `${base}%% gap X :: Which? :: *one | two`, (s) => assert.equal(s, null)],
		["a gap with no right answer is dropped", `${base}%% gap A :: Which? :: one | two`, (s) => assert.equal(s, null)],
		["a gap with two right answers is dropped", `${base}%% gap A :: Which? :: *one | *two`, (s) => assert.equal(s, null)],
		["a gap with one choice is dropped", `${base}%% gap A :: Which? :: *one`, (s) => assert.equal(s, null)],
		["a gap alone is enough: guess, then the whole picture", `${base}%% gap B :: Which comes second? :: *Two => It follows One. | Three => That is last.`, (s) => assert.deepEqual([s!.steps.length, s!.gap!.node, s!.gap!.options.length], [0, "B", 2])],
		["only the first gap is used", `${base}%% gap B :: First? :: *Two | Three\n%% gap C :: Second? :: *Three | One`, (s) => assert.equal(s!.gap!.node, "B")],
		["at most four choices", `${base}%% gap B :: Which? :: *a | b | c | d | e | f`, (s) => assert.equal(s!.gap!.options.length, PICTURE_RULES.optionsMax)],
		["a reason may hold an arrow of its own", `${base}%% gap B :: Which? :: *Two => because One => Two. | Three`, (s) => assert.equal(s!.gap!.options[0]!.why, "because One => Two.")],
	];
	for (const [name, src, check] of cases) it(name, () => check(parsePictureScript(src, ids(src))));
});

describe("what is on the picture at each step", () => {
	const s = parsePictureScript(GAN, ids(GAN))!;
	const all = ids(GAN);
	it("a block arrives at the first step that names it, and stays", () => {
		assert.deepEqual(pictureFrame(s, all, 0).shown, ["z", "G", "fake"]);
		assert.deepEqual(pictureFrame(s, all, 1).shown, all);
		assert.deepEqual(pictureFrame(s, all, 3).shown, all);
	});
	it("the step's own blocks are lit and carry its notes; the notes of the step before are gone", () => {
		assert.deepEqual(pictureFrame(s, all, 2), { shown: all, lit: ["D", "G", "real", "fake"], notes: { D: "learning", G: "held still" } });
		assert.deepEqual(pictureFrame(s, all, 3).notes, { G: "learning", D: "held still" });
	});
	it("a block no step names is there from the start", () => {
		const src = "graph TD\n  A[One] --> B[Two]\n  B --> C[Three]\n%% step A :: First.\n%% step B :: Second.";
		assert.deepEqual(pictureFrame(parsePictureScript(src, ids(src))!, ids(src), 0).shown, ["A", "C"]);
	});
	it("'Show it all' is every block, none lit", () => {
		assert.deepEqual(pictureFrame(s, all, "all"), { shown: all, lit: [], notes: {} });
	});
	it("a step number off either end is the nearest step", () => {
		assert.deepEqual(pictureFrame(s, all, 99), pictureFrame(s, all, 3));
		assert.deepEqual(pictureFrame(s, all, -1), pictureFrame(s, all, 0));
	});
});

describe("on screen", () => {
	const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), "utf-8");
	it("a diagram with steps or a gap is drawn as a picture that builds up", () => {
		const diagram = read("components", "lockedin", "diagram.tsx");
		assert.ok(diagram.includes("parsePictureScript") && diagram.includes("<SteppedPicture"));
	});
	it("the words are in one place: a guess says nothing is marked, and there is always a way to see it all", () => {
		assert.match(PICTURE_COPY.gapNote, /nothing is marked/);
		assert.equal(PICTURE_COPY.all, "Show it all");
		assert.equal(PICTURE_COPY.showMe, "Show me instead");
		const picture = read("components", "lockedin", "picture.tsx");
		for (const k of ["PICTURE_COPY.all", "PICTURE_COPY.showMe", "PICTURE_COPY.gapNote", "PICTURE_COPY.enlarge"]) assert.ok(picture.includes(k), k);
	});
	it("a wrong guess is lilac and a right one mint: never red, never a score", () => {
		const css = read("components", "lockedin", "lockedin.css");
		const rules = css.split("\n").filter((l) => l.includes(".li-pic"));
		assert.ok(rules.length > 4);
		assert.ok(rules.some((l) => l.includes("--li-lilac")) && rules.some((l) => l.includes("--li-mint")));
		assert.ok(!rules.some((l) => /red|#f00|#e\d\d[0-4]/i.test(l.replace(/border-radius|rendered|reduced|preferred/g, ""))));
	});
	it("a guess on a picture is logged for the study's records, and so is finishing one", () => {
		assert.ok(CLIENT_EVENT_TYPES.includes("picture_gap") && CLIENT_EVENT_TYPES.includes("picture_done"));
	});
});

describe("what the AI is told", () => {
	const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), "utf-8");
	it("the tutor: plain boxes and arrows, with step lines, and a gap where a guess fits", () => {
		const fmt = read("companion", "seed", "prompts", "shared", "40-formatting.md");
		for (const want of ["graph TD", "%% step", "%% gap", "=>"]) assert.ok(fmt.includes(want), want);
	});
	it("the explainer writer: the same picture, so the Library's cards build up too", () => {
		const ex = read("companion", "prompts", "explainer.md");
		for (const want of ["graph TD", "%% step", "%% gap"]) assert.ok(ex.includes(want), want);
		assert.ok(!/mindmap, sequenceDiagram/.test(ex), "one kind of picture, drawn by LockedIn");
	});
	it("the example in each prompt is one LockedIn can read", () => {
		for (const file of [["companion", "seed", "prompts", "shared", "40-formatting.md"], ["companion", "prompts", "explainer.md"]]) {
			const m = /```mermaid\n([\s\S]*?)```/.exec(read(...file));
			assert.ok(m, `${file.at(-1)} has an example`);
			const flow = parseSimpleFlow(m![1]!);
			assert.ok(flow, "plain boxes and arrows");
			const script = parsePictureScript(m![1]!, flow!.nodes.map((n) => n.id));
			assert.ok(script && script.steps.length >= 2 && script.gap, "with steps and a gap");
		}
	});
});
