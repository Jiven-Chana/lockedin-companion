/**
 * The companion's LearnHarness engine against the REAL in-process turn loop
 * (createChat, handleChatInput, the native record, the answer-event
 * validation), with pi-ai's scripted fake model: zero tokens, no network.
 * This is the tracer bullet's plumbing proven offline; the checkpoint
 * (npm run companion:tracer) proves it with a real model.
 *
 * Runs under an isolated LH_DATA_DIR set before any config-loading import.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { createFauxCore, fauxAssistantMessage, fauxText, fauxToolCall, type FauxResponseStep } from "@earendil-works/pi-ai";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "companion-lh-"));
process.env.LH_DATA_DIR = TMP;
process.env.OPENROUTER_API_KEY ??= "test-key-presence-gate";

const { createTeacherAgent } = await import("../src/agent/teacher-agent.ts");
const { createLearnHarnessPort } = await import("../src/server/companion/lh-port.ts");
const { LearnHarnessEngine } = await import("../src/server/companion/engines/learnharness.ts");
const { chatStore } = await import("../src/store/chats.ts");
const { DEFAULT_PREFS, specFor } = await import("../src/core/companion/index.ts");
type CompanionSession = import("../src/core/companion/index.ts").CompanionSession;
type SessionView = import("../src/core/companion/index.ts").SessionView;

after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const quiz = (n: number) => ({
	type: "check",
	nodeId: "persona-purpose",
	question: `Question ${n}: which is the main purpose of a persona?`,
	options: [{ label: "Focus decisions on users' goals", value: "focus" }, { label: "Record averages", value: "avg" }, { label: "Replace research", value: "replace" }],
	explanation: "Personas keep specific users' goals in view (Slide 4).",
	correctAnswer: "focus",
});

function fakeTeacher(): { factory: NonNullable<Parameters<typeof createLearnHarnessPort>[0]>["buildAgent"]; prompts: string[] } {
	const prompts: string[] = [];
	const record = (ctx: { messages: unknown[] }) => prompts.push(JSON.stringify(ctx.messages.at(-1)));
	const steps: FauxResponseStep[] = [
		(ctx) => (record(ctx), fauxAssistantMessage([fauxText("Start with what a persona is for (Slide 4)."), fauxToolCall("quiz", quiz(1), { id: "call_1" })], { stopReason: "toolUse" })),
		(ctx) => (record(ctx), fauxAssistantMessage([fauxText("Not quite: personas focus decisions (Slide 4). Try this one."), fauxToolCall("quiz", quiz(2), { id: "call_2" })], { stopReason: "toolUse" })),
		(ctx) => (record(ctx), fauxAssistantMessage([fauxText("Good. Worth revisiting: what personas are for.")])),
	];
	const faux = createFauxCore({});
	faux.setResponses(steps);
	const engine = { model: faux.getModel(), streamFn: faux.streamSimple };
	return { factory: (opts) => createTeacherAgent(undefined, { engine, messages: opts.messages }), prompts };
}

const lecture = { id: "hci-w3-personas", module: "HCI", title: "Personas and scenarios", week: 3, order: 3, start: "", end: "", hasMaterials: true };

async function until(engine: InstanceType<typeof LearnHarnessEngine>, session: CompanionSession, pred: (v: SessionView) => boolean, ms = 5_000): Promise<SessionView> {
	const deadline = Date.now() + ms;
	for (;;) {
		const v = await engine.view(session, lecture);
		if (pred(v)) return v;
		if (Date.now() > deadline) throw new Error(`timed out; last view: ${JSON.stringify(v)}`);
		await new Promise((r) => setTimeout(r, 10));
	}
}

describe("LearnHarnessEngine × the real turn loop", () => {
	it("opening message → question 1 → graded answers → wrap-up, all through LearnHarness's own record", async () => {
		const { factory, prompts } = fakeTeacher();
		const port = createLearnHarnessPort({ buildAgent: factory, model: { provider: "openrouter", id: "z-ai/glm-5.3-flash" } });
		const engine = new LearnHarnessEngine(port, { pollMs: 5 });
		const base: CompanionSession = { id: "s1", engine: "learnharness", spec: specFor("post-lecture", lecture.id, DEFAULT_PREFS), budget: 2, answered: 0, createdAt: "", state: "preparing" };

		const patch = await engine.start(base, { title: "HCI · Personas and scenarios", openingMessage: "APP SESSION\nKind: post-lecture\n…", misses: [] });
		const session = { ...base, ...patch, state: "ready" } as CompanionSession;
		assert.ok(session.chatId && chatStore.getChat(session.chatId), "a real LearnHarness chat exists");
		await engine.waitUntilReady(session, 5_000);

		const v1 = await engine.view(session, lecture);
		assert.equal(v1.status, "question");
		assert.equal(v1.question?.id, "call_1");
		assert.match(v1.prose ?? "", /Slide 4/);
		assert.match(prompts[0] ?? "", /APP SESSION/, "the opening message reached the model");

		// A wrong answer at 30% confidence, with a why.
		const wrong = v1.question!.options.find((o) => o.label === "Record averages")!.index;
		const r1 = await engine.answer(session, { questionId: "call_1", indices: [wrong], confidence: 30, why: "averages describe users" }, new Date());
		assert.equal(r1.record.correct, false);

		const v2 = await until(engine, session, (v) => v.status === "question" && v.question?.id === "call_2");
		assert.equal(v2.answered, 1);
		assert.equal(v2.feedback?.correct, false);
		assert.deepEqual(v2.feedback?.correctLabels, ["Focus decisions on users' goals"]);
		assert.match(prompts[1] ?? "", /averages describe users/, "the why reached the teacher");

		const right = v2.question!.options.find((o) => o.label.startsWith("Focus"))!.index;
		const r2 = await engine.answer(session, { questionId: "call_2", indices: [right], confidence: 90 }, new Date());
		assert.equal(r2.record.correct, true);
		const v3 = await until(engine, session, (v) => v.status === "done");
		assert.equal(v3.answered, 2);

		// LearnHarness persisted both answers as native tool results with full details.
		const results = chatStore.getChat(session.chatId!)!.messages.filter((m) => m.role === "toolResult" && m.toolName === "quiz");
		assert.equal(results.length, 2);
		assert.equal((results[0] as { details: { confidence: number; thinking: string } }).details.confidence, 30);
	});

	it("a stale answer is refused by our engine before LearnHarness sees it", async () => {
		const { factory } = fakeTeacher();
		const port = createLearnHarnessPort({ buildAgent: factory, model: { provider: "openrouter", id: "z-ai/glm-5.3-flash" } });
		const engine = new LearnHarnessEngine(port, { pollMs: 5 });
		const base: CompanionSession = { id: "s2", engine: "learnharness", spec: specFor("post-lecture", lecture.id, DEFAULT_PREFS), budget: 5, answered: 0, createdAt: "", state: "preparing" };
		const session = { ...base, ...(await engine.start(base, { title: "t", openingMessage: "APP SESSION", misses: [] })) } as CompanionSession;
		await engine.waitUntilReady(session, 5_000);
		await assert.rejects(engine.answer(session, { questionId: "call_999", indices: [1] }, new Date()), /no longer open/);
	});
});
