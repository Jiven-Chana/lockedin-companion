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
import type { SlidePage } from "../src/core/companion/index.ts";
import { ManualClock } from "../src/server/companion/clock.ts";
import { CompanionContent } from "../src/server/companion/content.ts";
import { ScriptedEngine } from "../src/server/companion/engines/scripted.ts";
import type { Generate, GenerateRequest } from "../src/server/companion/generate.ts";
import { CompanionService } from "../src/server/companion/service.ts";
import { CompanionStore } from "../src/server/companion/store.ts";

const CONTENT = path.join(import.meta.dirname, "..", "companion", "content");
const PROMPTS = path.join(import.meta.dirname, "..", "companion", "prompts");
const NOW = new Date(2026, 10, 23, 12);
const pdf = (...titles: string[]) => new Uint8Array([0x25, 0x50, 0x44, 0x46, ...new TextEncoder().encode(titles.join("|"))]);
const pdfToPages = async (data: Uint8Array): Promise<SlidePage[]> =>
	new TextDecoder().decode(data.slice(4)).split("|").map((t, i) => ({ number: i + 1, kind: "text" as const, markdown: `# ${t}\nBody of ${t}.` }));

const question = (i: number, node: string, over: Record<string, unknown> = {}) => ({
	stem: `Question ${i} about ${node}?`, options: [`Right ${i}`, `Wrong A ${i}`, `Wrong B ${i}`], correct: 0, explanation: `Because ${node}.`, slides: [node === "best-response" ? 1 : 2], node, difficulty: 1, ...over,
});

/** A fake AI that answers each pack stage, optionally waiting on a gate (for cancel). */
function fakeAi(opts: { gate?: Promise<void> } = {}) {
	const calls: string[] = [];
	const generate: Generate = async <T,>(req: GenerateRequest) => {
		calls.push(req.toolName);
		if (opts.gate) {
			await Promise.race([opts.gate, new Promise((_, reject) => req.signal?.addEventListener("abort", () => reject(new Error("aborted"))))]);
		}
		let value: unknown;
		if (req.toolName === "submit_units") value = { units: [{ title: "Nash", week: 2, from: 1, to: 2 }] };
		if (req.toolName === "submit_map") value = { nodes: [{ id: "best-response", label: "Best responses", slides: [1] }, { id: "nash", label: "Nash equilibrium", slides: [2] }], edges: [{ from: "best-response", to: "nash" }] };
		if (req.toolName === "submit_bank")
			value = { questions: [...Array.from({ length: 6 }, (_, i) => question(i + 1, "best-response")), ...Array.from({ length: 6 }, (_, i) => question(i + 7, "nash")), question(13, "nash", { stem: "x".repeat(120) })] };
		if (req.toolName === "submit_explainers")
			value = { explainers: [{ node: "nash", title: "Nash equilibrium", terms: ["best response"], body: "Everyone is best-responding.", diagram: "flowchart LR\n  a --> b", slides: [2], tryQuestionId: /- (\S+-q7) /.exec(req.user)?.[1] ?? "missing" }] };
		const problem = req.validate?.(value);
		if (problem) throw new Error(`invalid: ${problem}`);
		return { value: value as T, model: `fake/${req.slot}`, cost: 0.01, ms: 1 };
	};
	return { generate, calls };
}

async function setup(ai = fakeAi()) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "companion-packs-"));
	const store = new CompanionStore(dir);
	const content = new CompanionContent(store, CONTENT);
	const clock = new ManualClock(NOW);
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
	});
	(svc as unknown as { aiReady: boolean }).aiReady = true;
	await svc.onboardFlow({ calendar: { kind: "none" }, modules: [{ code: "GT", name: "Game Theory" }] });
	const r = await svc.proposeMaterials("GT", [{ name: "GT_Week2_nash.pdf", bytes: pdf("Best responses", "Nash equilibrium") }]);
	const [unit] = svc.saveMaterials("GT", { uploadId: r.uploadId, units: r.files[0]!.units.map((u) => ({ file: 0, ...u })) }).units;
	return { svc, store, ai, id: unit!.id, events: () => store.events().map((e) => e.type) };
}

describe("study packs (F-105)", () => {
	it("saving a unit writes its pack: map, bank, explainers, with model, cost and dropped items", async () => {
		const { svc, ai, store, events, id } = await setup();
		await svc.packs!.idle();
		const p = svc.pack(id);
		assert.equal(p.meta?.state, "ready");
		assert.deepEqual(p.meta?.stages, { read: "done", map: "done", explainers: "done", bank: "done" });
		assert.deepEqual(ai.calls, ["submit_map", "submit_bank", "submit_explainers"], "bank before explainers: explainers end in a bank question");
		assert.equal(p.questions, 12, "the 120-character stem was dropped");
		assert.deepEqual(p.meta?.dropped.map((d) => d.stage), ["bank"]);
		assert.equal(p.explainers.length, 1);
		assert.deepEqual(p.meta?.models, { map: "fake/strong", bank: "fake/cheap", explainers: "fake/strong" });
		assert.equal(Math.round((p.meta?.costUsd ?? 0) * 100), 3);
		assert.match(fs.readFileSync(path.join(store.materialsDir(id), "map.mmd"), "utf-8"), /best-response --> nash/);
		for (const e of ["pack_started", "pack_stage", "pack_ready"]) assert.ok(events().includes(e as never), e);
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
		assert.deepEqual(ai.calls, ["submit_map", "submit_bank", "submit_explainers"], "nothing was done before the cancel, so all stages ran");
		ai.calls.length = 0;
		svc.regeneratePack(id, {});
		await svc.packs!.idle();
		assert.deepEqual(ai.calls, [], "a finished pack resumes with nothing left to do");
		svc.regeneratePack(id, { fresh: true });
		await svc.packs!.idle();
		assert.deepEqual(ai.calls, ["submit_map", "submit_bank", "submit_explainers"], "fresh regenerates everything");
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
