/**
 * v3.1.1: what Jiven saw when he used v3.1. "This wasnt really clear, like I
 * can see 2 plans": the check's result and the plan were two lists of the
 * same ideas. Now there is one plan, and each step carries what the check
 * found. And: "a clearer deliniation between probe, predict, learn and
 * check stages when learning".
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { LEARN_COPY, learnStage, learnWhere, planWithLevels, LEARN_SAYS, type LearnPlanView, type LearnWhere } from "../src/core/companion/index.ts";
import { newUserMessage, type LhMessage } from "../src/core/native-messages.ts";
import { assistant, text } from "./helpers/companion-lh.ts";

const ROOT = path.join(import.meta.dirname, "..");
const plan = (...titles: string[]): LearnPlanView => ({ nodes: titles.map((t, i) => ({ id: `n${i + 1}`, title: t, state: "todo" as const })), edges: [], index: 0, total: titles.length });
const w = (title: string, level: LearnWhere["level"], note?: string): LearnWhere => ({ title, level, ...(note ? { note } : {}) });

describe("one plan: each step carries what the check found", () => {
	it("a step named after a checked idea takes its level and its note", () => {
		const r = planWithLevels(plan("Pure-strategy best responses and saddle points", "Mixed strategies and guaranteed payoffs"), [
			w("Pure-strategy best responses and saddle points", "shaky", "did not explain the comparison."),
			w("Mixed strategies and guaranteed payoffs", "unchecked"),
		]);
		assert.deepEqual(r.steps.map((s) => [s.title, s.level, s.note ?? null]), [
			["Pure-strategy best responses and saddle points", "shaky", "did not explain the comparison."],
			["Mixed strategies and guaranteed payoffs", "unchecked", null],
		]);
		assert.deepEqual([r.have, r.also], [[], []]);
	});
	it("the names need not match to the letter: case, punctuation and a few words apart still line up", () => {
		const r = planWithLevels(plan("Best responses & saddle points", "Mixed strategies"), [w("Pure-strategy best responses and saddle points", "shaky"), w("Mixed strategies and guaranteed payoffs", "notyet")]);
		assert.deepEqual(r.steps.map((s) => s.level), ["shaky", "notyet"]);
		assert.equal(r.steps[0]!.checked, "Pure-strategy best responses and saddle points", "a change is sent under the name the check used");
	});
	it("an idea the check found solid and the plan leaves out is one line above: you already have it", () => {
		const r = planWithLevels(plan("Mixed strategies"), [w("Constant-sum matrix-game framing", "solid"), w("Mixed strategies", "notyet")]);
		assert.deepEqual(r.have.map((x) => x.title), ["Constant-sum matrix-game framing"]);
		assert.deepEqual(r.steps.map((s) => s.level), ["notyet"]);
	});
	it("a checked idea that is not solid and matches no step is not lost: it is listed beside the plan", () => {
		const r = planWithLevels(plan("Forward noising"), [w("Alternating adversarial updates", "notyet")]);
		assert.deepEqual(r.also.map((x) => [x.title, x.level]), [["Alternating adversarial updates", "notyet"]]);
		assert.equal(r.steps[0]!.level, undefined, "a step the check said nothing about shows no level");
	});
	it("one shared word does not make two names the same idea (seen with the real tutor, 28 Nov)", () => {
		const r = planWithLevels(plan("Generator inputs", "Discriminator feedback", "Alternating GAN updates"), [w("GAN roles and generator objective", "solid"), w("Alternating adversarial updates", "notyet")]);
		assert.deepEqual(r.steps.map((s) => s.level ?? null), [null, null, "notyet"]);
		assert.deepEqual(r.have.map((x) => x.title), ["GAN roles and generator objective"]);
	});
	it("each checked idea goes to one step only, the closest", () => {
		const r = planWithLevels(plan("GAN training", "GAN training updates"), [w("GAN training updates", "shaky")]);
		assert.deepEqual(r.steps.map((s) => s.level ?? null), [null, "shaky"]);
	});
	it("with no check there are no levels, and nothing else is shown", () => {
		const r = planWithLevels(plan("A", "B"), null);
		assert.deepEqual([r.steps.map((s) => s.level ?? null), r.have, r.also], [[null, null], [], []]);
	});
});

describe("changing a step the check said nothing about", () => {
	const call = (id: string, name: string, args: Record<string, unknown>) => ({ type: "toolCall" as const, id, name, arguments: args });
	const result = (toolCallId: string, toolName: string): LhMessage => ({ id: `r_${toolCallId}`, role: "toolResult", toolCallId, toolName, content: [{ type: "text", text: "ok" }], details: { ok: true }, isError: false, timestamp: 0 }) as unknown as LhMessage;
	it("is remembered as the student's own word on it", () => {
		const msgs = [newUserMessage("LEARN SESSION\n…"), assistant([call("pd", "probe_done", { assessment: { strands: [{ strand: "Mixed strategies", assessment: "Not asked." }] } }), text("Thanks.")]), result("pd", "probe_done"), newUserMessage(LEARN_SAYS.correct("Graphical solutions", "solid"))];
		assert.deepEqual(learnWhere(msgs), [{ title: "Mixed strategies", level: "unchecked" }, { title: "Graphical solutions", level: "solid", corrected: true }]);
	});
});

describe("the stage of learning is always named", () => {
	const q = (role: "predict" | "check", guess = false) => ({ role, ...(guess ? { guess: true } : {}) });
	const cases: Array<[string, Parameters<typeof learnStage>[0], ReturnType<typeof learnStage>]> = [
		["the opening check", { phase: "probe", status: "question", question: q("check", true) }, "level"],
		["the opening check, between questions", { phase: "probe", status: "thinking" }, "level"],
		["the plan being agreed", { phase: "plan", status: "reply" }, "plan"],
		["a guess before the idea is taught", { phase: "teach", status: "question", question: q("predict", true) }, "guess"],
		["the tutor teaching", { phase: "teach", status: "reply" }, "learn"],
		["the tutor writing", { phase: "teach", status: "thinking" }, "learn"],
		["a check", { phase: "teach", status: "question", question: q("check") }, "check"],
		["the session over", { phase: "teach", status: "done" }, null],
	];
	for (const [name, input, stage] of cases) it(name, () => assert.equal(learnStage(input), stage));

	it("the words are in one place, and a guess and a check say what happens to the answer", () => {
		assert.deepEqual(LEARN_COPY.stages, { level: "Find your level", plan: "Plan", guess: "Guess", learn: "Learn", check: "Check" });
		assert.match(LEARN_COPY.stageNote.guess, /nothing is marked/);
		assert.match(LEARN_COPY.stageNote.check, /your tutor marks/);
		assert.match(LEARN_COPY.stageNote.level, /nothing is marked/);
	});
	it("the screen shows the strip and a header on each part", () => {
		const src = fs.readFileSync(path.join(ROOT, "components", "lockedin", "screens", "learn.tsx"), "utf-8");
		assert.ok(src.includes("li-stages"), "the strip in the bar");
		assert.ok(src.includes("li-stage-head"), "the header on a part of the lesson");
		assert.ok(!src.includes("<WhereYouAre"), "the second list is gone");
	});
});

describe("what the tutor is told", () => {
	it("to name the plan's steps after the ideas it checked, so the student sees one list", () => {
		const planning = fs.readFileSync(path.join(ROOT, "companion", "seed", "prompts", "teacher", "10-planning.md"), "utf-8");
		assert.match(planning, /same name/i);
		assert.match(planning, /one list/i);
	});
});
