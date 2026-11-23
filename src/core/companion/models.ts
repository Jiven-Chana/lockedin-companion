/**
 * Connect your AI (v0.1 F-101): the providers a student can connect, the
 * three LearnHarness model slots, and the curated "Choose for me" picks.
 * Pure and browser-safe: the connect screen and Me → AI render from these.
 *
 * Slots are LearnHarness's own (components/settings/agent-section.tsx,
 * ROLE_SLOT in src/core/settings.ts): Strong = prober + teacher, Cheap =
 * the helper roles (question banks, research, grading), Vision = drawing
 * and reading PDFs. The student picks a model per slot like in
 * LearnHarness, or presses "Choose for me" (DECISIONS.md V-15).
 *
 * "Choose for me" (open decision O-2, decided 23 Nov: "Balanced"): each
 * slot walks a short preference list and takes the first id the
 * student's live catalogue offers. ChatGPT's catalogue depends on the
 * account, hence the fallbacks. Confirm with a real run at the checkpoint.
 */

import { MODEL_SLOTS, type ModelSlotName } from "../settings.ts";

export type AiProvider = "chatgpt" | "anthropic" | "openai" | "openrouter";
export const AI_PROVIDERS: readonly AiProvider[] = ["chatgpt", "anthropic", "openai", "openrouter"];
export type KeyProvider = Exclude<AiProvider, "chatgpt">;
export const KEY_PROVIDERS: readonly KeyProvider[] = ["anthropic", "openai", "openrouter"];

/** The engine's key ids (src/core/auth-keys.ts): the env-var names. */
export const PROVIDER_KEY_ID: Record<KeyProvider, string> = {
	anthropic: "ANTHROPIC_API_KEY",
	openai: "OPENAI_API_KEY",
	openrouter: "OPENROUTER_API_KEY",
};

export const PROVIDER_LABEL: Record<AiProvider, string> = {
	chatgpt: "ChatGPT",
	anthropic: "Anthropic",
	openai: "OpenAI",
	openrouter: "OpenRouter",
};

/** The engine's slot names (src/core/settings.ts), re-used so the two never drift. */
type ModelSlot = ModelSlotName;

/** LearnHarness's labels and roster lines, plus who uses each slot in LockedIn. */
export const SLOT_META: Record<ModelSlot, { label: string; roster: string; agents: string }> = {
	strong: { label: "Strong", roster: "The main model for your sessions", agents: "Prober and teacher" },
	cheap: { label: "Cheap", roster: "The assistants that write questions, research and grade your work", agents: "Question banks, research, grading" },
	vision: { label: "Vision", roster: "The assistants that draw diagrams and read your PDFs", agents: "Diagrams and PDF reading" },
};

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

/** One catalogue row, as the connect screen needs it (a subset of the engine's ModelCatalogEntry). */
export interface CatalogModel {
	id: string;
	name: string;
	provider: string;
	input: ("text" | "image")[];
	reasoning: boolean;
	supportedLevels: string[];
	/** USD per million tokens; null on a ChatGPT subscription (covered by the plan). */
	cost: { input: number; output: number } | null;
}

export interface SlotChoice {
	model: { provider: string; id: string };
	thinkingLevel?: ThinkingLevel;
}
export type SlotChoices = Partial<Record<ModelSlot, SlotChoice>>;

/** "Choose for me": preference order per provider and slot. */
export const MODEL_PREFERENCES: Record<AiProvider, Record<ModelSlot, { ids: readonly string[]; thinkingLevel?: ThinkingLevel }>> = {
	chatgpt: {
		strong: { ids: ["gpt-6-sol", "gpt-6.1-sol", "gpt-5.6-sol", "gpt-5.5", "gpt-5.4"], thinkingLevel: "low" },
		cheap: { ids: ["gpt-6-luna", "gpt-5.6-luna", "gpt-5.4-mini", "gpt-5-mini"] },
		vision: { ids: ["gpt-6-sol", "gpt-6.1-sol", "gpt-5.6-sol", "gpt-5.5", "gpt-5.4"] },
	},
	openai: {
		strong: { ids: ["gpt-6-sol", "gpt-6.1-sol", "gpt-5.6-sol", "gpt-5.5", "gpt-5.4"], thinkingLevel: "low" },
		cheap: { ids: ["gpt-6-luna", "gpt-5.6-luna", "gpt-5.4-mini", "gpt-5-mini"] },
		vision: { ids: ["gpt-6-sol", "gpt-6.1-sol", "gpt-5.6-sol", "gpt-5.5", "gpt-5.4"] },
	},
	anthropic: {
		strong: { ids: ["claude-sonnet-5-5", "claude-sonnet-5", "claude-sonnet-4-6"], thinkingLevel: "low" },
		cheap: { ids: ["claude-haiku-5-5", "claude-haiku-4-5"] },
		vision: { ids: ["claude-sonnet-5-5", "claude-sonnet-5", "claude-sonnet-4-6"] },
	},
	openrouter: {
		strong: { ids: ["anthropic/claude-sonnet-5.5", "openai/gpt-6-sol"], thinkingLevel: "low" },
		cheap: { ids: ["anthropic/claude-haiku-5.5", "openai/gpt-6-luna"] },
		vision: { ids: ["anthropic/claude-sonnet-5.5", "openai/gpt-6-sol"] },
	},
};

/** The models a slot may use: anything from a connected provider; Vision needs image input. */
export function slotCandidates(slot: ModelSlot, catalog: readonly CatalogModel[]): CatalogModel[] {
	return catalog.filter((m) => slot !== "vision" || m.input.includes("image"));
}

/** Keep a thinking level only where the model supports it (the engine would clamp it anyway). */
function levelFor(model: CatalogModel, wanted: ThinkingLevel | undefined): ThinkingLevel | undefined {
	if (!wanted || !model.reasoning) return undefined;
	return model.supportedLevels.includes(wanted) ? wanted : undefined;
}

/**
 * "Choose for me" for one provider. Returns every slot it could fill and
 * the slots it couldn't (none of the preferred ids is in this account's
 * catalogue): the screen then asks the student to pick those by hand.
 */
export function chooseModels(provider: AiProvider, catalog: readonly CatalogModel[]): { slots: SlotChoices; missing: ModelSlot[] } {
	const slots: SlotChoices = {};
	const missing: ModelSlot[] = [];
	for (const slot of MODEL_SLOTS) {
		const pref = MODEL_PREFERENCES[provider][slot];
		const candidates = slotCandidates(slot, catalog).filter((m) => m.provider === provider);
		const pick = pref.ids.map((id) => candidates.find((m) => m.id === id)).find((m) => m !== undefined);
		if (!pick) {
			missing.push(slot);
			continue;
		}
		const thinkingLevel = levelFor(pick, pref.thinkingLevel);
		slots[slot] = { model: { provider: pick.provider, id: pick.id }, ...(thinkingLevel ? { thinkingLevel } : {}) };
	}
	return { slots, missing };
}

/**
 * Check a set of slot choices against the live catalogue before writing
 * them. Returns a problem per slot, or an empty object when all three
 * are filled with models that exist (and Vision's takes images).
 */
export function validateSlotChoices(choices: SlotChoices, catalog: readonly CatalogModel[]): Partial<Record<ModelSlot, string>> {
	const problems: Partial<Record<ModelSlot, string>> = {};
	for (const slot of MODEL_SLOTS) {
		const c = choices[slot];
		if (!c) {
			problems[slot] = `Pick a model for ${SLOT_META[slot].label}.`;
			continue;
		}
		const model = catalog.find((m) => m.provider === c.model.provider && m.id === c.model.id);
		if (!model) problems[slot] = `${c.model.id} isn't available on your connection.`;
		else if (slot === "vision" && !model.input.includes("image")) problems[slot] = `${model.name} can't read images. Pick another for Vision.`;
		else if (c.thinkingLevel && !(THINKING_LEVELS as readonly string[]).includes(c.thinkingLevel)) problems[slot] = `Unknown thinking level ${c.thinkingLevel}.`;
	}
	return problems;
}

/** The connection the student has, as /api/companion/ai reports it. */
export interface AiStatus {
	/** The provider whose models fill the slots (null: not connected). */
	provider: AiProvider | null;
	chatgpt: { connected: boolean; pending: boolean; allowBackgroundUse: boolean; email: string | null; error: string | null; available: boolean };
	keys: Record<KeyProvider, boolean>;
	slots: SlotChoices;
	/** All three slots set to models from a connected provider. */
	modelsReady: boolean;
	/** True when sessions can run on the student's AI (connected + models ready + background use, for ChatGPT). */
	ready: boolean;
	/** Why not ready, in plain words (null when ready). */
	blocker: string | null;
	/** Dictation (F-116): a Deepgram key is saved. The mic is hidden without one. */
	voice?: boolean;
}

/** Which provider a set of slots runs on, when they all agree. */
export function slotsProvider(slots: SlotChoices): string | null {
	const providers = new Set(MODEL_SLOTS.map((s) => slots[s]?.model.provider).filter((p): p is string => !!p));
	return providers.size === 1 ? [...providers][0]! : null;
}

/**
 * Is the student's AI usable for sessions? Pure: the server gathers the
 * facts (which credentials exist, what the slots hold, which models the
 * catalogue offers) and this decides.
 */
export function aiReadiness(input: {
	chatgpt: AiStatus["chatgpt"];
	keys: AiStatus["keys"];
	slots: SlotChoices;
	catalog: readonly CatalogModel[];
}): Pick<AiStatus, "provider" | "modelsReady" | "ready" | "blocker"> {
	const connected = (p: string) => (p === "chatgpt" ? input.chatgpt.connected : (KEY_PROVIDERS as readonly string[]).includes(p) && input.keys[p as KeyProvider]);
	const anyConnection = input.chatgpt.connected || KEY_PROVIDERS.some((p) => input.keys[p]);
	const filled = MODEL_SLOTS.every((s) => input.slots[s]);
	const modelsReady = filled && Object.keys(validateSlotChoices(input.slots, input.catalog)).length === 0 && MODEL_SLOTS.every((s) => connected(input.slots[s]!.model.provider));
	const used = new Set(MODEL_SLOTS.map((s) => input.slots[s]?.model.provider).filter((p): p is string => !!p));
	const single = slotsProvider(input.slots);
	const provider = (single && (AI_PROVIDERS as readonly string[]).includes(single) ? single : input.chatgpt.connected ? "chatgpt" : (KEY_PROVIDERS.find((p) => input.keys[p]) ?? null)) as AiProvider | null;
	let blocker: string | null = null;
	if (!anyConnection) blocker = "Connect your AI to start.";
	else if (!modelsReady) blocker = "Pick a model for each of Strong, Cheap and Vision.";
	else if (used.has("chatgpt") && !input.chatgpt.allowBackgroundUse) blocker = "Background use is off for ChatGPT, so sessions can't start.";
	return { provider: anyConnection ? provider : null, modelsReady, ready: blocker === null, blocker };
}
