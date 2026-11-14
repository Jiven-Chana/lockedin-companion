/**
 * Concept maps (mvp1-plan F-12): a lecture's ideas as a mermaid `graph TD`,
 * the same format the engine's teacher plans in (plan_init), coloured by the
 * student's own answers. Pure; the server parses `map.mmd` with the engine's
 * mermaid parser and passes nodes/edges in.
 *
 * Node labels carry slide references: `persona-purpose["What personas are for · S4"]`.
 */

import { parseSlideRefs } from "./slides.ts";

export type NodeStatus = "solid" | "shaky" | "revisit" | "notyet";

export interface MapNode {
	id: string;
	title: string;
	slides: number[];
	status: NodeStatus;
	/** Answers that landed on this node. */
	answers: number;
}

export interface MapEdge {
	from: string;
	to: string;
}

/** One answer, as the event log records it. */
export interface MapEvidence {
	nodeId?: string;
	slides: number[];
	correct: boolean;
	dontKnow: boolean;
	confidence?: number | null;
	at: string;
}

export interface MapMiss {
	nodeId?: string;
	explanation?: string;
	status: "open" | "solid";
}

/** "What personas are for · S4" → title + [4]; "· S4–5" and "· S4, S6" work too. */
export function splitNodeLabel(label: string): { title: string; slides: number[] } {
	const m = /\s*[·|-]\s*S(\d+(?:\s*[–-]\s*\d+)?(?:\s*,\s*S?\d+)*)\s*$/.exec(label);
	if (!m) return { title: label.trim(), slides: [] };
	return { title: label.slice(0, m.index).trim(), slides: parseSlideRefs(`(Slides ${m[1]!.replace(/S/g, "")})`) };
}

/** No authored map: one node per slide section, in order (a starter the teacher's first plan can replace). */
export function starterMap(slides: { number: number; title: string }[]): { nodes: Omit<MapNode, "status" | "answers">[]; edges: MapEdge[] } {
	const content = slides.filter((s, i) => !(i === 0 && slides.length > 2) && !/^summary$/i.test(s.title.trim()));
	const nodes = content.map((s) => ({ id: `slide-${s.number}`, title: s.title || `Slide ${s.number}`, slides: [s.number] }));
	const edges = nodes.slice(1).map((n, i) => ({ from: nodes[i]!.id, to: n.id }));
	return { nodes, edges };
}

/**
 * Status per node: an open miss on it → to revisit; else the latest answer
 * on it correct at ≥ 70% → solid; any answer → shaky; none → not yet.
 * An answer or miss lands on a node by nodeId, or else by the slides its
 * explanation cites (so LearnHarness answers count even when the teacher
 * used its own slugs).
 */
export function nodeStatuses(nodes: Omit<MapNode, "status" | "answers">[], evidence: MapEvidence[], misses: MapMiss[]): MapNode[] {
	const ids = new Set(nodes.map((n) => n.id));
	const lands = (n: { id: string; slides: number[] }, nodeId: string | undefined, slides: number[]) =>
		nodeId && ids.has(nodeId) ? nodeId === n.id : slides.some((s) => n.slides.includes(s));
	return nodes.map((n) => {
		const mine = evidence.filter((e) => lands(n, e.nodeId, e.slides)).sort((a, b) => a.at.localeCompare(b.at));
		const open = misses.some((m) => m.status === "open" && lands(n, m.nodeId, parseSlideRefs(m.explanation)));
		const last = mine.at(-1);
		const status: NodeStatus = open ? "revisit" : !last ? "notyet" : last.correct && !last.dontKnow && (last.confidence ?? 0) >= 70 ? "solid" : "shaky";
		return { ...n, status, answers: mine.length };
	});
}

const STATUS_GLYPH: Record<NodeStatus, string> = { solid: "✓", shaky: "◐", revisit: "○", notyet: "·" };

/** A display mermaid source: clean labels with a status glyph, one class per status. */
export function mapToMermaid(nodes: MapNode[], edges: MapEdge[], classDefs: Record<NodeStatus, string>): string {
	const esc = (s: string) => s.replace(/"/g, "'").replace(/[<>]/g, "");
	const lines = ["graph TD"];
	for (const n of nodes) {
		const slides = n.slides.length ? ` · S${n.slides.join(", S")}` : "";
		lines.push(`  ${n.id}["${STATUS_GLYPH[n.status]} ${esc(n.title)}${slides}"]`);
	}
	for (const e of edges) lines.push(`  ${e.from} --> ${e.to}`);
	for (const [k, v] of Object.entries(classDefs)) lines.push(`  classDef ${k} ${v}`);
	for (const n of nodes) lines.push(`  class ${n.id} ${n.status}`);
	return lines.join("\n");
}
