/**
 * "Plan my week with me" (v0.1 F-109, V-4, J8): an optional, short chat.
 * Each turn is one generate() call with the conversation so far, returning
 * { say, chips, done, draft }. The server keeps nothing between turns and
 * saves nothing until the student confirms the summary card (saveRoutine).
 *
 * The prompt's rules (one question, chips always, ≤ 60 words, never
 * diagnosis, location, settings or statistics) are also checked here; a
 * reply that breaks them is retried by the model, and after that the
 * screen falls back to "Let's do this with taps instead" (the plain form).
 */

import fs from "node:fs";
import path from "node:path";
import { SETUP_CHAT_RULES } from "../../core/companion/policy.ts";
import type { Generate } from "./generate.ts";

export interface ChatTurnInput {
	messages: { role: "assistant" | "student"; text: string }[];
	modules: { code: string; name: string }[];
}

export interface ChatTurn {
	say: string;
	chips: string[];
	done: boolean;
	draft: Record<string, unknown>;
}

const SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: ["say", "chips", "done", "draft"],
	properties: {
		say: { type: "string" },
		chips: { type: "array", minItems: 2, maxItems: 6, items: { type: "string" } },
		done: { type: "boolean" },
		draft: {
			type: "object",
			additionalProperties: false,
			properties: {
				energy: { type: "array", items: { type: "string", enum: ["morning", "afternoon", "evening"] } },
				commitments: {
					type: "array",
					items: { type: "object", additionalProperties: false, required: ["label", "weekdays", "start", "end"], properties: { label: { type: "string" }, weekdays: { type: "array", items: { type: "integer" } }, start: { type: "string" }, end: { type: "string" } } },
				},
				places: { type: "array", items: { type: "string" } },
				weeklyTargetMinutes: { type: "integer" },
				preferredBlockMinutes: { type: "integer" },
				modules: {
					type: "array",
					items: { type: "object", additionalProperties: false, required: ["code"], properties: { code: { type: "string" }, week: { type: "integer" }, readingWeeks: { type: "array", items: { type: "integer" } }, materialShape: { type: "string" } } },
				},
			},
		},
	},
};

const FORBIDDEN = /\b(diagnos\w*|adhd|dyslexi\w*|disabilit\w*|your location|where are you|settings|statistic\w*|studies show|most students|research shows)\b/i;
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/** The prompt's hard rules, checked on every reply. */
export function checkTurn(t: Partial<ChatTurn>): string | null {
	if (!t.say?.trim()) return "say something";
	if (words(t.say) > SETUP_CHAT_RULES.maxWords) return `say is ${words(t.say)} words; keep it to ${SETUP_CHAT_RULES.maxWords}`;
	if ((t.say.match(/\?/g) ?? []).length > 1) return "ask exactly one question";
	if (FORBIDDEN.test(t.say) || (t.chips ?? []).some((c) => FORBIDDEN.test(c))) return "never ask about health, location or settings, and never cite statistics";
	if (!Array.isArray(t.chips) || t.chips.length < 2) return "offer 2 to 6 chips";
	return null;
}

export class SetupChat {
	constructor(private readonly opts: { generate: Generate; promptsDir: string }) {}

	async turn(input: ChatTurnInput): Promise<ChatTurn> {
		const system = fs.readFileSync(path.join(/* turbopackIgnore: true */ this.opts.promptsDir, "setup-chat.md"), "utf-8");
		const asked = input.messages.filter((m) => m.role === "assistant").length;
		const user = [
			`The student's modules: ${input.modules.map((m) => `${m.code} (${m.name})`).join(", ") || "none yet"}.`,
			`Turns so far: ${asked} of at most ${SETUP_CHAT_RULES.maxTurns}.${asked >= SETUP_CHAT_RULES.maxTurns - 1 ? " This is the last turn: set done to true." : ""}`,
			"",
			"CONVERSATION SO FAR",
			...(input.messages.length ? input.messages.map((m) => `${m.role === "assistant" ? "You" : "Student"}: ${m.text}`) : ["(none: open with your first question)"]),
		].join("\n");
		const r = await this.opts.generate<ChatTurn>({
			slot: SETUP_CHAT_RULES.slot,
			system,
			user,
			toolName: "submit_turn",
			toolDescription: "Submit this turn of the chat.",
			schema: SCHEMA,
			validate: (v) => checkTurn(v as ChatTurn),
		});
		const t = r.value;
		return { say: t.say.trim(), chips: t.chips.map((c) => c.trim()).filter(Boolean).slice(0, 6), done: t.done || asked + 1 >= SETUP_CHAT_RULES.maxTurns, draft: t.draft ?? {} };
	}
}
