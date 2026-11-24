/**
 * LearnHarnessEngine over a fake LhPort: the companion's side of the
 * protocol (create → opening message → wait for question 1 → answer →
 * hint → keep going → retry) without a model or a server.
 * tests/companion-lh-integration.test.ts runs the same engine against the
 * real LearnHarness turn loop with a scripted fake model.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_PREFS, HINT_REQUEST, SHOW_ME_THINKING, TEACHER_RULES, keepGoingText, specFor, type CompanionSession } from "../src/core/companion/index.ts";
import type { ChatInput } from "../src/core/input-events.ts";
import { newAnswerResult, newUserMessage, type LhMessage } from "../src/core/native-messages.ts";
import type { QuestionAnswerData } from "../src/core/question-core.ts";
import { CompanionError, EngineError } from "../src/server/companion/errors.ts";
import { LearnHarnessEngine, type LhPort, type LhSendResult } from "../src/server/companion/engines/learnharness.ts";
import { assistant, probeDone, quizCall, text } from "./helpers/companion-lh.ts";

class FakePort implements LhPort {
	chats = new Map<string, LhMessage[]>();
	running = (id: string) => this.isRunning.has(id);
	isRunning = new Set<string>();
	failures = new Map<string, string>();
	sent: { chatId: string; input: ChatInput }[] = [];
	sides: { chatId: string; anchor: string; text: string }[] = [];
	nextSend: LhSendResult = { status: 200 };
	created = 0;

	createChat(): string {
		const id = `chat_${++this.created}`;
		this.chats.set(id, []);
		return id;
	}
	messages(id: string) {
		return this.chats.get(id) ?? null;
	}
	failure(id: string) {
		return this.failures.get(id);
	}
	/** What the teacher does after a message that isn't the opening one. */
	onSend: (() => void) | null = null;
	sendDelayMs = 0;
	async send(chatId: string, input: ChatInput): Promise<LhSendResult> {
		this.sent.push({ chatId, input });
		if (this.sendDelayMs) await new Promise((r) => setTimeout(r, this.sendDelayMs));
		if (this.nextSend.status !== 200) return this.nextSend;
		const record = this.chats.get(chatId)!;
		if (input.type === "text") record.push(newUserMessage(input.text));
		if (input.type === "answer") record.push(newAnswerResult(input.toolCallId, "quiz", input.answer));
		if (this.sent.length > 1) this.onSend?.();
		return { status: 200 };
	}
	async askSide(chatId: string, anchor: string, t: string) {
		this.sides.push({ chatId, anchor, text: t });
		return "  Think about whose goals the design serves.  ";
	}
	cost() {
		return 0.0123;
	}
	deleteChat(id: string) {
		this.chats.delete(id);
	}
	push(chatId: string, ...m: LhMessage[]) {
		this.chats.get(chatId)!.push(...m);
	}
}

const lecture = { id: "hci-w3-personas", module: "HCI", title: "Personas", week: 3, order: 3, start: "", end: "", hasMaterials: true };
const base = (): CompanionSession => ({ id: "s1", engine: "learnharness", spec: specFor("post-lecture", lecture.id, DEFAULT_PREFS), budget: 5, answered: 0, createdAt: "", state: "preparing" });

const engine_view = (e: LearnHarnessEngine, s: CompanionSession) => e.view(s, lecture);

async function started(port = new FakePort(), engine = new LearnHarnessEngine(port, { pollMs: 2, idlePollsBeforeGivingUp: 3 })) {
	const patch = await engine.start(base(), { title: "HCI · Personas", openingMessage: "APP SESSION\n…", misses: [] });
	return { port, engine, session: { ...base(), ...patch } as CompanionSession, chatId: patch.chatId! };
}

describe("start + waitUntilReady", () => {
	it("creates the chat and sends the opening message as the first turn", async () => {
		const { port, chatId } = await started();
		assert.equal(chatId, "chat_1");
		assert.deepEqual(port.sent.map((s) => s.input.type), ["text"]);
		assert.match((port.sent[0]!.input as { text: string }).text, /^APP SESSION/);
	});

	it("surfaces LearnHarness's refusal codes (no models, no key)", async () => {
		const port = new FakePort();
		port.nextSend = { status: 503, code: "models_not_configured", error: "No model configured" };
		await assert.rejects(started(port), (err: unknown) => err instanceof EngineError && err.code === "models_not_configured" && err.status === 503);
	});

	it("resolves when question 1 appears, across the prober → teacher handoff gap", async () => {
		const { port, engine, session, chatId } = await started();
		port.isRunning.add(chatId);
		setTimeout(() => {
			port.push(chatId, ...probeDone(chatId));
			port.isRunning.delete(chatId); // the idle wake gap
		}, 5);
		setTimeout(() => {
			port.isRunning.add(chatId);
			port.push(chatId, assistant([text("Start here (Slide 4)."), quizCall("call_1")]));
			port.isRunning.delete(chatId);
		}, 30);
		await engine.waitUntilReady(session, 2_000);
	});

	it("fails clearly: timeout, a teacher that never asks, a failed turn", async () => {
		const a = await started();
		a.port.isRunning.add(a.chatId);
		await assert.rejects(a.engine.waitUntilReady(a.session, 20), (e: unknown) => e instanceof EngineError && e.code === "timeout");

		// The teacher is asked once (V-22); a teacher that still doesn't ask is an error.
		const b = await started();
		b.port.push(b.chatId, ...probeDone(b.chatId), assistant([text("Here is the plan. Shall we start?")]));
		b.port.onSend = () => b.port.push(b.chatId, assistant([text("Whenever you're ready.")]));
		await assert.rejects(b.engine.waitUntilReady(b.session, 2_000), (e: unknown) => e instanceof EngineError && e.code === "no_question");
		assert.equal(b.port.sent.filter((s) => s.input.type === "text" && s.input.text === TEACHER_RULES.continueText).length, 1, "asked once, not twice");

		const c = await started();
		c.port.failures.set(c.chatId, "provider error");
		await assert.rejects(c.engine.waitUntilReady(c.session, 2_000), (e: unknown) => e instanceof EngineError && e.code === "turn_failed");
	});
});

describe("a teacher that sets its plan and stops (T-1, V-22)", () => {
	const planOnly = (chatId: string) => [...probeDone(chatId), assistant([text("The plan is set. We'll start by checking why image data is structured.")])];

	it("is asked once for the question, and question 1 then arrives", async () => {
		const { port, engine, session, chatId } = await started();
		port.push(chatId, ...planOnly(chatId));
		port.onSend = () => port.push(chatId, assistant([text("Start here (Slide 3)."), quizCall("call_1")]));
		let nudges = 0;
		await engine.waitUntilReady(session, 2_000, () => nudges++);
		assert.equal(nudges, 1);
		assert.deepEqual(port.sent.at(-1)!.input, { type: "text", text: TEACHER_RULES.continueText });
		assert.equal((await engine.view(session, lecture)).status, "question");
	});

	it("a prober that never finished is not asked: that is a different failure", async () => {
		const { port, engine, session, chatId } = await started();
		port.push(chatId, assistant([text("Let me think about where to begin.")]));
		await assert.rejects(engine.waitUntilReady(session, 2_000), (e: unknown) => e instanceof EngineError && e.code === "probe_not_done");
		assert.equal(port.sent.length, 1, "only the opening message");
	});

	it("Try again asks for the question again instead of doing nothing", async () => {
		const { port, engine, session, chatId } = await started();
		port.push(chatId, ...planOnly(chatId));
		port.onSend = () => port.push(chatId, assistant([text("Whenever you're ready.")]));
		await assert.rejects(engine.waitUntilReady(session, 2_000));
		port.onSend = () => port.push(chatId, assistant([text("Start here (Slide 3)."), quizCall("call_1")]));
		await engine.retry({ ...session, state: "error", error: "no_question" });
		assert.deepEqual(port.sent.at(-1)!.input, { type: "text", text: TEACHER_RULES.continueText });
		await engine.waitUntilReady(session, 2_000);
	});
});

describe("answering", () => {
	async function withQuestion() {
		const s = await started();
		s.port.push(s.chatId, ...probeDone(s.chatId), assistant([text("Lead-in (Slide 4)."), quizCall("call_1")]));
		return s;
	}

	it("grades with LearnHarness's buildAnswer and sends the answer event", async () => {
		const { port, engine, session } = await withQuestion();
		const v = await engine.view(session, lecture);
		const right = v.question!.options.find((o) => o.label === "Right")!.index;
		const { record } = await engine.answer(session, { questionId: "call_1", indices: [right], confidence: 90, why: "because" }, new Date(2026, 10, 17, 13, 10));
		assert.equal(record.correct, true);
		assert.equal(record.nodeId, "persona-purpose");
		const sent = port.sent.at(-1)!.input as { type: string; toolCallId: string; answer: QuestionAnswerData };
		assert.equal(sent.type, "answer");
		assert.equal(sent.toolCallId, "call_1");
		assert.equal(sent.answer.confidence, 90);
		assert.equal(sent.answer.thinking, "because");
		assert.equal(sent.answer.answeredAt, new Date(2026, 10, 17, 13, 10).toISOString());
	});

	it("refuses a stale question id (double tap) and answers while the teacher is writing", async () => {
		const { port, engine, session, chatId } = await withQuestion();
		await assert.rejects(engine.answer(session, { questionId: "call_0", indices: [1] }, new Date()), (e: unknown) => e instanceof CompanionError && e.code === "question_not_pending");
		port.isRunning.add(chatId);
		await assert.rejects(engine.answer(session, { questionId: "call_1", indices: [1] }, new Date()), (e: unknown) => e instanceof CompanionError && e.code === "turn_running");
	});

	it("show me first is an \"I don't know\" carrying the worked-example request", async () => {
		const { port, engine, session } = await withQuestion();
		const { record } = await engine.showMe(session, "call_1", new Date());
		assert.equal(record?.shown, true);
		const sent = port.sent.at(-1)!.input as { answer: QuestionAnswerData };
		assert.equal(sent.answer.dontKnow, true);
		assert.equal(sent.answer.thinking, SHOW_ME_THINKING);
	});

	it("hints are side questions anchored at the question's teaching message", async () => {
		const { port, engine, session, chatId } = await withQuestion();
		const { text: hint, patch } = await engine.hint(session, "call_1");
		assert.equal(hint, "Think about whose goals the design serves.");
		assert.deepEqual(patch?.hintedQuestionIds, ["call_1"]);
		const anchorMessage = port.chats.get(chatId)!.at(-1)!;
		assert.deepEqual(port.sides[0], { chatId, anchor: anchorMessage.id, text: HINT_REQUEST });
	});

	it("dry run: a teacher that stops after feedback is asked once for the next question; a second stop ends the session", async () => {
		const { port, engine, session: prepared, chatId } = await withQuestion();
		const session = { ...prepared, state: "active" as const };
		const answered = () => newAnswerResult("call_1", "quiz", { kind: "quiz", questionText: "Q", dontKnow: false, answers: [], correct: true, answeredAt: "" });
		port.push(chatId, answered(), assistant([text("Right, but at 50% it's worth keeping the distinction sharp (Slide 3).")]));
		const v = await engine.view(session, lecture);
		assert.equal(v.status, "thinking");
		assert.equal(v.teacherNudged, true);
		assert.deepEqual(port.sent.at(-1)!.input, { type: "text", text: TEACHER_RULES.continueText });
		port.push(chatId, assistant([text("That's all for now.")]));
		const sent = port.sent.length;
		const again = await engine.view(session, lecture);
		assert.equal(again.status, "done");
		assert.equal(again.endedEarly, true);
		assert.equal(port.sent.length, sent, "only once");
	});

	it("two overlapping screen updates ask the teacher once (X-1)", async () => {
		const { port, engine, session: prepared, chatId } = await withQuestion();
		const session = { ...prepared, state: "active" as const };
		port.push(chatId, newAnswerResult("call_1", "quiz", { kind: "quiz", questionText: "Q", dontKnow: false, answers: [], correct: true, answeredAt: "" }), assistant([text("Right (Slide 3).")]));
		port.sendDelayMs = 10;
		const [a, b] = await Promise.all([engine.view(session, lecture), engine.view(session, lecture)]);
		assert.equal(port.sent.filter((s) => s.input.type === "text" && s.input.text === TEACHER_RULES.continueText).length, 1);
		assert.deepEqual([a.status, b.status], ["thinking", "thinking"]);
		assert.equal([a, b].filter((v) => v.teacherNudged).length, 1, "logged once");
	});

	it("a hand-off session owes the chat one question fewer: the phone answer counts", async () => {
		const s = await started();
		const session = { ...s.session, state: "active" as const, spec: { ...s.session.spec, seedAnswer: { questionId: "q1", choice: 0, correct: true, at: "" } }, budget: 2 };
		s.port.push(s.chatId, ...probeDone(s.chatId), assistant([text("Next (Slide 4)."), quizCall("call_1")]));
		const before = await engine_view(s.engine, session);
		assert.deepEqual([before.status, before.answered, before.budget], ["question", 1, 2]);
		s.port.push(s.chatId, newAnswerResult("call_1", "quiz", { kind: "quiz", questionText: "Q", dontKnow: false, answers: [], correct: true, answeredAt: "" }), assistant([text("Well done, that's the two.")]));
		const after = await engine_view(s.engine, session);
		assert.deepEqual([after.status, after.answered, after.budget], ["done", 2, 2], "done at the budget, no extra question");
	});

	it("keep going asks for more only when nothing is pending", async () => {
		const { port, engine, session, chatId } = await withQuestion();
		await engine.more(session, 3);
		assert.equal(port.sent.length, 1, "a pending question simply becomes answerable");
		port.push(chatId, newAnswerResult("call_1", "quiz", { kind: "quiz", questionText: "Q", dontKnow: false, answers: [], correct: true, answeredAt: "" }), assistant([text("Well done.")]));
		await engine.more(session, 3);
		assert.deepEqual(port.sent.at(-1)!.input, { type: "text", text: keepGoingText(3) });
	});

	it("retry: a failed turn retries, an interrupted one continues", async () => {
		const { port, engine, session, chatId } = await withQuestion();
		await assert.rejects(engine.retry(session), (e: unknown) => e instanceof CompanionError && e.code === "nothing_to_retry");
		port.failures.set(chatId, "boom");
		await engine.retry(session);
		assert.deepEqual(port.sent.at(-1)!.input, { type: "retry" });
		port.failures.delete(chatId);
		port.push(chatId, newAnswerResult("call_1", "quiz", { kind: "quiz", questionText: "Q", dontKnow: false, answers: [], correct: true, answeredAt: "" }));
		await engine.retry(session);
		assert.deepEqual(port.sent.at(-1)!.input, { type: "continue" });
	});

	it("reports cost and removes the chat", async () => {
		const { port, engine, session, chatId } = await withQuestion();
		assert.equal(engine.cost(session), 0.0123);
		engine.remove(session);
		assert.equal(port.chats.has(chatId), false);
	});
});
