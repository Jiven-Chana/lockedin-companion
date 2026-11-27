/**
 * LockedIn's own layout for a concept map (v3.0, V-33): rows of blocks.
 * Pure: it decides where every idea and every link goes; a screen draws
 * them. tests/companion-map-layout.test.ts holds it to these rules on
 * every map in the repository and on 500 generated ones:
 *
 *   - An idea sits one row below everything it builds on.
 *   - No two blocks overlap.
 *   - A link is made of straight parts, and passes through no block that
 *     is not one of its ends. A link that skips a row has a slot of its
 *     own in that row.
 *   - Every link in the data is drawn. One that would make a loop is
 *     marked, routed round the outside, and comes last.
 *   - The same map always gives the same drawing.
 */

import type { MapEdge } from "./concept-map.ts";

export interface MapSize {
	/** A block's width and height. */
	w: number;
	h: number;
	/** The width kept free in a row for a link that passes through it. */
	slot: number;
	/** The least space between two things in a row, and between two rows. */
	gapX: number;
	gapY: number;
}
export const MAP_SIZE: MapSize = { w: 222, h: 92, slot: 24, gapX: 26, gapY: 56 };

export interface MapLink {
	from: string;
	to: string;
	/** This link points back up the map: it closes a loop. */
	loop: boolean;
	/** The corners of the link, in order. Every part between two corners is level or upright. */
	points: [number, number][];
}
export interface LaidOutMap<T extends { id: string }> {
	width: number;
	height: number;
	/** Each idea with the top-left corner of its block, and its row. In the order they were given. */
	nodes: (T & { x: number; y: number; row: number })[];
	links: MapLink[];
}

interface Item {
	id: string;
	row: number;
	w: number;
	real: boolean;
	seq: number;
	up: string[];
	down: string[];
	order: number;
	bary: number;
	x: number;
	y: number;
}

export function layoutMap<T extends { id: string }>(given: readonly T[], links: readonly MapEdge[], size: MapSize = MAP_SIZE): LaidOutMap<T> {
	const o = size;
	// Each idea once; each link once, between two ideas that exist, never an idea to itself.
	const nodes = given.filter((n, i) => given.findIndex((m) => m.id === n.id) === i);
	const ids = new Set(nodes.map((n) => n.id));
	const seen = new Set<string>();
	const edges = links.filter((e) => {
		const key = `${e.from}>${e.to}`;
		if (!ids.has(e.from) || !ids.has(e.to) || e.from === e.to || seen.has(key)) return false;
		seen.add(key);
		return true;
	});

	// A link back to an idea already on the path would make a loop: it is set aside, and drawn last.
	const out = new Map<string, MapEdge[]>(nodes.map((n) => [n.id, []]));
	for (const e of edges) out.get(e.from)!.push(e);
	const state = new Map<string, 1 | 2>();
	const loops = new Set<MapEdge>();
	const visit = (id: string) => {
		state.set(id, 1);
		for (const e of out.get(id)!) {
			if (state.get(e.to) === 1) loops.add(e);
			else if (!state.has(e.to)) visit(e.to);
		}
		state.set(id, 2);
	};
	for (const n of nodes) if (!state.has(n.id)) visit(n.id);
	const forward = edges.filter((e) => !loops.has(e));

	// Rows: the longest way down to an idea from one with nothing before it.
	const layer = new Map<string, number>(nodes.map((n) => [n.id, 0]));
	for (let i = 0; i < nodes.length; i++) for (const e of forward) layer.set(e.to, Math.max(layer.get(e.to)!, layer.get(e.from)! + 1));

	const items = new Map<string, Item>();
	const rows: Item[][] = [];
	const add = (id: string, row: number, real: boolean, seq: number) => {
		const it: Item = { id, row, w: real ? o.w : o.slot, real, seq, up: [], down: [], order: 0, bary: 0, x: 0, y: 0 };
		items.set(id, it);
		(rows[row] ??= []).push(it);
	};
	nodes.forEach((n, i) => add(n.id, layer.get(n.id)!, true, i));
	// A link across more than one row passes through a narrow slot of its own in each row between.
	const chains = forward.map((e, k) => {
		const chain = [e.from];
		for (let r = layer.get(e.from)! + 1; r < layer.get(e.to)!; r++) {
			const id = `\u0000${k}@${r}`;
			add(id, r, false, nodes.length + k);
			chain.push(id);
		}
		chain.push(e.to);
		for (let i = 0; i + 1 < chain.length; i++) {
			items.get(chain[i]!)!.down.push(chain[i + 1]!);
			items.get(chain[i + 1]!)!.up.push(chain[i]!);
		}
		return chain;
	});
	for (let r = 0; r < rows.length; r++) rows[r] ??= [];

	// Order each row by where its neighbours sit, sweeping down and up, so links stay short and cross little.
	rows.forEach((row) => row.sort((a, b) => a.seq - b.seq).forEach((it, i) => (it.order = i)));
	const sweep = (row: Item[], key: "up" | "down") => {
		for (const it of row) {
			const n = it[key];
			it.bary = n.length ? n.reduce((s, id) => s + items.get(id)!.order, 0) / n.length : it.order;
		}
		row.sort((a, b) => a.bary - b.bary || a.order - b.order).forEach((it, i) => (it.order = i));
	};
	for (let k = 0; k < 6; k++) {
		for (let r = 1; r < rows.length; r++) sweep(rows[r]!, "up");
		for (let r = rows.length - 2; r >= 0; r--) sweep(rows[r]!, "down");
	}

	// Across: start packed, then pull each thing towards its neighbours, keeping the order and the gaps.
	for (const row of rows) {
		let x = 0;
		for (const it of row) {
			it.x = x + it.w / 2;
			x += it.w + o.gapX;
		}
	}
	/** The positions nearest to `want` that keep the row's order and the least distance between neighbours. */
	const place = (row: Item[], want: number[]) => {
		const c = [0];
		for (let i = 1; i < row.length; i++) c[i] = c[i - 1]! + (row[i - 1]!.w + row[i]!.w) / 2 + o.gapX;
		const pools: { sum: number; n: number }[] = [];
		row.forEach((_, i) => {
			pools.push({ sum: want[i]! - c[i]!, n: 1 });
			while (pools.length > 1 && pools.at(-2)!.sum / pools.at(-2)!.n > pools.at(-1)!.sum / pools.at(-1)!.n) {
				const p = pools.pop()!;
				pools.at(-1)!.sum += p.sum;
				pools.at(-1)!.n += p.n;
			}
		});
		let i = 0;
		for (const p of pools) for (let k = 0; k < p.n; k++, i++) row[i]!.x = p.sum / p.n + c[i]!;
	};
	const mean = (it: Item, key: "up" | "down") => (it[key].length ? it[key].reduce((s, id) => s + items.get(id)!.x, 0) / it[key].length : null);
	for (let k = 0; k < 10; k++) {
		for (let r = 1; r < rows.length; r++) place(rows[r]!, rows[r]!.map((it) => mean(it, "up") ?? it.x));
		for (let r = rows.length - 2; r >= 0; r--) {
			place(rows[r]!, rows[r]!.map((it) => {
				const [d, u] = [mean(it, "down"), mean(it, "up")];
				return d !== null && u !== null ? (d + u) / 2 : (d ?? u ?? it.x);
			}));
		}
	}
	// Last, top to bottom once more: an idea ends up under what it builds on, so the common link is a straight line down.
	for (let r = 1; r < rows.length; r++) place(rows[r]!, rows[r]!.map((it) => mean(it, "up") ?? it.x));

	const loopList = edges.filter((e) => loops.has(e));
	// Room round the outside for loops: above the first row, below the last, and a lane each down the right.
	const pad = loopList.length ? 28 : 0;
	const minX = Math.min(...[...items.values()].map((it) => it.x - it.w / 2));
	for (const it of items.values()) {
		it.x = round(it.x - minX);
		it.y = pad + it.row * (o.h + o.gapY);
	}
	const inner = Math.max(0, ...[...items.values()].map((it) => it.x + it.w / 2));
	const bottom = pad + rows.length * o.h + Math.max(0, rows.length - 1) * o.gapY;

	// Links: down from the idea above, across in the gap between the rows, down into the idea below.
	// Each idea's links cross the gap at their own height, so two level runs never lie on top of each other.
	const lane = new Map<string, number>();
	for (const row of rows) {
		const bent = row.filter((it) => it.down.some((id) => Math.abs(items.get(id)!.x - it.x) > 1));
		bent.forEach((it, i) => lane.set(it.id, (i + 1) / (bent.length + 1)));
	}
	const drawn: MapLink[] = chains.map((chain) => {
		const pts: [number, number][] = [];
		for (let i = 0; i + 1 < chain.length; i++) {
			const a = items.get(chain[i]!)!, b = items.get(chain[i + 1]!)!;
			const mid = round(a.y + o.h + o.gapY * (lane.get(a.id) ?? 0.5));
			if (!pts.length) pts.push([a.x, a.y + o.h]);
			const from = pts.at(-1)![0];
			// Nearly above its idea already: come straight down into it, a little off-centre, with no kink.
			const reach = b.w / 2 - 24;
			const into = b.real && Math.abs(from - b.x) < Math.min(24, Math.max(0, reach)) ? from : b.x;
			if (Math.abs(from - into) > 0.01) pts.push([from, mid], [into, mid]);
			pts.push([into, b.real ? b.y : b.y + o.h]);
		}
		return { from: chain[0]!, to: chain.at(-1)!, loop: false, points: pts };
	});
	// A loop goes round the outside: down from its idea, out to the right, up, and back in at the top of the idea it returns to.
	loopList.forEach((e, k) => {
		const a = items.get(e.from)!, b = items.get(e.to)!;
		const gutter = round(inner + 18 + k * 14);
		const below = round(a.y + o.h + (a.row === rows.length - 1 ? 16 : o.gapY * 0.84) - Math.min(k, 3) * 2);
		const above = round(b.y - (b.row === 0 ? 16 : o.gapY * 0.16) + Math.min(k, 3) * 2);
		const leave = round(a.x + a.w / 2 - 28), enter = round(b.x + b.w / 2 - 28);
		drawn.push({ from: e.from, to: e.to, loop: true, points: [[leave, a.y + o.h], [leave, below], [gutter, below], [gutter, above], [enter, above], [enter, b.y]] });
	});

	return {
		width: round(inner + (loopList.length ? 18 + loopList.length * 14 : 0)),
		height: bottom + pad,
		nodes: nodes.map((n) => {
			const it = items.get(n.id)!;
			return { ...n, x: round(it.x - it.w / 2), y: it.y, row: it.row };
		}),
		links: drawn,
	};
}
const round = (n: number) => Math.round(n * 100) / 100;

/** An SVG path through a link's corners, each corner rounded. */
export function linkPath(points: readonly (readonly [number, number])[], radius = 12): string {
	if (!points.length) return "";
	let d = `M${points[0]![0]},${points[0]![1]}`;
	for (let i = 1; i < points.length; i++) {
		const [x, y] = points[i]!, [px, py] = points[i - 1]!, next = points[i + 1];
		if (!next) {
			d += ` L${x},${y}`;
			break;
		}
		const inLen = Math.hypot(x - px, y - py), outLen = Math.hypot(next[0] - x, next[1] - y);
		const k = Math.min(radius, inLen / 2, outLen / 2);
		if (k < 1) {
			d += ` L${x},${y}`;
			continue;
		}
		d += ` L${round(x - ((x - px) / inLen) * k)},${round(y - ((y - py) / inLen) * k)} Q${x},${y} ${round(x + ((next[0] - x) / outLen) * k)},${round(y + ((next[1] - y) / outLen) * k)}`;
	}
	return d;
}

/**
 * Study order, for a map shown as one column (a narrow screen, or a map too
 * wide for its space): an idea comes after everything it builds on, one step
 * in from the idea that leads to it. No lines, so nothing to cross.
 */
export function studyOrder<T extends { id: string }>(given: readonly T[], links: readonly MapEdge[]): (T & { depth: number })[] {
	const nodes = given.filter((n, i) => given.findIndex((m) => m.id === n.id) === i);
	const kids = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
	const waiting = new Map<string, number>(nodes.map((n) => [n.id, 0]));
	for (const e of links) {
		if (!kids.has(e.from) || !waiting.has(e.to) || e.from === e.to || kids.get(e.from)!.includes(e.to)) continue;
		kids.get(e.from)!.push(e.to);
		waiting.set(e.to, waiting.get(e.to)! + 1);
	}
	const roots = nodes.filter((n) => waiting.get(n.id) === 0).map((n) => n.id);
	const done = new Set<string>();
	const out: { id: string; depth: number }[] = [];
	const walk = (id: string, depth: number) => {
		if (done.has(id)) return;
		done.add(id);
		out.push({ id, depth });
		for (const k of kids.get(id)!) {
			waiting.set(k, waiting.get(k)! - 1);
			if (waiting.get(k)! <= 0) walk(k, depth + 1);
		}
	};
	for (const id of roots) walk(id, 0);
	// Anything left is inside a loop: listed in the order given.
	for (const n of nodes) walk(n.id, 0);
	const by = new Map(nodes.map((n) => [n.id, n]));
	return out.map((x) => ({ ...by.get(x.id)!, depth: x.depth }));
}

/**
 * A diagram that is plain boxes and arrows, top to bottom, read from the
 * mermaid text a study pack or the tutor wrote. Anything else (labels on
 * arrows, groups, other directions, other kinds of diagram) gives null, and
 * the caller leaves that diagram to mermaid.
 */
export function parseSimpleFlow(source: string): { nodes: { id: string; label: string }[]; edges: MapEdge[] } | null {
	const lines = source.split("\n").map((l) => l.trim().replace(/;$/, "")).filter((l) => l && !l.startsWith("%%"));
	if (!lines.length || !/^(graph|flowchart)\s+(TD|TB)$/i.test(lines[0]!)) return null;
	const nodes: { id: string; label: string; named: boolean }[] = [];
	const edges: MapEdge[] = [];
	const ref = (text: string): string | null => {
		const m = /^([A-Za-z0-9_][A-Za-z0-9_-]*)\s*(?:\["([^"]*)"\]|\[([^\]"]*)\]|\("([^"]*)"\)|\(([^)"]*)\))?$/.exec(text.trim());
		if (!m) return null;
		const label = m[2] ?? m[3] ?? m[4] ?? m[5];
		const at = nodes.find((n) => n.id === m[1]);
		if (!at) nodes.push({ id: m[1]!, label: label?.trim() || m[1]!, named: label !== undefined });
		else if (label !== undefined && !at.named) Object.assign(at, { label: label.trim() || at.id, named: true });
		return m[1]!;
	};
	for (const line of lines.slice(1)) {
		if (/^(classDef|class|style|linkStyle|click)\b/.test(line)) continue;
		if (/^(subgraph|end|direction)\b/.test(line) || /[|]|-\.|==|--[xo]|<--|--\s+\S/.test(line.replace(/-->/g, " → ").replace(/"[^"]*"/g, '""'))) return null;
		const parts = line.split(/\s*-->\s*/);
		const idsInLine = parts.map(ref);
		if (idsInLine.some((id) => id === null)) return null;
		for (let i = 0; i + 1 < idsInLine.length; i++) edges.push({ from: idsInLine[i]!, to: idsInLine[i + 1]! });
	}
	return nodes.length ? { nodes: nodes.map(({ id, label }) => ({ id, label })), edges } : null;
}
