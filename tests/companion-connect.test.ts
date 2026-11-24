/**
 * v0.1 stage 2 through CompanionService: connect your AI (F-101), the real
 * engine by default once it's ready (F-102), and calendar-first onboarding
 * with a first taste on the bundled sample lecture (J1′, V-17, O-3).
 * A fake AiPort stands in for the engine's sign-in, keys and catalogue.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { AiStatus, CatalogModel, KeyProvider, SlotChoices } from "../src/core/companion/index.ts";
import { FIRST_TASTE_LECTURE } from "../src/core/companion/index.ts";
import type { AiPort, KeyVerifier } from "../src/server/companion/ai.ts";
import { ManualClock } from "../src/server/companion/clock.ts";
import { CompanionContent } from "../src/server/companion/content.ts";
import { ScriptedEngine } from "../src/server/companion/engines/scripted.ts";
import type { SessionEngine } from "../src/server/companion/engines/types.ts";
import { CompanionError } from "../src/server/companion/errors.ts";
import { CompanionService } from "../src/server/companion/service.ts";
import { CompanionStore } from "../src/server/companion/store.ts";

const CONTENT = path.join(import.meta.dirname, "..", "companion", "content");
const NOW = new Date(2026, 10, 17, 12, 58); // a Tuesday

const model = (provider: string, id: string, over: Partial<CatalogModel> = {}): CatalogModel => ({
	id, name: id, provider, input: ["text", "image"], reasoning: true, supportedLevels: ["off", "low", "medium"], cost: null, ...over,
});
const CHATGPT_CATALOG = [model("chatgpt", "gpt-6-sol"), model("chatgpt", "gpt-6-luna")];
const ANTHROPIC_CATALOG = [model("anthropic", "claude-sonnet-5-5"), model("anthropic", "claude-haiku-5-5")];

class FakeAi implements AiPort {
	chatgpt: AiStatus["chatgpt"] = { connected: false, pending: false, allowBackgroundUse: true, email: null, error: null, available: true };
	keys: Record<KeyProvider, boolean> = { anthropic: false, openai: false, openrouter: false };
	stored: SlotChoices = {};
	controls: string[] = [];
	async chatgptStatus() {
		return { ...this.chatgpt };
	}
	async chatgptControl(op: string) {
		this.controls.push(op);
		if (op === "login") return { browserAction: "/api/subscriptions/browser?id=00000000-0000-0000-0000-000000000000" };
		if (op === "logout") this.chatgpt.connected = false;
		return {};
	}
	keysPresent() {
		return { ...this.keys };
	}
	saveKey(provider: KeyProvider) {
		this.keys[provider] = true;
		return { ok: true as const };
	}
	deleteKey(provider: KeyProvider) {
		this.keys[provider] = false;
	}
	async catalog() {
		return [...(this.chatgpt.connected ? CHATGPT_CATALOG : []), ...(this.keys.anthropic ? ANTHROPIC_CATALOG : [])];
	}
	slots() {
		return structuredClone(this.stored);
	}
	writeSlots(slots: SlotChoices | null) {
		this.stored = slots ? structuredClone(slots) : {};
		return { ok: true as const };
	}
	voice = false;
	voiceKeyPresent() {
		return this.voice;
	}
	async saveVoiceKey(value: string) {
		if (value !== "dg-member") return { ok: false as const, error: "That key can't start dictation: in the Deepgram console, give it Member permission (or make a new Member key)." };
		this.voice = true;
		return { ok: true as const };
	}
	deleteVoiceKey() {
		this.voice = false;
	}
}

function setup(opts: { verify?: KeyVerifier; calendar?: Record<string, string>; engineWhenAiReady?: boolean } = {}) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "companion-connect-"));
	const store = new CompanionStore(dir);
	const content = new CompanionContent(store, CONTENT);
	const clock = new ManualClock(NOW);
	const usedEngines: string[] = [];
	const loadSet = (id: string) => content.scriptedSet(id);
	/** The scripted engine under either name, recording which name started each session. */
	class Spy extends ScriptedEngine {
		constructor(private readonly label: string) {
			super(loadSet);
		}
		override start(...args: Parameters<ScriptedEngine["start"]>) {
			usedEngines.push(this.label);
			return super.start(...args);
		}
	}
	const spy = (name: string): SessionEngine => new Spy(name);
	const ai = new FakeAi();
	let n = 0;
	const svc = new CompanionService({
		store, content, clock,
		clockControl: { set: (t) => clock.set(t), reset: () => clock.set(NOW) },
		engines: { scripted: spy("scripted"), learnharness: spy("learnharness") },
		defaultEngine: "scripted",
		...(opts.engineWhenAiReady === false ? {} : { engineWhenAiReady: "learnharness" as const }),
		ai: { port: ai, verifyKey: opts.verify ?? (async () => null) },
		fetchCalendar: async (url) => {
			const text = opts.calendar?.[url];
			if (text === undefined) throw new Error("404 not found");
			return text;
		},
		newId: (p) => `${p}${++n}`,
	});
	const events = () => store.events().map((e) => e.type);
	return { svc, ai, store, events, usedEngines };
}

const ics = (...events: Array<[string, Date, Date]>) =>
	[
		"BEGIN:VCALENDAR",
		...events.flatMap(([summary, s, e], i) => [
			"BEGIN:VEVENT",
			`UID:e${i}@test`,
			`SUMMARY:${summary}`,
			`DTSTART:${s.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`,
			`DTEND:${e.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`,
			"END:VEVENT",
		]),
		"END:VCALENDAR",
	].join("\r\n");
const day = (d: number, h: number) => new Date(2026, 10, d, h);
const CALENDAR = ics(
	["Lecture [2LALG(4) - Linear Algebra]", day(18, 10), day(18, 11)],
	["Lecture [2LALG(4) - Linear Algebra]", day(25, 10), day(25, 11)],
	["Seminar [2STAT - Statistics]", day(19, 14), day(19, 15)],
);

describe("connect your AI (F-101)", () => {
	it("ChatGPT: sign-in hands back the browser action; Choose for me fills all three slots", async () => {
		const { svc, ai, events } = setup();
		const login = await svc.requireAi().chatgpt("login", {}, new Request("http://localhost:3000/"));
		assert.match(login.browserAction ?? "", /^\/api\/subscriptions\/browser\?id=/);
		ai.chatgpt.connected = true;
		const auto = await svc.requireAi().chooseForMe(undefined);
		assert.equal(auto.saved, true);
		assert.deepEqual(auto.missing, []);
		assert.equal(auto.slots.strong?.model.id, "gpt-6-sol");
		assert.equal(auto.slots.strong?.thinkingLevel, "low");
		assert.equal(auto.slots.cheap?.model.id, "gpt-6-luna");
		assert.equal(auto.ready, true);
		assert.ok(events().includes("ai_connected"));
	});

	it("the student can pick each slot by hand, and a bad pick is refused with the slot named", async () => {
		const { svc, ai } = setup();
		ai.chatgpt.connected = true;
		const pick = (id: string) => ({ model: { provider: "chatgpt", id } });
		const ok = await svc.requireAi().setModels({ strong: { ...pick("gpt-6-luna"), thinkingLevel: "medium" }, cheap: pick("gpt-6-luna"), vision: pick("gpt-6-sol") });
		assert.equal(ok.ready, true);
		assert.equal(ai.stored.strong?.thinkingLevel, "medium");
		await assert.rejects(
			svc.requireAi().setModels({ strong: pick("gpt-6-sol"), cheap: pick("nope"), vision: pick("gpt-6-sol") }),
			(e: CompanionError) => e.code === "models_invalid" && (e.detail as Record<string, string>).cheap !== undefined,
		);
	});

	it("an API key the provider refuses is not saved and gives a plain message", async () => {
		const { svc, ai, events } = setup({ verify: async () => "Anthropic didn't accept that key. Check it and try again." });
		await assert.rejects(svc.requireAi().connectKey("anthropic", "sk-ant-wrong-key-123"), /didn't accept that key/);
		assert.equal(ai.keys.anthropic, false);
		assert.ok(events().includes("ai_error"));
	});

	it("an accepted key, then Choose for me on that provider", async () => {
		const { svc } = setup();
		await svc.requireAi().connectKey("anthropic", "sk-ant-good-key-123");
		const auto = await svc.requireAi().chooseForMe("anthropic");
		assert.equal(auto.slots.strong?.model.id, "claude-sonnet-5-5");
		assert.equal(auto.slots.cheap?.model.id, "claude-haiku-5-5");
	});

	it("background use off for ChatGPT blocks sessions with a plain reason", async () => {
		const { svc, ai } = setup();
		ai.chatgpt.connected = true;
		await svc.requireAi().chooseForMe("chatgpt");
		ai.chatgpt.allowBackgroundUse = false;
		const s = await svc.requireAi().status();
		assert.equal(s.ready, false);
		assert.match(s.blocker ?? "", /Background use is off/);
	});

	it("disconnecting clears the slots that used it", async () => {
		const { svc, ai, events } = setup();
		ai.chatgpt.connected = true;
		await svc.requireAi().chooseForMe("chatgpt");
		const after = await svc.requireAi().disconnect("chatgpt", new Request("http://localhost:3000/"));
		assert.deepEqual(after.slots, {});
		assert.equal(after.ready, false);
		assert.ok(events().includes("ai_disconnected"));
	});
});

describe("Me → Voice: the student's own Deepgram key (F-116, O-5)", () => {
	it("no key: the mic is hidden (voice false)", async () => {
		const { svc } = setup();
		assert.equal((await svc.requireAi().status()).voice, false);
	});
	it("a key that can't start dictation is refused with the reason, and nothing is saved", async () => {
		const { svc, ai } = setup();
		await assert.rejects(svc.requireAi().voice("dg-read-only"), (e: CompanionError) => e.status === 400 && /Member permission/.test(e.message));
		await assert.rejects(svc.requireAi().voice("  "), (e: CompanionError) => e.status === 400);
		assert.equal(ai.voice, false);
	});
	it("a good key turns the mic on; removing it turns it off", async () => {
		const { svc } = setup();
		assert.equal((await svc.requireAi().voice(" dg-member ")).voice, true);
		assert.equal((await svc.requireAi().voice(null)).voice, false);
	});
	it("using the mic is logged as dictation_used (T23)", () => {
		const { svc, events } = setup();
		svc.logClientEvents({ type: "dictation_used", data: { field: "why" } });
		assert.ok(events().includes("dictation_used"));
	});
});

describe("the real engine by default (F-102)", () => {
	it("scripted until the AI is ready, LearnHarness after, scripted again after disconnecting", async () => {
		const { svc, ai, usedEngines, events } = setup();
		assert.equal(svc.defaultEngine(), "scripted");
		ai.chatgpt.connected = true;
		await svc.requireAi().chooseForMe("chatgpt");
		assert.equal(svc.defaultEngine(), "learnharness");
		assert.ok(events().includes("engine_ready"));
		const taste = svc.firstTaste();
		await svc.whenReady(taste.sessionId);
		assert.deepEqual(usedEngines, ["learnharness"]);
		await svc.requireAi().disconnect("chatgpt", new Request("http://localhost:3000/"));
		assert.equal(svc.defaultEngine(), "scripted");
	});

	it("an explicit engine (COMPANION_ENGINE) is never overridden", async () => {
		const { svc, ai } = setup({ engineWhenAiReady: false });
		ai.chatgpt.connected = true;
		await svc.requireAi().chooseForMe("chatgpt");
		assert.equal(svc.defaultEngine(), "scripted");
	});

	it("health reports the AI connection", async () => {
		const { svc, ai } = setup();
		assert.deepEqual((await svc.health()).ai, { connected: false, provider: null, modelsReady: false, ready: false, blocker: "Connect your AI to start." });
		ai.chatgpt.connected = true;
		await svc.requireAi().chooseForMe("chatgpt");
		const h = await svc.health();
		assert.deepEqual(h.ai, { connected: true, provider: "chatgpt", modelsReady: true, ready: true, blocker: null });
		assert.equal(h.defaultEngine, "learnharness");
	});
});

describe("onboarding v0.1: calendar first, then modules (J1′)", () => {
	it("a calendar link is read without saving anything, and proposes its modules", async () => {
		const { svc, store } = setup({ calendar: { "https://cal.example/feed.ics": CALENDAR } });
		const preview = await svc.calendarPreview({ url: "webcal://cal.example/feed.ics" });
		assert.equal(preview.events, 3);
		assert.deepEqual(preview.modules.map((m) => [m.code, m.name, m.confident]), [["2LALG", "Linear Algebra", true], ["2STAT", "Statistics", true]]);
		assert.equal(store.profile(), null, "nothing saved by a preview");
	});

	it("confirmed modules + the link: lectures are matched, the link kept, the first taste offered", async () => {
		const { svc, store, events } = setup({ calendar: { "https://cal.example/feed.ics": CALENDAR } });
		const ob = await svc.onboardFlow({ calendar: { kind: "link", url: "https://cal.example/feed.ics" }, modules: [{ code: "2LALG", name: "Linear Algebra" }, { code: "2STAT", name: "Statistics" }] });
		assert.deepEqual(ob.profile.modules, [{ code: "2LALG", name: "Linear Algebra" }, { code: "2STAT", name: "Statistics" }]);
		assert.deepEqual(ob.calendar, { added: 3, unmapped: 0 });
		assert.equal(store.runtime().calendarUrl, "https://cal.example/feed.ics");
		assert.equal(ob.reads.label, "Your calendar link");
		assert.equal(ob.firstTaste?.lectureId, FIRST_TASTE_LECTURE);
		assert.equal(ob.firstTaste?.sample, true);
		assert.ok(events().includes("onboarding_done"));
	});

	it("no calendar: typed modules get a code made from their name", async () => {
		const { svc, store } = setup();
		const ob = await svc.onboarding({ calendar: { kind: "none" }, modules: [{ name: "Organic Chemistry" }, { name: "Physical Chemistry" }] });
		assert.deepEqual(ob.profile.modules.map((m) => m.code), ["OC", "PC"]);
		assert.equal(ob.profile.timetableSource, "none");
		assert.equal(ob.reads.label, "No timetable connected");
		assert.deepEqual(store.lectures(), []);
	});

	it("the sample timetable keeps working as the labelled demo", async () => {
		const { svc } = setup();
		const ob = await svc.onboarding({ calendar: { kind: "sample" } });
		assert.equal(ob.reads.label, "Sample timetable");
		assert.ok(ob.profile.modules.some((m) => m.code === "HCI"));
	});

	const bad: Array<[string, unknown, RegExp]> = [
		["no modules without the sample", { calendar: { kind: "none" }, modules: [] }, /at least one module/],
		["an unknown calendar kind", { calendar: { kind: "outlook" }, modules: [{ name: "X" }] }, /calendar.kind/],
		["a file with no text", { calendar: { kind: "file" }, modules: [{ name: "X" }] }, /calendar.text/],
		["two modules with one code", { calendar: { kind: "none" }, modules: [{ code: "A1", name: "X" }, { code: "a1", name: "Y" }] }, /share the code/],
	];
	for (const [name, body, message] of bad) it(`refuses ${name}`, async () => {
		const { svc, store } = setup();
		await assert.rejects(svc.onboarding(body), message);
		assert.equal(store.profile(), null);
	});

	it("a link that can't be fetched leaves no half-made profile", async () => {
		const { svc, store } = setup();
		await assert.rejects(svc.onboarding({ calendar: { kind: "link", url: "https://cal.example/missing.ics" }, modules: [{ name: "X" }] }), (e: CompanionError) => e.code === "calendar_fetch_failed");
		assert.equal(store.profile(), null);
	});

	it("the first taste prepares before onboarding finishes, and opens after", async () => {
		const { svc } = setup();
		const taste = svc.firstTaste();
		assert.equal(taste.lectureId, FIRST_TASTE_LECTURE);
		await svc.onboarding({ calendar: { kind: "none" }, modules: [{ name: "Organic Chemistry" }] });
		await svc.whenReady(taste.sessionId);
		const v = await svc.view(taste.sessionId);
		assert.equal(v.status, "question");
		assert.equal(v.budget, 3);
		assert.equal(v.lecture.id, FIRST_TASTE_LECTURE, "a student who doesn't take HCI can still open the sample");
	});

	it("dry run: back and forward on the modules screen reuses the first taste, and onboarding is logged once", async () => {
		const { svc, events } = setup();
		const a = svc.firstTaste();
		const b = svc.firstTaste();
		assert.equal(b.sessionId, a.sessionId, "not prepared twice on the student's AI");
		await svc.onboarding({ calendar: { kind: "sample" } });
		assert.equal(events().filter((t) => t === "onboarding_done").length, 1);
		await svc.whenReady(a.sessionId);
		await svc.view(a.sessionId);
		await svc.answer(a.sessionId, { questionId: (await svc.view(a.sessionId)).question!.id, indices: [1], confidence: 50 });
		assert.notEqual(svc.firstTaste().sessionId, a.sessionId, "once answered, a new one is made");
	});

	it("before onboarding, only the first taste may start", () => {
		const { svc } = setup();
		assert.throws(() => svc.createSession({ kind: "post-lecture", lectureId: FIRST_TASTE_LECTURE, mode: "question-first", budget: { questions: 5, minutes: 10 } }), (e: CompanionError) => e.status === 409);
	});
});
