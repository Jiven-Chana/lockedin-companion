/**
 * Builders for LearnHarness-shaped chat records, for the companion view and
 * engine tests. They use LearnHarness's own constructors where they exist,
 * so the records are what the real server writes.
 *
 * When the checkpoint produces a real recorded session, save it under
 * tests/fixtures/companion/ and add it to tests/companion-view.test.ts.
 */

import { newAnswerResult, newHandoffMessage, newUserMessage, type LhMessage } from "../../src/core/native-messages.ts";
import type { QuestionAnswerData } from "../../src/core/question-core.ts";

let seq = 0;
const nextId = (p: string) => `${p}_${(++seq).toString(36)}`;

type Block = { type: "text"; text: string } | { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> };

export function assistant(blocks: Block[], stopReason: "toolUse" | "stop" | "error" = blocks.some((b) => b.type === "toolCall") ? "toolUse" : "stop"): LhMessage {
	return {
		id: nextId("a"),
		role: "assistant",
		content: blocks,
		api: "openai-completions",
		provider: "openrouter",
		model: "test-model",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		stopReason,
		timestamp: Date.now(),
	} as unknown as LhMessage;
}

export const text = (t: string): Block => ({ type: "text", text: t });

export function quizCall(id: string, over: Record<string, unknown> = {}): Block {
	return {
		type: "toolCall",
		id,
		name: "quiz",
		arguments: {
			type: "check",
			nodeId: "persona-purpose",
			question: `Question ${id}?`,
			options: [{ label: "Right", value: "right" }, { label: "Wrong A", value: "a" }, { label: "Wrong B", value: "b" }],
			explanation: `Because (Slide 4).`,
			correctAnswer: "right",
			...over,
		},
	};
}

export function probeDone(chatId: string): LhMessage[] {
	const callId = nextId("probe");
	return [
		assistant([{ type: "toolCall", id: callId, name: "probe_done", arguments: { assessment: { strands: [{ strand: "Personas", assessment: "Covered in the lecture; not yet checked." }] } } }, text("Starting with question 1.")]),
		{ id: nextId("r"), role: "toolResult", toolCallId: callId, toolName: "probe_done", content: [{ type: "text", text: "ok" }], details: { ok: true }, isError: false, timestamp: Date.now() } as unknown as LhMessage,
		newHandoffMessage(chatId),
	];
}

export function answerResult(toolCallId: string, answer: QuestionAnswerData): LhMessage {
	return newAnswerResult(toolCallId, "quiz", answer);
}

export { newUserMessage };
