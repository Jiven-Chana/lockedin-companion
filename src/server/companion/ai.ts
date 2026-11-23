/**
 * Connect your AI (v0.1 F-101): the student's AI connection and the three
 * model slots, for onboarding screen 1 and Me → AI.
 *
 * Every engine call goes through AiPort, implemented in lh-port.ts (the
 * only companion module that touches engine internals). This file adds the
 * key check (one cheap request to the provider the key belongs to) and
 * the pure rules from src/core/companion/models.ts.
 */

import {
	aiReadiness,
	chooseModels,
	KEY_PROVIDERS,
	PROVIDER_LABEL,
	validateSlotChoices,
	type AiProvider,
	type AiStatus,
	type CatalogModel,
	type KeyProvider,
	type SlotChoices,
} from "../../core/companion/models.ts";
import type { ModelSlotName as ModelSlot } from "../../core/settings.ts";
import { badRequest, CompanionError } from "./errors.ts";

export type ChatGPTOp = "login" | "cancel" | "logout" | "consent";
export const CHATGPT_OPS: readonly ChatGPTOp[] = ["login", "cancel", "logout", "consent"];

export interface AiPort {
	chatgptStatus(): Promise<AiStatus["chatgpt"]>;
	/** Runs a ChatGPT control op. `login` returns the same-origin browser action to open. */
	chatgptControl(op: ChatGPTOp, fields: Record<string, unknown>, req: Request): Promise<{ browserAction?: string; error?: string }>;
	keysPresent(): Record<KeyProvider, boolean>;
	saveKey(provider: KeyProvider, value: string): { ok: true } | { ok: false; error: string };
	deleteKey(provider: KeyProvider): void;
	/** The live catalogue for every connected provider (refreshed first). */
	catalog(): Promise<CatalogModel[]>;
	slots(): SlotChoices;
	/** Replace the three slots (null clears them). Validated by the engine's own catalogue gate. */
	writeSlots(slots: SlotChoices | null): { ok: true } | { ok: false; error: string };
	/** Dictation (F-116, O-5: the student's own Deepgram key). */
	voiceKeyPresent(): boolean;
	/** Check the key can mint a dictation token (it needs Member permission), then save it. */
	saveVoiceKey(value: string): Promise<{ ok: true } | { ok: false; error: string }>;
	deleteVoiceKey(): void;
}

/** One cheap request with the key; resolves to an error message, or null when the key works. */
export type KeyVerifier = (provider: KeyProvider, key: string) => Promise<string | null>;

const VERIFY: Record<KeyProvider, { url: string; headers: (key: string) => Record<string, string> }> = {
	anthropic: { url: "https://api.anthropic.com/v1/models?limit=1", headers: (k) => ({ "x-api-key": k, "anthropic-version": "2023-06-01" }) },
	openai: { url: "https://api.openai.com/v1/models", headers: (k) => ({ authorization: `Bearer ${k}` }) },
	// OpenRouter's model list is public; /key needs a valid key.
	openrouter: { url: "https://openrouter.ai/api/v1/key", headers: (k) => ({ authorization: `Bearer ${k}` }) },
};

export const verifyProviderKey: KeyVerifier = async (provider, key) => {
	const { url, headers } = VERIFY[provider];
	try {
		const res = await fetch(url, { headers: headers(key), redirect: "error", signal: AbortSignal.timeout(15_000) });
		await res.body?.cancel().catch(() => {});
		if (res.ok) return null;
		if (res.status === 401 || res.status === 403) return `${PROVIDER_LABEL[provider]} didn't accept that key. Check it and try again.`;
		return `${PROVIDER_LABEL[provider]} answered with an error (${res.status}). Try again in a minute.`;
	} catch {
		return `Couldn't reach ${PROVIDER_LABEL[provider]}. Check your internet connection.`;
	}
};

export interface AiEventSink {
	(type: "ai_connected" | "ai_disconnected" | "ai_error", data: Record<string, unknown>): void;
}

export class CompanionAi {
	constructor(
		private readonly port: AiPort,
		private readonly verifyKey: KeyVerifier,
		private readonly log: AiEventSink,
		private readonly onReady: (ready: boolean) => void = () => {},
	) {}

	/** The connection, the slots and whether sessions can run, plus the catalogue to pick from. */
	async status(): Promise<AiStatus & { catalog: CatalogModel[] }> {
		const [chatgpt, catalog] = await Promise.all([this.port.chatgptStatus(), this.port.catalog()]);
		const keys = this.port.keysPresent();
		const slots = this.port.slots();
		const readiness = aiReadiness({ chatgpt, keys, slots, catalog });
		this.onReady(readiness.ready);
		return { chatgpt, keys, slots, catalog, ...readiness, voice: this.port.voiceKeyPresent() };
	}

	/** Cached-free readiness for the engine default and /health. */
	async ready(): Promise<boolean> {
		return (await this.status()).ready;
	}

	async chatgpt(op: unknown, fields: Record<string, unknown>, req: Request) {
		if (typeof op !== "string" || !(CHATGPT_OPS as readonly string[]).includes(op)) throw badRequest(`op must be one of ${CHATGPT_OPS.join(", ")}`);
		if (op === "consent" && typeof fields.enabled !== "boolean") throw badRequest("consent needs enabled: true or false");
		const result = await this.port.chatgptControl(op as ChatGPTOp, op === "consent" ? { enabled: fields.enabled } : {}, req);
		if (result.error) this.log("ai_error", { provider: "chatgpt", op, message: result.error });
		if (op === "logout") this.afterDisconnect("chatgpt");
		if (op === "consent") this.log(fields.enabled ? "ai_connected" : "ai_error", { provider: "chatgpt", backgroundUse: fields.enabled });
		return { ...result, status: await this.status() };
	}

	/** Save and check an API key. A key the provider refuses is not kept. */
	async connectKey(provider: unknown, key: unknown) {
		if (typeof provider !== "string" || !(KEY_PROVIDERS as readonly string[]).includes(provider)) throw badRequest(`provider must be one of ${KEY_PROVIDERS.join(", ")}`);
		if (typeof key !== "string" || !key.trim()) throw badRequest("paste your API key");
		const p = provider as KeyProvider;
		const problem = await this.verifyKey(p, key.trim());
		if (problem) {
			this.log("ai_error", { provider: p, op: "key", message: problem });
			throw new CompanionError("key_rejected", 400, problem);
		}
		const saved = this.port.saveKey(p, key.trim());
		if (!saved.ok) {
			this.log("ai_error", { provider: p, op: "key", message: saved.error });
			throw new CompanionError("key_rejected", 400, saved.error);
		}
		this.log("ai_connected", { provider: p, via: "key" });
		return this.status();
	}

	/** Me → Voice (F-116): save a Deepgram key, or remove it ({ key: null }). */
	async voice(key: unknown) {
		if (key === null) {
			this.port.deleteVoiceKey();
			return this.status();
		}
		if (typeof key !== "string" || !key.trim()) throw badRequest("paste your Deepgram key");
		const r = await this.port.saveVoiceKey(key.trim());
		if (!r.ok) throw new CompanionError("key_rejected", 400, r.error);
		return this.status();
	}

	/** Write the student's picks for all three slots. */
	async setModels(body: unknown) {
		const choices = parseChoices(body);
		const catalog = await this.port.catalog();
		const problems = validateSlotChoices(choices, catalog);
		const first = Object.values(problems)[0];
		if (first) throw new CompanionError("models_invalid", 400, first, problems);
		const written = this.port.writeSlots(choices);
		if (!written.ok) throw new CompanionError("models_invalid", 400, written.error);
		this.log("ai_connected", { provider: choices.strong!.model.provider, via: "models", models: summary(choices), auto: false });
		return this.status();
	}

	/** "Choose for me": fill the slots from the curated list for one connected provider. */
	async chooseForMe(provider: unknown) {
		const status = await this.status();
		const p = (typeof provider === "string" ? provider : status.provider) as AiProvider | null;
		if (!p) throw new CompanionError("not_connected", 409, "Connect your AI first.");
		const picked = chooseModels(p, status.catalog);
		if (picked.missing.length > 0) {
			return { ...status, slots: { ...status.slots, ...picked.slots }, missing: picked.missing, saved: false };
		}
		const written = this.port.writeSlots(picked.slots);
		if (!written.ok) throw new CompanionError("models_invalid", 400, written.error);
		this.log("ai_connected", { provider: p, via: "models", models: summary(picked.slots), auto: true });
		return { ...(await this.status()), missing: [] as ModelSlot[], saved: true };
	}

	/** Disconnect one provider (sign out of ChatGPT, or delete a key) and clear slots that used it. */
	async disconnect(provider: unknown, req: Request) {
		if (provider === "chatgpt") {
			await this.port.chatgptControl("logout", {}, req);
		} else if (typeof provider === "string" && (KEY_PROVIDERS as readonly string[]).includes(provider)) {
			this.port.deleteKey(provider as KeyProvider);
		} else throw badRequest("provider must be chatgpt, anthropic, openai or openrouter");
		this.afterDisconnect(provider);
		return this.status();
	}

	private afterDisconnect(provider: string) {
		const slots = this.port.slots();
		if (Object.values(slots).some((s) => s?.model.provider === provider)) this.port.writeSlots(null);
		this.log("ai_disconnected", { provider });
	}
}

function summary(slots: SlotChoices) {
	return Object.fromEntries(Object.entries(slots).map(([k, v]) => [k, `${v!.model.provider}/${v!.model.id}${v!.thinkingLevel ? `@${v!.thinkingLevel}` : ""}`]));
}

function parseChoices(body: unknown): SlotChoices {
	if (!body || typeof body !== "object") throw badRequest("send { strong, cheap, vision }");
	const out: SlotChoices = {};
	for (const slot of ["strong", "cheap", "vision"] as const) {
		const raw = (body as Record<string, unknown>)[slot] as { model?: { provider?: unknown; id?: unknown }; thinkingLevel?: unknown } | undefined;
		if (!raw) continue;
		if (typeof raw.model?.provider !== "string" || typeof raw.model?.id !== "string") throw badRequest(`${slot}.model needs provider and id`);
		out[slot] = {
			model: { provider: raw.model.provider, id: raw.model.id },
			...(typeof raw.thinkingLevel === "string" && raw.thinkingLevel ? { thinkingLevel: raw.thinkingLevel as never } : {}),
		};
	}
	return out;
}
