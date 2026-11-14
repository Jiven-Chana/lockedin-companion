/**
 * The real LhPort: LearnHarness's own server functions, called in-process
 * (plan §5.1: same origin, no auth or CORS work, no protocol
 * re-implementation). This is the ONLY companion module that touches
 * LearnHarness internals; keep it thin so engine changes stay contained.
 *
 * Mirrors app/api/chats/route.ts (create + stamp the strong slot),
 * app/api/chat/route.ts (turns) and app/api/chats/[id]/side-chats (hints).
 */

import { titleFromPrompt } from "../../core/contracts.ts";
import type { ChatInput } from "../../core/input-events.ts";
import { parseSideAskInput } from "../../core/side-chat.ts";
import { readSettings } from "../../store/settings.ts";
import { handleChatInput } from "../chat-handler.ts";
import { deleteIdleChatRecord } from "../chats.ts";
import { sessionCost } from "../pricing.ts";
import { sideChats } from "../side-chat.ts";
import { stores } from "../stores.ts";
import { isTurnRunning } from "../turn-liveness.ts";
import { turnFailure } from "../turn-runs.ts";
import type { LhPort, LhSendResult } from "./engines/learnharness.ts";

async function readNdjsonAnswer(res: Response): Promise<string> {
	if (!res.ok || !res.body) {
		const body = (await res.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? `side question refused (${res.status})`);
	}
	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let streamed = "";
	let final: string | undefined;
	for (;;) {
		const { value, done } = await reader.read();
		if (value) buffer += decoder.decode(value, { stream: true });
		let nl: number;
		while ((nl = buffer.indexOf("\n")) >= 0) {
			const line = buffer.slice(0, nl).trim();
			buffer = buffer.slice(nl + 1);
			if (!line) continue;
			const event = JSON.parse(line) as { type: string; text?: string; error?: string; thread?: { messages?: { role: string; text?: string; error?: string }[] } };
			if (event.type === "text" && event.text) streamed += event.text;
			if (event.type === "error") throw new Error(event.error ?? "side question failed");
			if (event.type === "done") {
				const last = event.thread?.messages?.at(-1);
				if (last?.role === "assistant" && last.error) throw new Error(last.error);
				if (last?.role === "assistant" && typeof last.text === "string") final = last.text;
			}
		}
		if (done) break;
	}
	return final ?? streamed;
}

export interface LearnHarnessPortOptions {
	/** Test seam: the agent factory handleChatInput accepts (a scripted fake model). */
	buildAgent?: Parameters<typeof handleChatInput>[2];
	/** Test seam: stamp this model on new chats instead of the strong slot. */
	model?: { provider: string; id: string };
}

export function createLearnHarnessPort(opts: LearnHarnessPortOptions = {}): LhPort {
	return {
		createChat(title) {
			const chat = stores.chatStore.createChat(titleFromPrompt(title || "Companion session"));
			const strong = opts.model ? { model: opts.model, thinkingLevel: undefined } : readSettings()?.models?.strong;
			if (strong?.model) {
				stores.chatStore.saveSettings(chat.id, {
					model: { provider: strong.model.provider, id: strong.model.id },
					thinkingLevel: strong.thinkingLevel,
				});
			}
			return chat.id;
		},
		messages: (chatId) => stores.chatStore.getChat(chatId)?.messages ?? null,
		running: (chatId) => isTurnRunning(chatId),
		failure: (chatId) => turnFailure(chatId),
		async send(chatId, input: ChatInput): Promise<LhSendResult> {
			const res = await handleChatInput(chatId, input, opts.buildAgent);
			if (res.status === 200) {
				await res.body?.cancel().catch(() => {});
				return { status: 200 };
			}
			const body = (await res.json().catch(() => ({}))) as { error?: unknown; code?: unknown };
			const code = typeof body.code === "string" ? body.code : typeof body.error === "string" && /^[a-z_]+$/.test(body.error) ? body.error : undefined;
			const error = typeof body.error === "string" ? body.error : typeof (body.error as { message?: unknown })?.message === "string" ? (body.error as { message: string }).message : undefined;
			return { status: res.status, ...(code ? { code } : {}), ...(error ? { error } : {}) };
		},
		async askSide(chatId, anchorMessageId, text) {
			// The server re-derives the anchored text from the segment; it only
			// needs to know which teaching message the question belongs to.
			const input = parseSideAskInput({
				anchor: { messageId: anchorMessageId, partId: `${anchorMessageId}-t0`, blockIndex: 0, blockText: "The current question." },
				text,
			});
			return readNdjsonAnswer(await sideChats.ask(chatId, input));
		},
		cost(chatId) {
			const record = stores.chatStore.getChat(chatId);
			return record ? sessionCost(record).cost : null;
		},
		deleteChat(chatId) {
			deleteIdleChatRecord(chatId);
		},
	};
}
