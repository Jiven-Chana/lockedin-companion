/**
 * Connect your AI (v0.1 F-101): "Choose for me", slot validation and
 * readiness. Pure rules over a fake catalogue.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	aiReadiness,
	chooseModels,
	MODEL_PREFERENCES,
	slotCandidates,
	validateSlotChoices,
	type AiStatus,
	type CatalogModel,
	type SlotChoices,
} from "../src/core/companion/index.ts";
import { MODEL_SLOTS } from "../src/core/settings.ts";

const m = (provider: string, id: string, over: Partial<CatalogModel> = {}): CatalogModel => ({
	id, name: id, provider, input: ["text", "image"], reasoning: true, supportedLevels: ["off", "minimal", "low", "medium", "high"], cost: null, ...over,
});

const chatgptFull = [m("chatgpt", "gpt-6-sol"), m("chatgpt", "gpt-6-luna"), m("chatgpt", "gpt-5.4")];
const anthropic = [m("anthropic", "claude-sonnet-5-5"), m("anthropic", "claude-haiku-5-5")];

describe('"Choose for me"', () => {
	const cases: Array<[string, Parameters<typeof chooseModels>[0], CatalogModel[], Record<string, string | undefined>, string[]]> = [
		["ChatGPT, balanced picks", "chatgpt", chatgptFull, { strong: "gpt-6-sol", cheap: "gpt-6-luna", vision: "gpt-6-sol" }, []],
		["Anthropic, balanced picks", "anthropic", anthropic, { strong: "claude-sonnet-5-5", cheap: "claude-haiku-5-5", vision: "claude-sonnet-5-5" }, []],
		[
			"an account without the first choice falls back down the list",
			"chatgpt",
			[m("chatgpt", "gpt-5.4"), m("chatgpt", "gpt-5-mini")],
			{ strong: "gpt-5.4", cheap: "gpt-5-mini", vision: "gpt-5.4" },
			[],
		],
		[
			"Vision skips a text-only model",
			"chatgpt",
			[m("chatgpt", "gpt-6-sol", { input: ["text"] }), m("chatgpt", "gpt-5.4"), m("chatgpt", "gpt-6-luna")],
			{ strong: "gpt-6-sol", cheap: "gpt-6-luna", vision: "gpt-5.4" },
			[],
		],
		["nothing preferred is offered: the slots are left for the student", "chatgpt", [m("chatgpt", "o3")], {}, ["strong", "cheap", "vision"]],
		["another provider's models are never picked", "openai", chatgptFull, {}, ["strong", "cheap", "vision"]],
	];
	for (const [name, provider, catalog, expected, missing] of cases)
		it(name, () => {
			const r = chooseModels(provider, catalog);
			for (const slot of MODEL_SLOTS) assert.equal(r.slots[slot]?.model.id, expected[slot], slot);
			assert.deepEqual(r.missing, missing);
		});

	it("Strong gets thinking low; the helpers keep their default", () => {
		const r = chooseModels("chatgpt", chatgptFull);
		assert.equal(r.slots.strong?.thinkingLevel, "low");
		assert.equal(r.slots.cheap?.thinkingLevel, undefined);
	});

	it("a level the model can't do is dropped, not sent", () => {
		const r = chooseModels("chatgpt", [m("chatgpt", "gpt-6-sol", { supportedLevels: ["off", "high"] }), m("chatgpt", "gpt-6-luna")]);
		assert.equal(r.slots.strong?.thinkingLevel, undefined);
	});

	it("every provider has a list for every slot", () => {
		for (const prefs of Object.values(MODEL_PREFERENCES)) for (const slot of MODEL_SLOTS) assert.ok(prefs[slot].ids.length > 0);
	});
});

describe("slot choices", () => {
	it("Vision only lists image models", () => {
		const list = slotCandidates("vision", [m("openai", "a"), m("openai", "b", { input: ["text"] })]);
		assert.deepEqual(list.map((x) => x.id), ["a"]);
	});

	const good: SlotChoices = {
		strong: { model: { provider: "chatgpt", id: "gpt-6-sol" }, thinkingLevel: "low" },
		cheap: { model: { provider: "chatgpt", id: "gpt-6-luna" } },
		vision: { model: { provider: "chatgpt", id: "gpt-6-sol" } },
	};
	const cases: Array<[string, SlotChoices, CatalogModel[], string[]]> = [
		["all three set and available", good, chatgptFull, []],
		["a missing slot", { strong: good.strong, cheap: good.cheap }, chatgptFull, ["vision"]],
		["a model not in the catalogue", { ...good, cheap: { model: { provider: "chatgpt", id: "gone" } } }, chatgptFull, ["cheap"]],
		["a text-only Vision model", good, [m("chatgpt", "gpt-6-sol", { input: ["text"] }), m("chatgpt", "gpt-6-luna")], ["vision"]],
		["a made-up thinking level", { ...good, strong: { model: good.strong!.model, thinkingLevel: "turbo" as never } }, chatgptFull, ["strong"]],
	];
	for (const [name, choices, catalog, problems] of cases)
		it(name, () => assert.deepEqual(Object.keys(validateSlotChoices(choices, catalog)).sort(), problems));
});

describe("is the student's AI ready?", () => {
	const off: AiStatus["chatgpt"] = { connected: false, pending: false, allowBackgroundUse: true, email: null, error: null, available: true };
	const on = { ...off, connected: true };
	const noKeys = { anthropic: false, openai: false, openrouter: false };
	const chatSlots = chooseModels("chatgpt", chatgptFull).slots;
	const cases: Array<[string, Parameters<typeof aiReadiness>[0], { ready: boolean; provider: string | null; modelsReady: boolean }]> = [
		["nothing connected", { chatgpt: off, keys: noKeys, slots: {}, catalog: [] }, { ready: false, provider: null, modelsReady: false }],
		["ChatGPT signed in, no models yet", { chatgpt: on, keys: noKeys, slots: {}, catalog: chatgptFull }, { ready: false, provider: "chatgpt", modelsReady: false }],
		["ChatGPT with models", { chatgpt: on, keys: noKeys, slots: chatSlots, catalog: chatgptFull }, { ready: true, provider: "chatgpt", modelsReady: true }],
		[
			"ChatGPT with background use off",
			{ chatgpt: { ...on, allowBackgroundUse: false }, keys: noKeys, slots: chatSlots, catalog: chatgptFull },
			{ ready: false, provider: "chatgpt", modelsReady: true },
		],
		["slots left on ChatGPT after signing out", { chatgpt: off, keys: noKeys, slots: chatSlots, catalog: [] }, { ready: false, provider: null, modelsReady: false }],
		[
			"an Anthropic key with its models",
			{ chatgpt: off, keys: { ...noKeys, anthropic: true }, slots: chooseModels("anthropic", anthropic).slots, catalog: anthropic },
			{ ready: true, provider: "anthropic", modelsReady: true },
		],
	];
	for (const [name, input, expected] of cases)
		it(name, () => {
			const r = aiReadiness(input);
			assert.deepEqual({ ready: r.ready, provider: r.provider, modelsReady: r.modelsReady }, expected);
			assert.equal(r.blocker === null, r.ready);
		});
});
