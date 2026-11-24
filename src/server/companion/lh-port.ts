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
import { refreshWorkerRequestAdmission } from "../../agent/worker-request-admission.ts";
import { writeSettings } from "../../store/settings.ts";
import { deleteKey, keyStatuses, saveKey } from "../keys.ts";
import { clampModelsLevels, modelCatalog, refreshConnectionCatalog, validateModelsSettings } from "../model-catalog.ts";
import { parseModelsSettingsBody } from "../settings-body.ts";
import { subscriptionRequestOrigin } from "../desktop-access.ts";
import { webSubscriptionOwner, webSubscriptionStatus } from "../web-subscriptions.ts";
import { KEY_PROVIDERS, PROVIDER_KEY_ID, type CatalogModel, type KeyProvider, type SlotChoices } from "../../core/companion/models.ts";
import { MODEL_SLOTS } from "../../core/settings.ts";
import type { AiPort } from "./ai.ts";
import { Type } from "typebox";
import { piEngineForSpec } from "../../agent/models.ts";
import { getHeadless } from "../../agent/subagents/headless.ts";
import { runSubmitAgent } from "../../agent/subagents/submit-agent.ts";
import { isSubscriptionProvider } from "../../agent/subscription-connections.ts";
import { modelsNotConfigured } from "../../core/settings.ts";
import type { ModelRole } from "../../../config.ts";
import { resolveSlot } from "../../core/settings-resolution.ts";
import { providerKeyPresent } from "../keys.ts";
import { EngineError } from "./errors.ts";
import type { Generate } from "./generate.ts";

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

/**
 * Connect your AI (v0.1 F-101): ChatGPT sign-in, API keys, the model
 * catalogue and the three slots, through the same server functions the
 * engine's own Settings uses (app/api/subscriptions, app/api/keys,
 * app/api/models, PUT /api/settings/models).
 */
export function createAiPort(): AiPort {
	const NOT_AVAILABLE = { connected: false, pending: false, allowBackgroundUse: false, email: null, error: null, available: false };
	return {
		async chatgptStatus() {
			try {
				const { chatgpt } = await webSubscriptionStatus();
				const account = chatgpt.accounts.find((a) => a.id === chatgpt.activeId) ?? null;
				return {
					available: chatgpt.available,
					pending: chatgpt.pending,
					allowBackgroundUse: chatgpt.allowBackgroundUse,
					connected: !!(chatgpt.available && account?.connected && account.planEnabled !== false),
					email: account?.email ?? null,
					error: chatgpt.error ?? null,
				};
			} catch {
				// Desktop-owned mode (Electron) runs ChatGPT in the main process: F-117.
				return NOT_AVAILABLE;
			}
		},
		async chatgptControl(op, fields, req) {
			const origin = subscriptionRequestOrigin(req);
			if (!origin) return { error: "Open sign-in from LockedIn on this computer." };
			const result = (await webSubscriptionOwner().control("chatgpt", { op, ...fields }, origin)) as { value?: { error?: string | null }; browserAction?: string };
			return {
				...(result.browserAction ? { browserAction: result.browserAction } : {}),
				...(result.value?.error ? { error: result.value.error } : {}),
			};
		},
		keysPresent() {
			const statuses = keyStatuses();
			const present = (p: KeyProvider) => statuses.some((k) => k.id === PROVIDER_KEY_ID[p] && k.present);
			return Object.fromEntries(KEY_PROVIDERS.map((p) => [p, present(p)])) as Record<KeyProvider, boolean>;
		},
		saveKey(provider, value) {
			const r = saveKey(PROVIDER_KEY_ID[provider], value);
			return r.ok ? { ok: true } : { ok: false, error: r.error };
		},
		deleteKey(provider) {
			deleteKey(PROVIDER_KEY_ID[provider]);
		},
		async catalog(): Promise<CatalogModel[]> {
			await refreshConnectionCatalog().catch(() => undefined);
			return modelCatalog().models.map((m) => ({
				id: m.id,
				name: m.name,
				provider: m.provider,
				input: [...m.input],
				reasoning: m.reasoning,
				supportedLevels: [...(m.supportedLevels ?? [])],
				cost: m.cost && (m.cost.input > 0 || m.cost.output > 0) ? { input: m.cost.input, output: m.cost.output } : null,
			}));
		},
		slots(): SlotChoices {
			const models = readSettings()?.models ?? {};
			const out: SlotChoices = {};
			for (const slot of MODEL_SLOTS) {
				const s = models[slot];
				if (s?.model) out[slot] = { model: { provider: s.model.provider, id: s.model.id }, ...(s.thinkingLevel ? { thinkingLevel: s.thinkingLevel as never } : {}) };
			}
			return out;
		},
		voiceKeyPresent() {
			return keyStatuses().some((k) => k.id === "DEEPGRAM_API_KEY" && k.present);
		},
		async saveVoiceKey(value) {
			// The exact call dictation makes (app/api/stt/token): a key without Member permission can't mint a token.
			try {
				const res = await fetch("https://api.deepgram.com/v1/auth/grant", { method: "POST", headers: { Authorization: `Token ${value}`, "Content-Type": "application/json" }, body: JSON.stringify({ ttl_seconds: 30 }), signal: AbortSignal.timeout(15_000) });
				await res.body?.cancel().catch(() => {});
				if (res.status === 401) return { ok: false, error: "Deepgram didn't accept that key. Check it and try again." };
				if (res.status === 403) return { ok: false, error: "That key can't start dictation: in the Deepgram console, give it Member permission (or make a new Member key)." };
				if (!res.ok) return { ok: false, error: `Deepgram answered with an error (${res.status}). Try again in a minute.` };
			} catch {
				return { ok: false, error: "Couldn't reach Deepgram. Check your internet connection." };
			}
			const r = saveKey("DEEPGRAM_API_KEY", value);
			return r.ok ? { ok: true } : { ok: false, error: r.error };
		},
		deleteVoiceKey() {
			deleteKey("DEEPGRAM_API_KEY");
		},
		writeSlots(slots) {
			const parsed = parseModelsSettingsBody(slots ?? {});
			if (!parsed.ok) return { ok: false, error: parsed.error };
			const record = readSettings() ?? { version: 1 };
			if (slots) {
				const verdict = validateModelsSettings(parsed.settings, record.models);
				if (!verdict.ok) return { ok: false, error: verdict.error };
			}
			writeSettings({ ...record, models: clampModelsLevels(parsed.settings) });
			refreshWorkerRequestAdmission();
			return { ok: true };
		},
	};
}

/**
 * One page of a PDF as a PNG (V-21), drawn by the engine's own PDF renderer
 * (pdfjs into a native canvas, in this process: no browser). Null when the
 * file has no such page.
 */
export async function renderPdfPage(pdfPath: string, page: number, dpi: number): Promise<Uint8Array | null> {
	const [rendered] = await getHeadless().renderPdfPages(pdfPath, [page], { dpi });
	return rendered ? new Uint8Array(rendered.png) : null;
}

/** The engine role whose prompts and limits fit each slot (ROLE_SLOT, reversed). */
const SLOT_ROLE: Record<"strong" | "cheap" | "vision", ModelRole> = { strong: "teacher", cheap: "extractor", vision: "visualMaker" };

/**
 * One-shot structured generation (spec §5.4) on the student's slot. A
 * user-initiated call, so a ChatGPT slot doesn't need background consent.
 */
export const generate: Generate = async (req) => {
	const started = Date.now();
	const spec = resolveSlot(readSettings()?.models?.[req.slot]);
	if (!spec) throw new EngineError("models_not_configured", modelsNotConfigured([req.slot]).error, 503);
	if (!providerKeyPresent(spec.provider)) throw new EngineError("provider_key_missing", `Your ${spec.provider} connection isn't available. Reconnect in Me → Your AI.`, 503);
	if (isSubscriptionProvider(spec.provider)) await refreshConnectionCatalog(spec.provider).catch(() => undefined);
	let engine;
	try {
		engine = piEngineForSpec(spec, false);
	} catch (err) {
		// A sign-in whose model list didn't load (the refresh above failed) has "no such
		// model": that is the connection being down, not a wrong model choice (v1.0 T-4).
		if (isSubscriptionProvider(spec.provider)) throw new EngineError("ai_unavailable", "Your AI connection isn't answering right now.", 503);
		throw err;
	}
	let cost = 0;
	let priced = false;
	const value = await runSubmitAgent<unknown>({
		role: SLOT_ROLE[req.slot],
		toolName: req.toolName,
		toolDescription: req.toolDescription,
		parameters: Type.Unsafe(req.schema),
		fill: (input) => input,
		systemPrompt: req.system,
		prompt: req.user,
		engine,
		signal: req.signal,
		onStep: (usage) => {
			const c = (usage as { cost?: { total?: number } }).cost?.total;
			if (typeof c === "number") {
				cost += c;
				priced ||= c > 0;
			}
		},
		neverSubmitted: `the model never called ${req.toolName}`,
		...(req.validate ? { validate: req.validate } : {}),
	});
	return { value: value as never, model: `${spec.provider}/${spec.id}`, cost: priced ? cost : null, ms: Date.now() - started };
};
