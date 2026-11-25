/**
 * Study packs (v0.1 F-105): per course unit, a concept map, short
 * diagram-led explainers and a bank of three-option questions, generated
 * from the unit's slides. Pure: types, the validators every item must
 * pass, and the bank as the scripted engine's question set (so the
 * declared fallback works on the student's own material).
 *
 * Constraints (spec F-105, Sam, LIT-17, AE2-7): explainers never replace
 * questions, cite slides that exist, list the terms they introduce before
 * using notation, and end in a question from the bank.
 */

import { PACK_COPY, PACK_RULES } from "./policy.ts";
import type { ScriptedSet } from "./types.ts";

export interface BankQuestion {
	id: string;
	/** ≤ 90 characters, so it fits a phone notification (N-1 v2). */
	stem: string;
	options: [string, string, string];
	correct: 0 | 1 | 2;
	/** ≤ 140 characters. */
	explanation: string;
	slides: number[];
	/** The concept-map node it tests. */
	node: string;
	difficulty: 1 | 2 | 3;
	/** "gap": written for "Practise this idea" (V-39), around something the student got wrong. Absent: written with the pack. */
	origin?: "gap";
	writtenAt?: string;
}

export interface Explainer {
	id: string;
	node: string;
	title: string;
	/** Terms it introduces, listed before any notation is used (AE2-7). */
	terms: string[];
	/** Markdown, ≤ 120 words, no diagram (the diagram is separate). */
	body: string;
	/** Exactly one mermaid diagram source. */
	diagram: string;
	slides: number[];
	/** Its closing "Try it" question, from the bank. */
	tryQuestionId: string;
}

export type PackStage = "read" | "map" | "explainers" | "bank";
export const PACK_STAGES: readonly PackStage[] = ["read", "map", "explainers", "bank"];
export type StageState = "pending" | "running" | "done" | "failed" | "skipped";

export interface PackMeta {
	lectureId: string;
	/** `queued`: another unit's pack is being written first (packs run one at a time). */
	state: "queued" | "generating" | "ready" | "failed" | "cancelled";
	/** Set while a generating pack is between tries (V-23): after a failed try, or until the AI connection is back. */
	waiting?: { for: "retry"; seconds: number; until: string } | { for: "connection" };
	/** Why a pack failed, for the screen: only `no_answer` is worth trying again as it is. */
	failure?: "no_answer" | "too_short" | "no_material";
	stages: Record<PackStage, StageState>;
	startedAt: string;
	finishedAt?: string;
	/** The highest question number ever given in this unit, so a number is never reused for a different question. */
	lastQuestionNumber?: number;
	/** The model per stage ("provider/id"). */
	models: Partial<Record<PackStage, string>>;
	/** USD, summed over calls; null on a subscription (or when no call reported a price). */
	costUsd: number | null;
	ms: number;
	/** Items that failed their checks twice and were left out (logged, spec F-105). */
	dropped: { stage: PackStage; id: string; reason: string }[];
	/** What the screen says about a failure, in plain words (PACK_COPY). */
	error?: string;
	/** The underlying error as the model or provider reported it (for the event log and debugging; never shown). */
	errorDetail?: string;
	counts?: { nodes: number; explainers: number; questions: number };
}

export const newPackMeta = (lectureId: string, at: string): PackMeta => ({
	lectureId,
	state: "generating",
	stages: { read: "pending", map: "pending", explainers: "pending", bank: "pending" },
	startedAt: at,
	models: {},
	costUsd: null,
	ms: 0,
	dropped: [],
});

/** One line for the lecture page when a pack is waiting or has failed; null while it is simply being written, ready or paused. */
export function packStatusLine(meta: Pick<PackMeta, "state" | "waiting" | "error">): string | null {
	if (meta.state === "queued") return PACK_COPY.queued;
	if (meta.state === "generating" && meta.waiting) return meta.waiting.for === "connection" ? PACK_COPY.waitingForConnection : PACK_COPY.retrying(meta.waiting.seconds);
	if (meta.state === "failed") return meta.error ?? PACK_COPY.failed(PACK_RULES.retryDelaysMs.length + 1);
	return null;
}

/** A map node as the validators need it. */
export interface PackNode {
	id: string;
	title: string;
	slides: number[];
}

export interface PackContext {
	slides: ReadonlySet<number>;
	nodes: ReadonlySet<string>;
}

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const SLUG = /^[a-z][a-z0-9-]{0,47}$/;

function citations(slides: unknown, ctx: PackContext): string | null {
	if (!Array.isArray(slides) || slides.length === 0) return "cite at least one slide";
	const bad = slides.filter((n) => !Number.isInteger(n) || !ctx.slides.has(n as number));
	return bad.length ? `slide ${bad.join(", ")} doesn't exist in this unit` : null;
}

/** Map nodes: slug ids, a title, at least one slide that exists, at most PACK_RULES.maxNodes. */
export function checkMapNodes(nodes: readonly PackNode[], slides: ReadonlySet<number>): string | null {
	if (nodes.length < 2) return "the map needs at least 2 ideas";
	if (nodes.length > PACK_RULES.maxNodes) return `the map has ${nodes.length} ideas; keep it to ${PACK_RULES.maxNodes}`;
	for (const n of nodes) {
		if (!SLUG.test(n.id)) return `node id "${n.id}" must be a lowercase slug`;
		if (!n.title.trim()) return `node ${n.id} needs a label`;
		const bad = citations(n.slides, { slides, nodes: new Set() });
		if (bad) return `node ${n.id}: ${bad}; label it "Idea (Slide n)"`;
	}
	return null;
}

export function checkQuestion(q: Partial<BankQuestion>, ctx: PackContext): string | null {
	if (!q.stem?.trim()) return "a stem is required";
	if (q.stem.length > PACK_RULES.stemMax) return `the stem is ${q.stem.length} characters; keep it to ${PACK_RULES.stemMax}`;
	if (!Array.isArray(q.options) || q.options.length !== 3 || q.options.some((o) => typeof o !== "string" || !o.trim())) return "exactly 3 non-empty options";
	if (new Set(q.options.map((o) => o.trim().toLowerCase())).size !== 3) return "the 3 options must differ";
	if (q.correct !== 0 && q.correct !== 1 && q.correct !== 2) return "correct is 0, 1 or 2";
	if (!q.explanation?.trim()) return "an explanation is required";
	if (q.explanation.length > PACK_RULES.explanationMax) return `the explanation is ${q.explanation.length} characters; keep it to ${PACK_RULES.explanationMax}`;
	if (!q.node || !ctx.nodes.has(q.node)) return `node "${q.node}" isn't on the map`;
	if (q.difficulty !== 1 && q.difficulty !== 2 && q.difficulty !== 3) return "difficulty is 1, 2 or 3";
	return citations(q.slides, ctx);
}

/** Exactly one mermaid diagram of any type, as a separate field. */
const DIAGRAM_HEAD = /^\s*(graph|flowchart|mindmap|sequenceDiagram|stateDiagram(-v2)?|classDiagram|timeline)\b/;

export function checkExplainer(e: Partial<Explainer>, ctx: PackContext & { questions: ReadonlySet<string> }): string | null {
	if (!e.title?.trim() || e.title.length > 80) return "a title of 1 to 80 characters";
	if (!e.node || !ctx.nodes.has(e.node)) return `node "${e.node}" isn't on the map`;
	if (!e.body?.trim()) return "a body is required";
	if (words(e.body) > PACK_RULES.explainerWords) return `the body is ${words(e.body)} words; keep it to ${PACK_RULES.explainerWords}`;
	if (/```/.test(e.body)) return "put the diagram in `diagram`, not in the body";
	if (!e.diagram || !DIAGRAM_HEAD.test(e.diagram)) return "exactly one mermaid diagram (graph, flowchart, mindmap, sequenceDiagram, stateDiagram, classDiagram or timeline)";
	if (!Array.isArray(e.terms)) return "list the terms it introduces (an empty list if none)";
	if (!e.tryQuestionId || !ctx.questions.has(e.tryQuestionId)) return `tryQuestionId "${e.tryQuestionId}" isn't in the question bank`;
	return citations(e.slides, ctx);
}

/**
 * Dry run, 23 Nov: models echo the internal question id they were given for
 * "Try it" ("Try question hci-w3-personas-q5."). The Try it button already
 * links it, so any sentence naming a bank question id is removed.
 */
export function stripQuestionIds(body: string, ids: Iterable<string>): string {
	let out = body;
	for (const id of ids) {
		if (!out.includes(id)) continue;
		const esc = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		out = out.replace(new RegExp(`[ \\t]*[^.!?\\n]*(?<![\\w-])${esc}(?![\\w-])[^.!?\\n]*[.!?]?`, "g"), "");
	}
	return out.replace(/[ \t]+\n/g, "\n").trim();
}

/** A stem reduced to what makes it the same question: case, spacing and punctuation don't. */
export const stemKey = (stem: string) => stem.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

const numberOf = (id: string, letter: "q" | "g") => Number(new RegExp(`-${letter}(\\d+)$`).exec(id)?.[1] ?? 0);

/**
 * Ids for a bank that is written again (v2.0, V-39): the student's history
 * points at questions by id, so an id must keep meaning the same question.
 *  - A question whose stem matches one in the previous bank keeps that id.
 *  - Any other gets the next number never used in this unit (`lastNumber`).
 *  - Questions written for a gap are kept, when their idea is still on the map.
 */
export function assignQuestionIds(
	lectureId: string,
	fresh: readonly Omit<BankQuestion, "id">[],
	previous: readonly BankQuestion[],
	lastNumber = 0,
	nodes?: ReadonlySet<string>,
): { bank: BankQuestion[]; lastNumber: number } {
	const byStem = new Map(previous.filter((q) => q.origin !== "gap").map((q) => [stemKey(q.stem), q.id]));
	let next = Math.max(lastNumber, ...previous.map((q) => numberOf(q.id, "q")));
	const taken = new Set<string>();
	const bank: BankQuestion[] = fresh.map((q) => {
		const kept = byStem.get(stemKey(q.stem));
		const id = kept && !taken.has(kept) ? kept : `${lectureId}-q${++next}`.slice(-60);
		taken.add(id);
		return { ...q, id } as BankQuestion;
	});
	const stems = new Set(bank.map((q) => stemKey(q.stem)));
	for (const q of previous) if (q.origin === "gap" && (!nodes || nodes.has(q.node)) && !stems.has(stemKey(q.stem))) bank.push(q);
	return { bank, lastNumber: next };
}

/** The id for a new question written for a gap: `<unit>-g<n>`, never reusing a number. */
export function nextGapId(lectureId: string, bank: readonly BankQuestion[], offset = 0): string {
	return `${lectureId}-g${Math.max(0, ...bank.map((q) => numberOf(q.id, "g"))) + 1 + offset}`.slice(-60);
}

/** The scripted engine's set from a bank (spec F-105: generated banks replace hand-authored sets). */
export function bankToScriptedSet(lectureId: string, bank: readonly BankQuestion[], explainers: readonly Explainer[] = []): ScriptedSet {
	const exampleFor = new Map(explainers.map((e) => [e.node, e.body]));
	const ordered = [...bank].sort((a, b) => a.difficulty - b.difficulty);
	return {
		lectureId,
		questions: ordered.map((q) => {
			const cite = q.slides.length ? ` (Slide ${q.slides[0]})` : "";
			const example = exampleFor.get(q.node);
			return {
				id: q.id,
				stem: q.stem,
				options: [...q.options],
				correct: [q.correct],
				explanation: /\(Slides? \d/.test(q.explanation) ? q.explanation : `${q.explanation}${cite}`,
				nodeId: q.node,
				slides: q.slides,
				ai: true,
				...(example ? { workedExample: example } : {}),
			};
		}),
	};
}
