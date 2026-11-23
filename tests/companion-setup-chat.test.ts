/**
 * "Plan my week with me" (v0.1 F-109, J8): each turn's rules, the fallback
 * to the plain form, and nothing saved before Confirm. Fake AI.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { ManualClock } from "../src/server/companion/clock.ts";
import { CompanionContent } from "../src/server/companion/content.ts";
import { ScriptedEngine } from "../src/server/companion/engines/scripted.ts";
import type { Generate, GenerateRequest } from "../src/server/companion/generate.ts";
import { CompanionService } from "../src/server/companion/service.ts";
import { checkTurn } from "../src/server/companion/setup-chat.ts";
import { CompanionStore } from "../src/server/companion/store.ts";

const CONTENT = path.join(import.meta.dirname, "..", "companion", "content");
const PROMPTS = path.join(import.meta.dirname, "..", "companion", "prompts");

describe("each turn's rules", () => {
	const good = { say: "When do you usually have the most energy?", chips: ["Morning", "Afternoon", "Evening"], done: false, draft: {} };
	const cases: Array<[string, Partial<typeof good>, RegExp | null]> = [
		["one short question with chips", good, null],
		["over 60 words", { ...good, say: "word ".repeat(61) }, /60/],
		["two questions", { ...good, say: "When? And where?" }, /one question/],
		["no chips", { ...good, chips: [] }, /chips/],
		["asks about a diagnosis", { ...good, say: "Do you have an ADHD diagnosis?" }, /health/],
		["asks where they are", { ...good, say: "Where are you right now?" }, /location/],
		["offers to change settings", { ...good, say: "Shall I change your settings?" }, /settings/],
		["cites statistics", { ...good, say: "Most students aim for 6 hours. What about you?" }, /statistics/],
	];
	for (const [name, turn, problem] of cases)
		it(name, () => {
			const r = checkTurn(turn);
			if (problem) assert.match(r ?? "", problem);
			else assert.equal(r, null);
		});
});

async function setup(reply: (req: GenerateRequest) => unknown) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "companion-chat-"));
	const store = new CompanionStore(dir);
	const content = new CompanionContent(store, CONTENT);
	const clock = new ManualClock(new Date(2026, 10, 23, 7));
	const scripted = new ScriptedEngine((id) => content.scriptedSet(id));
	const calls: GenerateRequest[] = [];
	const generate: Generate = async <T,>(req: GenerateRequest) => {
		calls.push(req);
		const value = reply(req);
		const problem = req.validate?.(value);
		if (problem) throw new Error(`the model never fixed: ${problem}`);
		return { value: value as T, model: "fake/cheap", cost: null, ms: 1 };
	};
	const svc = new CompanionService({ store, content, clock, clockControl: { set: (t) => clock.set(t), reset: () => undefined }, engines: { scripted, learnharness: scripted }, defaultEngine: "scripted", generate, promptsDir: PROMPTS });
	(svc as unknown as { aiReady: boolean }).aiReady = true;
	await svc.onboardFlow({ calendar: { kind: "sample" } });
	return { svc, store, calls, events: () => store.events().map((e) => e.type) };
}

describe("the chat through the service", () => {
	it("opens with a question and chips, on the Cheap slot, and saves nothing", async () => {
		const { svc, store, calls, events } = await setup(() => ({ say: "When do you usually have energy?", chips: ["Morning", "Afternoon", "Evening"], done: false, draft: { energy: [] } }));
		const t = (await svc.setupChatTurn({ messages: [] })) as { say: string; chips: string[] };
		assert.equal(t.chips.length, 3);
		assert.equal(calls[0]!.slot, "cheap");
		assert.match(calls[0]!.user, /HCI/);
		assert.equal(store.profile()?.routine, undefined, "nothing saved before Confirm");
		assert.ok(events().includes("setup_chat_started") && events().includes("setup_chat_turn"));
	});

	it("the sixth turn is the last", async () => {
		const { svc } = await setup(() => ({ say: "Anything else?", chips: ["No", "Yes"], done: false, draft: {} }));
		const messages = Array.from({ length: 5 }, (_, i) => [{ role: "assistant" as const, text: `Q${i}` }, { role: "student" as const, text: `A${i}` }]).flat();
		const t = (await svc.setupChatTurn({ messages })) as { done: boolean };
		assert.equal(t.done, true);
	});

	it("a reply that keeps breaking the rules falls back to the plain form", async () => {
		const { svc, events } = await setup(() => ({ say: "Most students study 6 hours. How about you?", chips: ["2 h", "4 h"], done: false, draft: {} }));
		const t = (await svc.setupChatTurn({ messages: [] })) as { fallback?: boolean; say: string };
		assert.equal(t.fallback, true);
		assert.equal(t.say, "Let's do this with taps instead.");
		assert.ok(events().includes("setup_chat_fallback_form"));
	});

	it("Skip is logged and changes nothing", async () => {
		const { svc, store, events } = await setup(() => ({}));
		await svc.setupChatTurn({ skip: true });
		assert.ok(events().includes("setup_chat_skipped"));
		assert.equal(store.profile()?.routine, undefined);
	});
});
