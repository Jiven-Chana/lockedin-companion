/**
 * Study packs end to end through CompanionService with a fake AI (v0.1
 * F-105, F-106): stages, dropping a bad item, the bank as the no-AI
 * fallback, node-scoped quizzes, cancel and resume, authored maps kept.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { PHONE_RULES, PACK_COPY, PACK_RULES, packStatusLine, type PackMeta, type SlidePage } from "../src/core/companion/index.ts";
import { ManualClock } from "../src/server/companion/clock.ts";
import { CompanionContent } from "../src/server/companion/content.ts";
import { ScriptedEngine } from "../src/server/companion/engines/scripted.ts";
import type { Generate, GenerateRequest } from "../src/server/companion/generate.ts";
import { CompanionService } from "../src/server/companion/service.ts";
import { CompanionStore } from "../src/server/companion/store.ts";

const CONTENT = path.join(import.meta.dirname, "..", "companion", "content");
const PROMPTS = path.join(import.meta.dirname, "..", "companion", "prompts");
const NOW = new Date(2026, 10, 23, 12);
/** Enough text on each page for a unit to be worth studying (MATERIALS_RULES.minUnitChars). */
const FILL = " It explains the idea step by step, with a worked example and a short check.".repeat(4);
const pdf = (...titles: string[]) => new Uint8Array([0x25, 0x50, 0x44, 0x46, ...new TextEncoder().encode(titles.join("|"))]);
const pdfToPages = async (data: Uint8Array): Promise<SlidePage[]> =>
	new TextDecoder().decode(data.slice(4)).split("|").map((t, i) => ({ number: i + 1, kind: "text" as const, markdown: `# ${t}\nBody of ${t}.${FILL}` }));

const question = (i: number, node: string, over: Record<string, unknown> = {}) => ({
	stem: `Question ${i} about ${node}?`, options: [`Right ${i}`, `Wrong A ${i}`, `Wrong B ${i}`], correct: 0, explanation: `Because ${node}.`, slides: [node === "best-response" ? 1 : 2], node, difficulty: 1, ...over,
});

/** A fake AI that answers each pack stage, optionally waiting on a gate (for cancel) or failing some calls (`fail` returns the error message). */
function fakeAi(opts: { gate?: Promise<void>; fail?: (tool: string, nth: number) => string | null } = {}) {
	const calls: string[] = [];
	const requests: GenerateRequest[] = [];
	const generate: Generate = async <T,>(req: GenerateRequest) => {
		calls.push(req.toolName);
		requests.push(req);
		const failure = opts.fail?.(req.toolName, calls.filter((c) => c === req.toolName).length);
		if (failure) throw new Error(failure);
		if (opts.gate) {
			await Promise.race([opts.gate, new Promise((_, reject) => req.signal?.addEventListener("abort", () => reject(new Error("aborted"))))]);
		}
		let value: unknown;
		if (req.toolName === "submit_units") value = { units: [{ title: "Nash", week: 2, from: 1, to: 2 }] };
		if (req.toolName === "submit_map") value = { nodes: [{ id: "best-response", label: "Best responses", slides: [1] }, { id: "nash", label: "Nash equilibrium", slides: [2] }], edges: [{ from: "best-response", to: "nash" }] };
		if (req.toolName === "submit_bank")
			value = { questions: [...Array.from({ length: 6 }, (_, i) => question(i + 1, "best-response")), ...Array.from({ length: 6 }, (_, i) => question(i + 7, "nash")), question(13, "nash", { stem: "x".repeat(260) })] };
		if (req.toolName === "submit_explainers")
			value = { explainers: [{ node: "nash", title: "Nash equilibrium", terms: ["best response"], body: "Everyone is best-responding.", diagram: "flowchart LR\n  a --> b", slides: [2], tryQuestionId: /- (\S+-q7) /.exec(req.user)?.[1] ?? "missing" }] };
		const problem = req.validate?.(value);
		if (problem) throw new Error(`invalid: ${problem}`);
		return { value: value as T, model: `fake/${req.slot}`, cost: 0.01, ms: 1 };
	};
	return { generate, calls, requests };
}

interface Seams {
	/** Is the AI connection up? (default: yes) */
	connected?: () => boolean;
	/** Every wait between tries lands here instead of a real timer. Return a promise to hold the pack there. */
	onSleep?: (ms: number) => Promise<void> | void;
	/** false: the AI isn't connected when the unit is saved, so no pack starts. */
	aiReady?: boolean;
}

async function setup(ai = fakeAi(), seams: Seams = {}) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "companion-packs-"));
	const store = new CompanionStore(dir);
	const content = new CompanionContent(store, CONTENT);
	const clock = new ManualClock(NOW);
	const sleeps: number[] = [];
	let n = 0;
	const svc = new CompanionService({
		store, content, clock,
		clockControl: { set: (t) => clock.set(t), reset: () => clock.set(NOW) },
		engines: { scripted: new ScriptedEngine((id) => content.scriptedSet(id)), learnharness: new ScriptedEngine((id) => content.scriptedSet(id)) },
		defaultEngine: "scripted",
		convertPdf: pdfToPages,
		generate: ai.generate,
		promptsDir: PROMPTS,
		newId: (p) => `${p}${++n}`,
		packSleep: async (ms, signal) => {
			sleeps.push(ms);
			await Promise.race([Promise.resolve(seams.onSleep?.(ms)), new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("cancelled"))))]);
		},
	});
	(svc.packs as unknown as { deps: { connected: () => Promise<boolean> } }).deps.connected = async () => seams.connected?.() ?? true;
	(svc as unknown as { aiReady: boolean }).aiReady = seams.aiReady ?? true;
	await svc.onboardFlow({ calendar: { kind: "none" }, modules: [{ code: "GT", name: "Game Theory" }] });
	const r = await svc.proposeMaterials("GT", [{ name: "GT_Week2_nash.pdf", bytes: pdf("Best responses", "Nash equilibrium") }]);
	const [unit] = svc.saveMaterials("GT", { uploadId: r.uploadId, units: r.files[0]!.units.map((u) => ({ file: 0, ...u })) }).units;
	/** Save one more weekly file as a unit of its own. */
	const addUnit = async (week: number) => {
		const p = await svc.proposeMaterials("GT", [{ name: `GT_Week${week}_more.pdf`, bytes: pdf(`Topic ${week}a`, `Topic ${week}b`) }]);
		return svc.saveMaterials("GT", { uploadId: p.uploadId, units: p.files[0]!.units.map((u) => ({ file: 0, ...u })) }).units[0]!.id;
	};
	return { svc, store, ai, sleeps, addUnit, id: unit!.id, events: () => store.events().map((e) => e.type) };
}

describe("study packs (F-105)", () => {
	it("saving a unit writes its pack: map, bank, explainers, with model, cost and dropped items", async () => {
		const { svc, ai, store, events, id } = await setup();
		await svc.packs!.idle();
		const p = svc.pack(id);
		assert.equal(p.meta?.state, "ready");
		assert.deepEqual(p.meta?.stages, { read: "done", map: "done", explainers: "done", bank: "done" });
		assert.deepEqual(ai.calls, ["submit_map", "submit_bank", "submit_check", "submit_explainers"], "bank before explainers: explainers end in a bank question; the small check follows the bank (v3.1)");
		assert.equal(p.questions, 12, "the 260-character stem was dropped");
		assert.deepEqual(p.meta?.dropped.map((d) => d.stage), ["bank"]);
		assert.equal(p.explainers.length, 1);
		assert.deepEqual(p.meta?.models, { map: "fake/strong", bank: "fake/cheap", explainers: "fake/strong" });
		assert.equal(Math.round((p.meta?.costUsd ?? 0) * 100), 4);
		assert.match(fs.readFileSync(path.join(store.materialsDir(id), "map.mmd"), "utf-8"), /best-response --> nash/);
		for (const e of ["pack_started", "pack_stage", "pack_ready"]) assert.ok(events().includes(e as never), e);
	});

	it("an explainer's diagram is saved with safe labels, and older packs are made safe when read (v1.0.1)", async () => {
		const ai = fakeAi();
		const { svc, store, id } = await setup(ai);
		await svc.packs!.idle();
		const file = path.join(store.materialsDir(id), "explainers.json");
		const saved = JSON.parse(fs.readFileSync(file, "utf-8")) as { diagram: string }[];
		// What the model wrote on 24 Nov, in a pack saved before the fix.
		fs.writeFileSync(file, JSON.stringify(saved.map((e) => ({ ...e, diagram: "flowchart LR\n B --> D[None: calculate d(A)]" }))));
		assert.equal(svc.pack(id).explainers[0]!.diagram, 'flowchart LR\n B --> D["None: calculate d(A)"]');
	});

	it("the concept map comes from the pack", async () => {
		const { svc, id } = await setup();
		await svc.packs!.idle();
		const map = svc.lectureMap(id);
		assert.deepEqual(map.nodes.map((n) => [n.id, n.slides]), [["best-response", [1]], ["nash", [2]]]);
	});

	it("the bank is the scripted engine's set: the no-AI fallback works on the student's own material", async () => {
		const { svc, id } = await setup();
		await svc.packs!.idle();
		const { sessionId } = svc.createSession(svc.parseSpec({ kind: "post-lecture", lectureId: id }), { engine: "scripted" });
		await svc.whenReady(sessionId);
		const v = await svc.view(sessionId);
		assert.equal(v.status, "question");
		assert.match(v.question!.stem, /Question \d+ about/);
	});

	it('"Quiz me on this idea" asks only about that node (F-106)', async () => {
		const { svc, id } = await setup();
		await svc.packs!.idle();
		const { sessionId } = svc.createSession(svc.parseSpec({ kind: "post-lecture", lectureId: id, nodes: ["nash"] }), { engine: "scripted" });
		await svc.whenReady(sessionId);
		for (let i = 0; i < 5; i++) {
			const v = await svc.view(sessionId);
			if (v.status !== "question") break;
			assert.match(v.question!.stem, /about nash/);
			await svc.answer(sessionId, { questionId: v.question!.id, indices: [1], confidence: 70 });
		}
	});

	it("a cancelled pack resumes from the first unfinished stage", async () => {
		let open!: () => void;
		const gate = new Promise<void>((r) => { open = r; });
		const ai = fakeAi({ gate });
		const { svc, id } = await setup(ai);
		await new Promise((r) => setTimeout(r, 20));
		svc.cancelPack(id);
		await svc.packs!.idle();
		assert.equal(svc.pack(id).meta?.state, "cancelled");
		open();
		ai.calls.length = 0;
		svc.regeneratePack(id, {});
		await svc.packs!.idle();
		assert.equal(svc.pack(id).meta?.state, "ready");
		assert.deepEqual(ai.calls, ["submit_map", "submit_bank", "submit_check", "submit_explainers"], "nothing was done before the cancel, so all stages ran");
		ai.calls.length = 0;
		svc.regeneratePack(id, {});
		await svc.packs!.idle();
		assert.deepEqual(ai.calls, [], "a finished pack resumes with nothing left to do");
		svc.regeneratePack(id, { fresh: true });
		await svc.packs!.idle();
		assert.deepEqual(ai.calls, ["submit_map", "submit_bank", "submit_check", "submit_explainers"], "fresh regenerates everything");
	});

	it("an authored map is kept (the demo lectures)", async () => {
		const { svc, ai } = await setup();
		await svc.packs!.idle();
		ai.calls.length = 0;
		await svc.onboardFlow({ calendar: { kind: "sample" } });
		svc.regeneratePack("hci-w3-personas", {});
		await svc.packs!.idle();
		assert.equal(svc.pack("hci-w3-personas").meta?.stages.map, "skipped");
		assert.ok(!ai.calls.includes("submit_map"));
	});
});

describe("a pack survives a bad minute (v1.0 T-4, V-23)", () => {
	const DELAYS = [...PACK_RULES.retryDelaysMs];

	it("a stage that fails once is tried again after a wait, and the pack is ready", async () => {
		const ai = fakeAi({ fail: (tool, nth) => (tool === "submit_bank" && nth === 1 ? "ChatGPT request failed. Check your connection and ChatGPT usage, then retry." : null) });
		let during: PackMeta | null = null;
		const s = await setup(ai, { onSleep: () => { during ??= s.svc.pack(s.id).meta; } });
		await s.svc.packs!.idle();
		assert.equal(s.svc.pack(s.id).meta?.state, "ready");
		assert.deepEqual(s.sleeps, [DELAYS[0]]);
		assert.deepEqual(ai.calls, ["submit_map", "submit_bank", "submit_bank", "submit_check", "submit_explainers"], "only the failed stage ran again");
		assert.equal(packStatusLine(during!), PACK_COPY.retrying(DELAYS[0]! / 1000), "the lecture page says it is trying again");
		assert.equal(s.svc.pack(s.id).meta?.waiting, undefined);
		assert.equal(s.events().filter((e) => e === "pack_retry").length, 1);
		assert.ok(!s.events().includes("pack_failed"));
	});

	it("after the last try it fails in plain words; the provider's own message stays in the log", async () => {
		const raw = "chatgpt catalog has no model gpt-6-sol";
		const s = await setup(fakeAi({ fail: (tool) => (tool === "submit_explainers" ? raw : null) }));
		await s.svc.packs!.idle();
		const meta = s.svc.pack(s.id).meta!;
		assert.deepEqual(s.sleeps, DELAYS, "tried again after each wait");
		assert.deepEqual([meta.state, meta.failure, meta.error], ["failed", "no_answer", PACK_COPY.failed(DELAYS.length + 1)]);
		assert.equal(packStatusLine(meta), `Your AI didn't answer after ${DELAYS.length + 1} tries.`);
		assert.deepEqual(meta.stages, { read: "done", map: "done", bank: "done", explainers: "failed" }, "the finished stages are kept for Try again");
		const failed = s.store.events().find((e) => e.type === "pack_failed")!;
		assert.deepEqual([failed.data.error, failed.data.tries], [raw, DELAYS.length + 1]);
	});

	it("while the AI connection is down the pack waits, and the packs behind it wait their turn instead of failing", async () => {
		let up = false;
		let release!: () => void;
		const held = new Promise<void>((r) => { release = r; });
		const ai = fakeAi({ fail: () => (up ? null : "ChatGPT request failed.") });
		const s = await setup(ai, { connected: () => up, onSleep: () => held });
		await new Promise((r) => setTimeout(r, 20));
		const second = await s.addUnit(3);
		const third = await s.addUnit(4);
		assert.equal(packStatusLine(s.svc.pack(s.id).meta!), PACK_COPY.waitingForConnection);
		assert.deepEqual([second, third].map((id) => packStatusLine(s.svc.pack(id).meta!)), [PACK_COPY.queued, PACK_COPY.queued]);
		assert.deepEqual(s.sleeps, [PACK_RULES.connectionCheckMs], "waiting for the connection, not using up tries");
		up = true;
		release();
		await s.svc.packs!.idle();
		assert.deepEqual([s.id, second, third].map((id) => s.svc.pack(id).meta?.state), ["ready", "ready", "ready"]);
		assert.ok(!s.events().includes("pack_failed"), "one dropped connection fails nothing");
		assert.deepEqual(s.store.events().filter((e) => e.type === "pack_retry").map((e) => e.data.reason), ["connection"]);
	});

	it("a pack waiting for the connection can still be cancelled", async () => {
		const s = await setup(fakeAi({ fail: () => "ChatGPT request failed." }), { connected: () => false, onSleep: () => new Promise<void>(() => {}) });
		await new Promise((r) => setTimeout(r, 20));
		s.svc.cancelPack(s.id);
		await s.svc.packs!.idle();
		assert.deepEqual([s.svc.pack(s.id).meta?.state, s.svc.pack(s.id).meta?.waiting], ["cancelled", undefined]);
	});

	it("after a restart, queued and interrupted packs are picked up, and uploaded units with no pack get one; failed and paused ones wait for the student", async () => {
		const s = await setup(fakeAi(), { aiReady: false });
		const ids = { never: s.id, queued: await s.addUnit(3), failed: await s.addUnit(4), paused: await s.addUnit(5), done: await s.addUnit(6) };
		assert.ok(!s.events().includes("pack_started"), "nothing starts while the AI isn't connected");
		const write = (id: string, state: PackMeta["state"]) =>
			fs.writeFileSync(path.join(s.store.materialsDir(id), "pack.json"), JSON.stringify({ lectureId: id, state, stages: { read: "done", map: "pending", bank: "pending", explainers: "pending" }, startedAt: NOW.toISOString(), models: {}, costUsd: null, ms: 0, dropped: [] }));
		write(ids.queued, "queued");
		write(ids.failed, "failed");
		write(ids.paused, "cancelled");
		write(ids.done, "ready");
		assert.equal(s.svc.pack(ids.queued).meta?.state, "cancelled", "until it is picked up, an interrupted pack reads as paused");
		const noteAiReady = (ready: boolean) => (s.svc as unknown as { noteAiReady: (r: boolean) => void }).noteAiReady(ready);
		noteAiReady(true);
		noteAiReady(true);
		await s.svc.packs!.idle();
		const started = s.store.events().filter((e) => e.type === "pack_started").map((e) => e.data.lectureId);
		assert.deepEqual(started.sort(), [ids.never, ids.queued].sort(), "once each, however often the AI reports ready");
		assert.deepEqual([ids.never, ids.queued, ids.failed, ids.paused, ids.done].map((id) => s.svc.pack(id).meta?.state), ["ready", "ready", "failed", "cancelled", "ready"]);
	});

	it("long notes are trimmed evenly, so the last pages still reach the model (T-3)", async () => {
		const s = await setup();
		await s.svc.packs!.idle();
		const notes = Array.from({ length: 20 }, (_, i) => `# Part ${i + 1}\n${`Sentence about part ${i + 1}. `.repeat(180)}`).join("\n\n");
		assert.ok(notes.length > PACK_RULES.slideTokenBudget * 4, "longer than the budget");
		const p = await s.svc.proposeMaterials("GT", [{ name: "GT_Week9_notes.md", bytes: new TextEncoder().encode(notes) }]);
		const [unit] = s.svc.saveMaterials("GT", { uploadId: p.uploadId, units: p.files[0]!.units.map((u) => ({ file: 0, ...u })) }).units;
		s.ai.requests.length = 0;
		await s.svc.packs!.idle();
		assert.equal(s.svc.pack(unit!.id).meta?.state, "ready");
		const sent = s.ai.requests.find((r) => r.toolName === "submit_map")!.user;
		assert.ok(sent.length <= PACK_RULES.slideTokenBudget * 4 + 200, "within the budget");
		assert.match(sent, /## Slide 20 — Part 20[\s\S]*Sentence about part 20\./, "the last page is there, with some of its text");
	});

	it("a unit with too little text says so, without asking the model (T-5, V-24)", async () => {
		const s = await setup();
		await s.svc.packs!.idle();
		// A unit saved before the rule: the words "Week 8" and nothing else.
		fs.writeFileSync(path.join(s.store.materialsDir(s.id), "slides.md"), "# Week 8\n\n## Slide 1 — Week 8\n\nWeek 8\n");
		s.ai.calls.length = 0;
		s.svc.regeneratePack(s.id, { fresh: true });
		await s.svc.packs!.idle();
		const meta = s.svc.pack(s.id).meta!;
		assert.deepEqual([meta.state, meta.failure, meta.error], ["failed", "too_short", PACK_COPY.tooShort]);
		assert.deepEqual(s.ai.calls, []);
		assert.deepEqual(s.sleeps, [], "trying again can't fix it, so it isn't retried");
	});
});

describe("the lecture page's line about a pack", () => {
	const meta = (over: Partial<PackMeta>): PackMeta => ({ lectureId: "u", state: "generating", stages: { read: "done", map: "running", bank: "pending", explainers: "pending" }, startedAt: "", models: {}, costUsd: null, ms: 0, dropped: [], ...over });
	const cases: Array<[string, Partial<PackMeta>, string | null]> = [
		["being written", {}, null],
		["queued behind another", { state: "queued" }, "Waiting its turn."],
		["between tries", { waiting: { for: "retry", seconds: 30, until: "" } }, "Your AI was busy. Trying again in 30 seconds."],
		["connection down", { waiting: { for: "connection" } }, "Waiting for your AI connection."],
		["failed", { state: "failed", error: PACK_COPY.failed(4) }, "Your AI didn't answer after 4 tries."],
		["too short", { state: "failed", error: PACK_COPY.tooShort }, "There's too little here to study from. Add more material."],
		["ready", { state: "ready" }, null],
		["paused", { state: "cancelled" }, null],
	];
	for (const [name, over, line] of cases) it(name, () => assert.equal(packStatusLine(meta(over)), line));
});

/**
 * v3.1 Part A: the questions are read back once by a small second call that
 * sees only the questions, duplicates go, a unit's round uses the student's
 * history, and "Rewrite questions" writes the questions again and nothing else.
 */
describe("Practise questions are checked, and rewritten only on request (v3.1)", () => {
	const applied = (i: number, node: string, over: Record<string, unknown> = {}) => question(i, node, { stem: `Case ${i}: payoffs are (${i}, ${i + 1}) and (${i + 2}, ${i}). What follows for ${node}?`, difficulty: 3, ...over });
	/** A stand-in AI whose bank and check answers a test sets. */
	const ai = (bank: () => unknown[], check?: (listed: string) => unknown) => {
		const base = fakeAi();
		const generate: Generate = async <T,>(req: GenerateRequest) => {
			if (req.toolName === "submit_bank") {
				base.calls.push(req.toolName);
				base.requests.push(req);
				const value = { questions: bank() };
				const problem = req.validate?.(value);
				if (problem) throw new Error(`invalid: ${problem}`);
				return { value: value as T, model: "fake/cheap", cost: 0.01, ms: 1 };
			}
			if (req.toolName === "submit_check" && check) {
				base.calls.push(req.toolName);
				base.requests.push(req);
				const value = check(req.user);
				if (value instanceof Error) throw value;
				return { value: value as T, model: "fake/cheap", cost: 0.001, ms: 1 };
			}
			return base.generate<T>(req);
		};
		return { ...base, generate };
	};
	const twelve = () => [...Array.from({ length: 6 }, (_, i) => applied(i + 1, "best-response")), ...Array.from({ length: 6 }, (_, i) => applied(i + 7, "nash"))];

	it("the second call is shown the questions and their options, and nothing of the slides or the marked answers", async () => {
		const a = ai(twelve, () => ({ verdicts: [] }));
		const { svc, id } = await setup(a);
		await svc.packs!.idle();
		const req = a.requests.find((r) => r.toolName === "submit_check")!;
		assert.equal(req.slot, "cheap");
		assert.match(req.user, /^QUESTIONS\n\n1\. Case 1: /);
		assert.match(req.user, /\n   A\. Right 1\n   B\. Wrong A 1\n   C\. Wrong B 1/);
		assert.doesNotMatch(req.user, /SLIDES|## Slide|Body of|correct|Because/);
		assert.equal(svc.pack(id).questions, 12);
	});

	it("a question it cannot answer as posed is dropped, and one it answers differently; both are recorded", async () => {
		const a = ai(twelve, () => ({ verdicts: [{ n: 2, answerable: false, answer: null }, { n: 5, answerable: true, answer: 2 }, { n: 1, answerable: true, answer: 0 }] }));
		const { svc, store, id } = await setup(a);
		await svc.packs!.idle();
		const p = svc.pack(id);
		assert.equal(p.questions, 10);
		assert.deepEqual(p.meta?.dropped.map((d) => d.reason), ["could not be answered as posed", "a second reading picked a different answer"]);
		const logged = store.events().find((e) => e.type === "pack_checked")!;
		assert.deepEqual([logged.data.asked, logged.data.unanswerable, logged.data.disagreed], [12, 1, 1]);
	});

	it("if the second call fails, the questions that passed the rules are kept and nothing is written again", async () => {
		const a = ai(twelve, () => new Error("ChatGPT request failed."));
		const { svc, id, events } = await setup(a);
		await svc.packs!.idle();
		assert.equal(svc.pack(id).meta?.state, "ready");
		assert.equal(svc.pack(id).questions, 12);
		assert.equal(a.calls.filter((c) => c === "submit_bank").length, 1);
		assert.ok(events().includes("pack_check_skipped" as never));
	});

	it("two questions that ask the same thing: the later one is dropped", async () => {
		const a = ai(() => [...twelve(), applied(1, "best-response", { options: ["Other right", "Other wrong", "Other wrong 2"] })], () => ({ verdicts: [] }));
		const { svc, id } = await setup(a);
		await svc.packs!.idle();
		assert.equal(svc.pack(id).questions, 12);
		assert.deepEqual(svc.pack(id).meta?.dropped.map((d) => d.reason), ["asks the same thing as another question"]);
	});

	it("a question that points at the lecture is sent back to be rewritten, with the reason", async () => {
		let n = 0;
		const a = ai(() => (++n === 1 ? [...twelve().slice(0, 11), applied(12, "nash", { stem: "In the lecture's example, which strategy is a best response?" })] : twelve()), () => ({ verdicts: [] }));
		await assert.rejects(a.generate({ slot: "cheap", system: "", user: "", toolName: "submit_bank", toolDescription: "", schema: {}, validate: (v) => {
			const qs = (v as { questions: { stem: string }[] }).questions;
			return qs.some((x) => /lecture/.test(x.stem)) ? "fix these questions: #12: \"the lecture's\" points outside the question" : null;
		} }), /points outside the question/);
	});

	it("a unit's \"Practise this\" does not ask the same questions every time", async () => {
		const { svc, id } = await setup(ai(twelve, () => ({ verdicts: [] })));
		await svc.packs!.idle();
		const round = async () => {
			const { sessionId } = svc.createSession(svc.parseSpec({ kind: "post-lecture", lectureId: id, study: "practise" }));
			await svc.whenReady(sessionId);
			const asked: string[] = [];
			for (let i = 0; i < 5; i++) {
				const v = await svc.view(sessionId);
				if (v.status !== "question" || !v.question) break;
				asked.push(v.question.id);
				await svc.answer(sessionId, { questionId: v.question.id, indices: [v.question.options[0]!.index], confidence: 70 });
				const after = await svc.view(sessionId);
				if (after.status === "question" && after.question?.id === v.question.id) break;
			}
			return asked;
		};
		const first = await round();
		const second = await round();
		assert.equal(first.length, 5);
		assert.equal(second.length, 5);
		assert.equal(second.filter((q) => first.includes(q)).length, 0, "twelve questions: the second round is five the first did not ask");
		assert.equal(new Set([...first, ...second].map((q) => q.split("-q")[0])).size, 1);
	});

	it("\"Rewrite questions\" writes each unit's questions again and keeps its map and explainers", async () => {
		let version = 1;
		const a = ai(() => twelve().map((x) => ({ ...x, stem: `${x.stem.replace("?", "")} (v${version})?` })), () => ({ verdicts: [] }));
		const { svc, store, id } = await setup(a);
		await svc.packs!.idle();
		const before = svc.pack(id);
		assert.deepEqual([before.meta?.state, before.meta?.stages, before.explainers.length, before.meta?.dropped], ["ready", { read: "done", map: "done", explainers: "done", bank: "done" }, 1, []]);
		const oldIds = (JSON.parse(fs.readFileSync(path.join(store.materialsDir(id), "bank.json"), "utf-8")) as { id: string }[]).map((x) => x.id);
		a.calls.length = 0;
		version = 2;
		assert.deepEqual(svc.rewriteQuestions("GT"), { units: 1 });
		await svc.packs!.idle();
		assert.deepEqual(a.calls, ["submit_bank", "submit_check"], "no map and no explainers: those are the dear stages");
		const after = svc.pack(id);
		assert.equal(after.meta?.state, "ready");
		assert.equal(after.questions, 12);
		const bank = JSON.parse(fs.readFileSync(path.join(store.materialsDir(id), "bank.json"), "utf-8")) as { id: string; stem: string; node: string }[];
		assert.ok(bank.every((x) => /\(v2\)\?$/.test(x.stem)));
		assert.equal(bank.filter((x) => oldIds.includes(x.id)).length, 0, "new questions get new ids: an old id never comes to mean a different question");
		assert.equal(after.explainers.length, before.explainers.length);
		assert.ok(bank.some((x) => x.id === after.explainers[0]!.tryQuestionId && x.node === after.explainers[0]!.node), "the explainer ends on a question that exists, on its own idea");
		assert.ok(store.events().some((e) => e.type === "questions_rewrite" && e.data.units === 1));
	});

	it("a notification's question is one short enough to read on a lock screen, when the unit has one", async () => {
		const long = "A firm sets a price above marginal cost and a rival can undercut it by a penny and take the whole market. What does each firm's best response lead to?";
		const a = ai(() => [applied(1, "best-response", { stem: long }), ...twelve().slice(1)], () => ({ verdicts: [] }));
		const { svc, id } = await setup(a);
		await svc.packs!.idle();
		assert.ok(long.length > PHONE_RULES.notifyStemMax);
		const first = svc.questionFor(id)!;
		assert.match(first.stem, /^Case 2: /, "the long one is first in the unit, and is passed over");
		// With only long ones left unused, a long one is still better than none.
		const used = new Set((JSON.parse(fs.readFileSync(path.join(svc.packs!["deps"].dir(id), "bank.json"), "utf-8")) as { id: string; stem: string }[]).filter((x) => x.stem !== long).map((x) => x.id));
		assert.equal(svc.questionFor(id, used)!.stem, long);
	});

	it("with nothing to rewrite, or no AI, it says so and starts nothing", async () => {
		const { svc } = await setup(ai(twelve), { aiReady: false });
		assert.throws(() => svc.rewriteQuestions("GT"), /Connect your AI/);
		const s = await setup(ai(twelve, () => ({ verdicts: [] })));
		await s.svc.packs!.idle();
		assert.throws(() => s.svc.rewriteQuestions("NOPE"), /module/i);
	});
});
