/**
 * The study-pack job (v0.1 F-105): per course unit, read its slides, then
 * write the concept map, the question bank and the explainers through
 * generate() on the student's slots (PACK_RULES.slots, O-13).
 *
 * Each stage is saved as it finishes (map.mmd, bank.json, explainers.json,
 * with progress in pack.json), so a cancelled or crashed pack resumes from
 * the first unfinished stage. A call's output is checked item by item:
 * the model retries within the call while too few items pass, and items
 * that still fail are dropped and logged (spec F-105).
 *
 * Packs run one at a time. A stage that fails is tried again after a wait
 * (PACK_RULES.retryDelaysMs). While the student's AI connection is down the
 * pack waits instead, without using up a try, so one bad minute no longer
 * fails every pack queued behind it (v1.0 T-4, V-23).
 */

import fs from "node:fs";
import path from "node:path";
import { splitNodeLabel } from "../../core/companion/concept-map.ts";
import { safeMermaid } from "../../core/companion/diagram.ts";
import { GAP_RULES, MATERIALS_RULES, PACK_COPY, PACK_RULES } from "../../core/companion/policy.ts";
import { parseSlides, trimSlides } from "../../core/companion/slides.ts";
import {
	type ColdVerdict,
	retargetExplainers,
	dedupeQuestions,
	applyColdCheck,
	checkExplainer,
	stripQuestionIds,
	checkMapNodes,
	assignQuestionIds,
	checkQuestion,
	nextGapId,
	newPackMeta,
	stemKey,
	type BankQuestion,
	type Explainer,
	type PackMeta,
	type PackNode,
	type PackStage,
} from "../../core/companion/study-pack.ts";
import { parseMermaidPlan } from "../../agent/tools/mermaid-plan.ts";
import type { Generate, GenerateResult } from "./generate.ts";

export interface StudyPackDeps {
	/** The unit's folder: materials/<lectureId>/ in the data directory. */
	dir: (lectureId: string) => string;
	slidesMarkdown: (lectureId: string) => string | null;
	/** An existing map (authored for the demo content, or saved before). */
	mapSource: (lectureId: string) => string | null;
	generate: Generate;
	promptsDir: string;
	log: (type: "pack_started" | "pack_stage" | "pack_retry" | "pack_ready" | "pack_failed" | "pack_checked" | "pack_check_skipped" | "gap_questions_written", data: Record<string, unknown>) => void;
	now: () => Date;
	/** Is the student's AI reachable right now? After a failed try this decides between waiting for it and trying again. Default: yes. */
	connected?: () => Promise<boolean>;
	/** Test seam: the waits between tries. Rejects when the pack is cancelled. */
	sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

/** A failure that trying again can't fix (nothing to read, too little to study from). */
class PackStop extends Error {
	constructor(readonly failure: NonNullable<PackMeta["failure"]>, readonly says: string) {
		super(says);
	}
}

const realSleep = (ms: number, signal: AbortSignal) =>
	new Promise<void>((resolve, reject) => {
		if (signal.aborted) return reject(new Error("cancelled"));
		const done = () => {
			signal.removeEventListener("abort", stop);
			resolve();
		};
		const timer = setTimeout(done, ms);
		const stop = () => {
			clearTimeout(timer);
			reject(new Error("cancelled"));
		};
		signal.addEventListener("abort", stop, { once: true });
	});

/** The schema for questions written around a gap: the bank's question, up to `n` of them. */
const gapSchema = (n: number) => ({ ...BANK_SCHEMA, properties: { questions: { ...BANK_SCHEMA.properties.questions, minItems: 1, maxItems: n } } });

const read = <T>(file: string): T | null => {
	try {
		return JSON.parse(fs.readFileSync(/* turbopackIgnore: true */ file, "utf-8")) as T;
	} catch {
		return null;
	}
};

const MAP_SCHEMA = {
	type: "object", additionalProperties: false, required: ["nodes", "edges"],
	properties: {
		nodes: { type: "array", minItems: 2, maxItems: PACK_RULES.maxNodes, items: { type: "object", additionalProperties: false, required: ["id", "label", "slides"], properties: { id: { type: "string" }, label: { type: "string" }, slides: { type: "array", items: { type: "integer" } } } } },
		edges: { type: "array", items: { type: "object", additionalProperties: false, required: ["from", "to"], properties: { from: { type: "string" }, to: { type: "string" } } } },
	},
};
const BANK_SCHEMA = {
	type: "object", additionalProperties: false, required: ["questions"],
	properties: {
		questions: {
			type: "array", minItems: PACK_RULES.bankMin, maxItems: PACK_RULES.bankMax,
			items: {
				type: "object", additionalProperties: false, required: ["stem", "options", "correct", "explanation", "slides", "node", "difficulty"],
				properties: {
					stem: { type: "string" }, options: { type: "array", minItems: 3, maxItems: 3, items: { type: "string" } }, correct: { type: "integer", minimum: 0, maximum: 2 },
					explanation: { type: "string" }, slides: { type: "array", items: { type: "integer" } }, node: { type: "string" }, difficulty: { type: "integer", minimum: 1, maximum: 3 },
				},
			},
		},
	},
};
const CHECK_SCHEMA = {
	type: "object", additionalProperties: false, required: ["verdicts"],
	properties: {
		verdicts: {
			type: "array",
			items: { type: "object", additionalProperties: false, required: ["n", "answerable", "answer"], properties: { n: { type: "integer" }, answerable: { type: "boolean" }, answer: { type: ["integer", "null"] } } },
		},
	},
};
const EXPLAINER_SCHEMA = {
	type: "object", additionalProperties: false, required: ["explainers"],
	properties: {
		explainers: {
			type: "array", minItems: 1, maxItems: PACK_RULES.maxExplainers,
			items: {
				type: "object", additionalProperties: false, required: ["node", "title", "terms", "body", "diagram", "slides", "tryQuestionId"],
				properties: {
					node: { type: "string" }, title: { type: "string" }, terms: { type: "array", items: { type: "string" } }, body: { type: "string" },
					diagram: { type: "string" }, slides: { type: "array", items: { type: "integer" } }, tryQuestionId: { type: "string" },
				},
			},
		},
	},
};

/** The map as mermaid; each label carries its slides so the concept map can open them. */
export function mapToSource(nodes: readonly PackNode[], edges: readonly { from: string; to: string }[]): string {
	const ids = new Set(nodes.map((n) => n.id));
	// The authored maps' label format ("Title · S3, S5"), which splitNodeLabel reads back.
	const label = (n: PackNode) => `${n.title.replace(/["[\]·]/g, "")} · S${n.slides.join(", S")}`;
	return ["graph TD", ...nodes.map((n) => `  ${n.id}["${label(n)}"]`), ...edges.filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to).map((e) => `  ${e.from} --> ${e.to}`), ""].join("\n");
}

export class StudyPacks {
	private readonly running = new Map<string, AbortController>();
	private queue: Promise<void> = Promise.resolve();

	constructor(private readonly deps: StudyPackDeps) {}

	private file(lectureId: string, name: string) {
		return path.join(/* turbopackIgnore: true */ this.deps.dir(lectureId), name);
	}

	status(lectureId: string): PackMeta | null {
		const meta = read<PackMeta>(this.file(lectureId, "pack.json"));
		// A pack marked queued or generating with no job behind it was interrupted (a restart): report it as resumable.
		if (meta && this.interrupted(lectureId, meta)) return { ...meta, state: "cancelled", waiting: undefined };
		return meta;
	}

	/** Queued or being written when the app last stopped, and not picked up again yet. */
	interrupted(lectureId: string, meta: PackMeta | null = read<PackMeta>(this.file(lectureId, "pack.json"))): boolean {
		return !!meta && (meta.state === "generating" || meta.state === "queued") && !this.running.has(lectureId);
	}

	/** Has a pack ever been asked for here (whatever became of it)? */
	exists(lectureId: string): boolean {
		return read<PackMeta>(this.file(lectureId, "pack.json")) !== null;
	}
	bank(lectureId: string): BankQuestion[] | null {
		return read<BankQuestion[]>(this.file(lectureId, "bank.json"));
	}
	explainers(lectureId: string): Explainer[] | null {
		const list = read<Explainer[]>(this.file(lectureId, "explainers.json"));
		if (!list) return null;
		// Packs written before the dry-run fix may still name question ids in the text.
		const ids = (this.bank(lectureId) ?? []).map((q) => q.id);
		// …and their diagrams were saved as the model wrote them: make the labels safe on the way out (v1.0.1).
		return list.map((e) => ({ ...e, body: stripQuestionIds(e.body, ids), diagram: safeMermaid(e.diagram ?? "") }));
	}
	isRunning(lectureId: string) {
		return this.running.has(lectureId);
	}

	private save(meta: PackMeta) {
		fs.mkdirSync(/* turbopackIgnore: true */ this.deps.dir(meta.lectureId), { recursive: true });
		fs.writeFileSync(/* turbopackIgnore: true */ this.file(meta.lectureId, "pack.json"), JSON.stringify(meta, null, "\t"));
	}

	/**
	 * Queue a pack (one at a time, so a whole semester doesn't fire a burst of calls). `fresh` regenerates every stage.
	 * `bank` writes only the questions again (v3.1): the map and the explainers, which are the dear stages, are kept.
	 */
	start(lectureId: string, opts: { fresh?: boolean; bank?: boolean } = {}): PackMeta {
		if (this.running.has(lectureId)) return this.status(lectureId)!;
		const prev = this.status(lectureId);
		const meta = newPackMeta(lectureId, this.deps.now().toISOString());
		if (prev && !opts.fresh) for (const s of Object.keys(meta.stages) as PackStage[]) if (prev.stages[s] === "done" || prev.stages[s] === "skipped") meta.stages[s] = prev.stages[s];
		if (opts.bank && !opts.fresh && meta.stages.map === "done" && fs.existsSync(/* turbopackIgnore: true */ this.file(lectureId, "bank.json"))) {
			// The old questions are kept aside until the new ones are written, so one the student has met keeps its id if it is written again.
			meta.stages.bank = "pending";
			if (prev?.lastQuestionNumber !== undefined) meta.lastQuestionNumber = prev.lastQuestionNumber;
			fs.renameSync(/* turbopackIgnore: true */ this.file(lectureId, "bank.json"), /* turbopackIgnore: true */ this.file(lectureId, "bank.prev.json"));
		}
		if (opts.fresh) {
			// The old bank is kept aside until the new one is written, so questions the student has met keep their ids.
			if (fs.existsSync(/* turbopackIgnore: true */ this.file(lectureId, "bank.json"))) fs.renameSync(/* turbopackIgnore: true */ this.file(lectureId, "bank.json"), /* turbopackIgnore: true */ this.file(lectureId, "bank.prev.json"));
			fs.rmSync(/* turbopackIgnore: true */ this.file(lectureId, "explainers.json"), { force: true });
		}
		// Packs run one at a time: behind another one, this pack waits its turn.
		if (this.running.size > 0) meta.state = "queued";
		const controller = new AbortController();
		this.running.set(lectureId, controller);
		this.save(meta);
		this.deps.log("pack_started", { lectureId, resumed: !!prev && !opts.fresh });
		this.queue = this.queue.then(() => this.run(meta, controller.signal, !!opts.fresh)).catch(() => undefined);
		return meta;
	}

	/** Resolves when every queued pack has settled (tests, the tracer). */
	idle(): Promise<void> {
		return this.queue;
	}

	cancel(lectureId: string): PackMeta | null {
		this.running.get(lectureId)?.abort();
		return this.status(lectureId);
	}

	/**
	 * "Practise this idea" (V-39): the AI writes `n` new questions on one idea,
	 * around what the student got wrong on it. They are checked like any bank
	 * question, must not repeat a question the idea already has, and are added
	 * to the unit's bank marked `origin: "gap"`, so Practise can use them again.
	 * Returns the questions written; throws when none are usable.
	 */
	async writeForIdea(
		lectureId: string,
		node: string,
		misses: readonly { stem: string; chosen: string[]; correct: string[]; reason: string; confidence?: number; why?: string }[],
		n: number,
		signal?: AbortSignal,
	): Promise<BankQuestion[]> {
		const md = this.deps.slidesMarkdown(lectureId);
		const parsed = parseMermaidPlan(this.deps.mapSource(lectureId) ?? "");
		const nodes = parsed.ok && parsed.plan ? parsed.plan.nodes.map((x) => ({ id: x.id, ...splitNodeLabel(x.title || x.id) })) : [];
		const idea = nodes.find((x) => x.id === node);
		if (!md || !idea) throw new Error("this idea has no slides or is not on the unit's map");
		const bank = this.bank(lectureId) ?? [];
		const ctx = { slides: new Set(parseSlides(md).map((s) => s.number)), nodes: new Set([node]) };
		const existing = new Set(bank.map((q) => stemKey(q.stem)));
		const usableOf = (qs: Omit<BankQuestion, "id">[]) => {
			const seen = new Set(existing);
			return qs.filter((q) => {
				if (checkQuestion({ ...q, id: "q" } as BankQuestion, ctx) || seen.has(stemKey(q.stem))) return false;
				seen.add(stemKey(q.stem));
				return true;
			});
		};
		const missText = misses.map((m, i) => [
			`${i + 1}. "${m.stem}"`,
			`   Right answer: ${m.correct.join("; ")}`,
			m.reason === "dont-know" ? "   They said they didn't know." : m.reason === "low-confidence" ? "   They got it right but were unsure." : `   They chose: ${m.chosen.join("; ") || "(not recorded)"}`,
			...(m.confidence !== undefined ? [`   How sure they were: ${m.confidence}%`] : []),
			...(m.why ? [`   Their reason: "${m.why.slice(0, 300)}"`] : []),
		].join("\n")).join("\n");
		const onIdea = bank.filter((q) => q.node === node).map((q) => `- ${q.stem}`).join("\n") || "(none)";
		const r = await this.deps.generate<{ questions: Omit<BankQuestion, "id">[] }>({
			slot: PACK_RULES.slots.bank,
			system: this.prompt("gap-questions.md"),
			user: `IDEA\n${idea.id}: ${idea.title} (Slides ${idea.slides.join(", ")})\n\nWRITE ${n} QUESTIONS\n\nWHAT THEY GOT WRONG\n${missText || "(nothing recorded)"}\n\nQUESTIONS THAT ALREADY EXIST ON THIS IDEA\n${onIdea}\n\nSLIDES\n${trimSlides(md, PACK_RULES.slideTokenBudget).markdown}`,
			toolName: "submit_questions", toolDescription: "Submit the new questions.", schema: gapSchema(n), ...(signal ? { signal } : {}),
			validate: (v) => {
				const qs = (v as { questions: Omit<BankQuestion, "id">[] }).questions;
				if (usableOf(qs).length >= Math.min(n, GAP_RULES.minUsable)) return null;
				const problems = qs.map((q, i) => [i, checkQuestion({ ...q, id: "q" } as BankQuestion, ctx) ?? (existing.has(stemKey(q.stem)) ? "this repeats an existing question" : null)] as const).filter(([, p]) => p);
				return `fix these questions: ${problems.slice(0, 5).map(([i, p]) => `#${i + 1}: ${p}`).join("; ")}`;
			},
		});
		const usable = usableOf(r.value.questions).slice(0, n);
		if (usable.length === 0) throw new Error("no usable questions");
		const at = this.deps.now().toISOString();
		const written = usable.map((q, i) => ({ ...q, id: nextGapId(lectureId, bank, i), origin: "gap", writtenAt: at }) as BankQuestion);
		fs.writeFileSync(/* turbopackIgnore: true */ this.file(lectureId, "bank.json"), JSON.stringify([...bank, ...written], null, "\t"));
		this.deps.log("gap_questions_written", { lectureId, node, asked: n, written: written.length, misses: misses.length, model: r.model });
		return written;
	}

	private prompt(name: string) {
		return fs.readFileSync(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ this.deps.promptsDir, name), "utf-8");
	}

	private async run(meta: PackMeta, signal: AbortSignal, fresh: boolean) {
		const started = Date.now();
		const id = meta.lectureId;
		const spend = (r: GenerateResult<unknown>, stage: PackStage) => {
			meta.models[stage] = r.model;
			if (r.cost !== null) meta.costUsd = (meta.costUsd ?? 0) + r.cost;
		};
		const sleep = this.deps.sleep ?? realSleep;
		const connected = async () => (this.deps.connected ? this.deps.connected().catch(() => false) : true);
		const delays = PACK_RULES.retryDelaysMs;
		const stage = async (s: PackStage, fn: () => Promise<"done" | "skipped">) => {
			if (meta.stages[s] === "done" || meta.stages[s] === "skipped") return;
			for (let retries = 0; ; ) {
				if (signal.aborted) throw new Error("cancelled");
				meta.stages[s] = "running";
				meta.waiting = undefined;
				this.save(meta);
				try {
					meta.stages[s] = await fn();
					break;
				} catch (err) {
					if (signal.aborted || err instanceof PackStop) throw err;
					const error = err instanceof Error ? err.message : String(err);
					meta.stages[s] = "pending";
					if (!(await connected())) {
						// The AI connection is down: wait for it. That isn't a try, and the packs queued behind this one wait too.
						meta.waiting = { for: "connection" };
						this.save(meta);
						this.deps.log("pack_retry", { lectureId: id, stage: s, reason: "connection", error });
						do await sleep(PACK_RULES.connectionCheckMs, signal);
						while (!(await connected()));
						continue;
					}
					if (retries >= delays.length) {
						meta.stages[s] = "failed";
						throw new Error(error);
					}
					const ms = delays[retries++]!;
					meta.waiting = { for: "retry", seconds: Math.round(ms / 1000), until: new Date(this.deps.now().getTime() + ms).toISOString() };
					this.save(meta);
					this.deps.log("pack_retry", { lectureId: id, stage: s, reason: "error", attempt: retries, waitMs: ms, error });
					await sleep(ms, signal);
				}
			}
			this.save(meta);
			this.deps.log("pack_stage", { lectureId: id, stage: s, state: meta.stages[s] });
		};
		try {
			if (meta.state !== "generating") {
				meta.state = "generating";
				this.save(meta);
			}
			// 1. Read
			const md = this.deps.slidesMarkdown(id);
			if (!md) throw new PackStop("no_material", PACK_COPY.noMaterial);
			const slides = parseSlides(md);
			if (slides.length === 0) throw new PackStop("no_material", PACK_COPY.noMaterial);
			// Too little to make two ideas and twelve questions from (V-24): say so instead of asking the model.
			if (slides.reduce((n, sl) => n + sl.body.length, 0) < MATERIALS_RULES.minUnitChars) throw new PackStop("too_short", PACK_COPY.tooShort);
			const slideSet = new Set(slides.map((s) => s.number));
			// Long notes are trimmed evenly across their pages, never cut off at the end: the
			// validators accept a citation to every slide, so every slide must be in the text (v1.0 T-3).
			const slidesText = trimSlides(md, PACK_RULES.slideTokenBudget).markdown;
			await stage("read", async () => "done");

			// 2. Map (an authored or saved map is kept unless regenerating)
			let nodes: PackNode[] = [];
			const readMap = () => {
				const parsed = parseMermaidPlan(this.deps.mapSource(id) ?? "");
				return parsed.ok && parsed.plan ? parsed.plan.nodes.map((n) => ({ id: n.id, ...splitNodeLabel(n.title || n.id) })) : [];
			};
			await stage("map", async () => {
				if (!fresh && this.deps.mapSource(id)) return "skipped";
				const r = await this.deps.generate<{ nodes: { id: string; label: string; slides: number[] }[]; edges: { from: string; to: string }[] }>({
					slot: PACK_RULES.slots.map, system: this.prompt("map.md"), user: `SLIDES\n${slidesText}`, toolName: "submit_map", toolDescription: "Submit the unit's concept map.", schema: MAP_SCHEMA, signal,
					validate: (v) => checkMapNodes((v as { nodes: { id: string; label: string; slides: number[] }[] }).nodes.map((n) => ({ id: n.id, title: n.label, slides: n.slides })), slideSet),
				});
				spend(r, "map");
				const source = mapToSource(r.value.nodes.map((n) => ({ id: n.id, title: n.label, slides: n.slides })), r.value.edges);
				if (!parseMermaidPlan(source).ok) throw new Error("the map couldn't be parsed");
				fs.writeFileSync(/* turbopackIgnore: true */ this.file(id, "map.mmd"), source);
				return "done";
			});
			nodes = readMap();
			const nodeSet = new Set(nodes.map((n) => n.id));
			const mapText = nodes.map((n) => `- ${n.id}: ${n.title} (Slides ${n.slides.join(", ")})`).join("\n");

			// 3. Bank
			await stage("bank", async () => {
				const ctx = { slides: slideSet, nodes: nodeSet };
				const r = await this.deps.generate<{ questions: Omit<BankQuestion, "id">[] }>({
					slot: PACK_RULES.slots.bank, system: this.prompt("bank.md"), user: `CONCEPT MAP\n${mapText}\n\nSLIDES\n${slidesText}`, toolName: "submit_bank", toolDescription: "Submit the question bank.", schema: BANK_SCHEMA, signal,
					validate: (v) => {
						const qs = (v as { questions: Omit<BankQuestion, "id">[] }).questions;
						const bad = qs.map((q, i) => [i, checkQuestion({ ...q, id: `q${i}` } as BankQuestion, ctx)] as const).filter(([, p]) => p);
						return qs.length - bad.length >= PACK_RULES.bankMin ? null : `fix these questions: ${bad.slice(0, 6).map(([i, p]) => `#${i + 1}: ${p}`).join("; ")}`;
					},
				});
				spend(r, "bank");
				const passed: Omit<BankQuestion, "id">[] = [];
				r.value.questions.forEach((q, i) => {
					const problem = checkQuestion({ ...q, id: `q${i + 1}` } as BankQuestion, ctx);
					if (problem) meta.dropped.push({ stage: "bank", id: `${id}-#${i + 1}`, reason: problem });
					else passed.push(q);
				});
				// v3.1: no two questions that ask the same thing…
				const unique = dedupeQuestions(passed);
				for (const d of unique.dropped) meta.dropped.push({ stage: "bank", id: `${id}-#dup${d.index + 1}`, reason: "asks the same thing as another question" });
				// …and one small second call that sees only the questions, never the slides: what it cannot answer as posed does not stand on its own.
				let usable = unique.kept;
				if (usable.length > 0) {
					try {
						const listed = usable.map((q, i) => `${i + 1}. ${q.stem}\n   A. ${q.options[0]}\n   B. ${q.options[1]}\n   C. ${q.options[2]}`).join("\n\n");
						const c = await this.deps.generate<{ verdicts?: ColdVerdict[] }>({ slot: PACK_RULES.slots.check, system: this.prompt("bank-check.md"), user: `QUESTIONS\n\n${listed}`, toolName: "submit_check", toolDescription: "Submit your check of each question.", schema: CHECK_SCHEMA, signal });
						if (c.cost !== null) meta.costUsd = (meta.costUsd ?? 0) + c.cost;
						const checked = applyColdCheck(usable, Array.isArray(c.value?.verdicts) ? c.value.verdicts : []);
						for (const d of checked.dropped) meta.dropped.push({ stage: "bank", id: `${id}-#check${d.index + 1}`, reason: d.reason === "unanswerable" ? "could not be answered as posed" : "a second reading picked a different answer" });
						this.deps.log("pack_checked", { lectureId: id, asked: usable.length, unanswerable: checked.dropped.filter((d) => d.reason === "unanswerable").length, disagreed: checked.dropped.filter((d) => d.reason === "disagrees").length, model: c.model });
						usable = checked.kept;
					} catch (err) {
						// The check is an extra: without it the questions that passed the rules are kept, and writing them again would cost more than it is worth.
						if (signal.aborted) throw err;
						this.deps.log("pack_check_skipped", { lectureId: id, error: err instanceof Error ? err.message.slice(0, 200) : "unknown" });
					}
				}
				if (usable.length === 0) throw new Error("no usable questions");
				// A pack made again keeps the ids of questions the student may have answered (V-39).
				const previous = read<BankQuestion[]>(this.file(id, "bank.prev.json")) ?? [];
				const assigned = assignQuestionIds(id, usable, previous, meta.lastQuestionNumber ?? 0, nodeSet);
				meta.lastQuestionNumber = assigned.lastNumber;
				const bank = assigned.bank;
				fs.writeFileSync(/* turbopackIgnore: true */ this.file(id, "bank.json"), JSON.stringify(bank, null, "\t"));
				fs.rmSync(/* turbopackIgnore: true */ this.file(id, "bank.prev.json"), { force: true });
				// Questions written again under explainers that were kept (v3.1): each explainer still ends on a question that exists.
				const kept = meta.stages.explainers === "done" ? read<Explainer[]>(this.file(id, "explainers.json")) : null;
				if (kept) fs.writeFileSync(/* turbopackIgnore: true */ this.file(id, "explainers.json"), JSON.stringify(retargetExplainers(kept, bank), null, "\t"));
				return "done";
			});
			const bank = this.bank(id) ?? [];

			// 4. Explainers
			await stage("explainers", async () => {
				const ctx = { slides: slideSet, nodes: nodeSet, questions: new Set(bank.map((q) => q.id)) };
				const bankText = bank.map((q) => `- ${q.id} [${q.node}]: ${q.stem}`).join("\n");
				const r = await this.deps.generate<{ explainers: Omit<Explainer, "id">[] }>({
					slot: PACK_RULES.slots.explainers, system: this.prompt("explainer.md"), user: `CONCEPT MAP\n${mapText}\n\nQUESTION BANK\n${bankText}\n\nSLIDES\n${slidesText}`, toolName: "submit_explainers", toolDescription: "Submit the explainers.", schema: EXPLAINER_SCHEMA, signal,
					validate: (v) => {
						const es = (v as { explainers: Omit<Explainer, "id">[] }).explainers;
						const bad = es.map((e, i) => [i, checkExplainer({ ...e, id: `e${i}` } as Explainer, ctx)] as const).filter(([, p]) => p);
						return bad.length <= es.length / 2 ? null : `fix these explainers: ${bad.slice(0, 4).map(([i, p]) => `#${i + 1}: ${p}`).join("; ")}`;
					},
				});
				spend(r, "explainers");
				const out: Explainer[] = [];
				r.value.explainers.forEach((e, i) => {
					const item = { ...e, body: stripQuestionIds(e.body ?? "", ctx.questions), diagram: safeMermaid(e.diagram ?? ""), id: `${id}-e${i + 1}`.slice(-60) } as Explainer;
					const problem = checkExplainer(item, ctx);
					if (problem) meta.dropped.push({ stage: "explainers", id: item.id, reason: problem });
					else out.push(item);
				});
				fs.writeFileSync(/* turbopackIgnore: true */ this.file(id, "explainers.json"), JSON.stringify(out, null, "\t"));
				return "done";
			});

			meta.state = "ready";
			meta.counts = { nodes: nodes.length, explainers: this.explainers(id)?.length ?? 0, questions: bank.length };
			this.deps.log("pack_ready", { lectureId: id, ...meta.counts, dropped: meta.dropped.length, costUsd: meta.costUsd, ms: Date.now() - started, models: meta.models });
		} catch (err) {
			const cancelled = signal.aborted;
			meta.state = cancelled ? "cancelled" : "failed";
			meta.waiting = undefined;
			for (const s of Object.keys(meta.stages) as PackStage[]) if (meta.stages[s] === "running") meta.stages[s] = cancelled ? "pending" : "failed";
			if (cancelled) {
				meta.error = undefined;
				meta.errorDetail = undefined;
				meta.failure = undefined;
			} else {
				const detail = err instanceof Error ? err.message : String(err);
				const tries = delays.length + 1;
				meta.failure = err instanceof PackStop ? err.failure : "no_answer";
				// The screen gets plain words; the model's or provider's own message goes to the log.
				meta.error = err instanceof PackStop ? err.says : PACK_COPY.failed(tries);
				meta.errorDetail = detail;
				this.deps.log("pack_failed", { lectureId: id, failure: meta.failure, error: detail, ...(err instanceof PackStop ? {} : { tries }) });
			}
		} finally {
			meta.ms += Date.now() - started;
			meta.finishedAt = this.deps.now().toISOString();
			this.save(meta);
			this.running.delete(id);
		}
	}
}
