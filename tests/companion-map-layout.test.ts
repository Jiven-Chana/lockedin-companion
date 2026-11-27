/**
 * The concept map's layout (v3.0, V-33): LockedIn's own rule, drawn as rows
 * of blocks. These hold for every map in the repository and for 500
 * generated ones, so a link can never break on a student's own material:
 *   - no two blocks overlap;
 *   - no link passes through a block that is not one of its ends;
 *   - every link in the data is drawn, a loop last and marked, none dropped;
 *   - the same map always gives the same drawing.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { layoutMap, MAP_SIZE, parseSimpleFlow, studyOrder, type LaidOutMap, type MapEdge } from "../src/core/companion/index.ts";

type N = { id: string };
const S = MAP_SIZE;

const rects = (m: LaidOutMap<N>) => m.nodes.map((n) => ({ id: n.id, x0: n.x, y0: n.y, x1: n.x + S.w, y1: n.y + S.h }));
/** Does the segment (axis-aligned) pass through the inside of the rectangle? Touching an edge is not passing through. */
function crosses(a: [number, number], b: [number, number], r: { x0: number; y0: number; x1: number; y1: number }): boolean {
	const [x0, x1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])];
	const [y0, y1] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])];
	const eps = 0.5;
	return x0 < r.x1 - eps && x1 > r.x0 + eps && y0 < r.y1 - eps && y1 > r.y0 + eps;
}

function check(name: string, nodes: N[], edges: MapEdge[]) {
	const m = layoutMap(nodes, edges);
	const R = rects(m);
	// Every idea is placed, once.
	assert.deepEqual(m.nodes.map((n) => n.id).sort(), nodes.map((n) => n.id).sort(), `${name}: every idea placed`);
	// No two blocks overlap, and each keeps its distance.
	for (let i = 0; i < R.length; i++) for (let j = i + 1; j < R.length; j++) {
		const [a, b] = [R[i]!, R[j]!];
		const apart = a.x1 + S.gapX - 1 <= b.x0 || b.x1 + S.gapX - 1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0;
		assert.ok(apart, `${name}: ${a.id} and ${b.id} overlap or touch`);
	}
	// Every real link is drawn exactly once; a loop is marked and comes last.
	const ids = new Set(nodes.map((n) => n.id));
	const wanted = new Set(edges.filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to).map((e) => `${e.from}>${e.to}`));
	assert.deepEqual(m.links.map((l) => `${l.from}>${l.to}`).sort(), [...wanted].sort(), `${name}: every link drawn once`);
	const firstLoop = m.links.findIndex((l) => l.loop);
	if (firstLoop >= 0) assert.ok(m.links.slice(firstLoop).every((l) => l.loop), `${name}: loops are drawn last`);
	// No link passes through a block that is not one of its ends, and every part of it is straight.
	for (const l of m.links) {
		for (let i = 0; i + 1 < l.points.length; i++) {
			const [a, b] = [l.points[i]!, l.points[i + 1]!];
			assert.ok(Math.abs(a[0] - b[0]) < 0.01 || Math.abs(a[1] - b[1]) < 0.01, `${name}: ${l.from}>${l.to} has a slanted part`);
			for (const r of R) {
				if (r.id === l.from || r.id === l.to) continue;
				assert.ok(!crosses(a, b, r), `${name}: ${l.from}>${l.to} passes through ${r.id}`);
			}
		}
		// It leaves its own block and arrives at the other without cutting across either.
		const [from, to] = [R.find((r) => r.id === l.from)!, R.find((r) => r.id === l.to)!];
		const [p0, p1] = [l.points[0]!, l.points.at(-1)!];
		assert.ok(p0[0] >= from.x0 && p0[0] <= from.x1, `${name}: ${l.from}>${l.to} starts on its block`);
		assert.ok(p1[0] >= to.x0 && p1[0] <= to.x1 && Math.abs(p1[1] - to.y0) < 0.01, `${name}: ${l.from}>${l.to} arrives on the top of its block`);
	}
	// Nothing is drawn outside the stated size.
	for (const r of R) assert.ok(r.x0 >= -0.01 && r.y0 >= -0.01 && r.x1 <= m.width + 0.01 && r.y1 <= m.height + 0.01, `${name}: ${r.id} is inside the drawing`);
	for (const l of m.links) for (const [x, y] of l.points) assert.ok(x >= -0.01 && y >= -0.01 && x <= m.width + 0.01 && y <= m.height + 0.01, `${name}: ${l.from}>${l.to} stays inside the drawing`);
	// The same map, the same drawing.
	assert.deepEqual(layoutMap(nodes, edges), m, `${name}: deterministic`);
	return m;
}

/** A small generator with a fixed seed, so a failure can be found again. */
function rng(seed: number) {
	let s = seed >>> 0;
	return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

describe("the layout holds on every concept map in the repository", () => {
	const dir = path.join(import.meta.dirname, "..", "companion", "content");
	for (const unit of fs.readdirSync(dir)) {
		const file = path.join(dir, unit, "map.mmd");
		if (!fs.existsSync(file)) continue;
		it(unit, () => {
			const flow = parseSimpleFlow(fs.readFileSync(file, "utf-8"));
			assert.ok(flow, "the map is plain boxes and arrows");
			check(unit, flow.nodes, flow.edges);
		});
	}
});

describe("the layout holds on generated maps", () => {
	it("500 maps of 1 to 14 ideas: trees, chains, diamonds, wide fans, loops", () => {
		const r = rng(20261127);
		for (let k = 0; k < 500; k++) {
			const n = 1 + Math.floor(r() * 14);
			const nodes = Array.from({ length: n }, (_, i) => ({ id: `n${i}` }));
			const edges: MapEdge[] = [];
			const density = r() * 2.2;
			for (let i = 0; i < Math.round(n * density); i++) {
				const a = Math.floor(r() * n), b = Math.floor(r() * n);
				// Mostly forwards; one in eight is free to point back and make a loop.
				if (r() < 0.125) edges.push({ from: `n${a}`, to: `n${b}` });
				else if (a !== b) edges.push({ from: `n${Math.min(a, b)}`, to: `n${Math.max(a, b)}` });
			}
			check(`generated ${k} (${n} ideas, ${edges.length} links)`, nodes, edges);
		}
	});

	const shapes: { name: string; nodes: string[]; edges: [string, string][]; rows?: number }[] = [
		{ name: "one idea", nodes: ["a"], edges: [], rows: 1 },
		{ name: "no links at all", nodes: ["a", "b", "c"], edges: [], rows: 1 },
		{ name: "a chain", nodes: ["a", "b", "c", "d"], edges: [["a", "b"], ["b", "c"], ["c", "d"]], rows: 4 },
		{ name: "a diamond", nodes: ["a", "b", "c", "d"], edges: [["a", "b"], ["a", "c"], ["b", "d"], ["c", "d"]], rows: 3 },
		{ name: "a link that skips two rows", nodes: ["a", "b", "c", "d"], edges: [["a", "b"], ["b", "c"], ["c", "d"], ["a", "d"]], rows: 4 },
		{ name: "a fan of eight", nodes: ["r", ...Array.from({ length: 8 }, (_, i) => `k${i}`)], edges: Array.from({ length: 8 }, (_, i) => ["r", `k${i}`] as [string, string]), rows: 2 },
		{ name: "a loop of three", nodes: ["a", "b", "c"], edges: [["a", "b"], ["b", "c"], ["c", "a"]], rows: 3 },
		{ name: "two ideas that lead to each other", nodes: ["a", "b"], edges: [["a", "b"], ["b", "a"]], rows: 2 },
		{ name: "a link to itself and a link to nothing", nodes: ["a", "b"], edges: [["a", "a"], ["a", "ghost"], ["a", "b"]], rows: 2 },
		{ name: "the same link twice", nodes: ["a", "b"], edges: [["a", "b"], ["a", "b"]], rows: 2 },
	];
	for (const s of shapes) {
		it(s.name, () => {
			const m = check(s.name, s.nodes.map((id) => ({ id })), s.edges.map(([from, to]) => ({ from, to })));
			if (s.rows) assert.equal(new Set(m.nodes.map((n) => n.row)).size, s.rows);
		});
	}

	it("an idea sits below everything it builds on", () => {
		const m = layoutMap([{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }], [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "a", to: "d" }, { from: "c", to: "d" }]);
		const row = Object.fromEntries(m.nodes.map((n) => [n.id, n.row]));
		assert.deepEqual(row, { a: 0, b: 1, c: 2, d: 3 });
	});

	it("a loop is marked as one, and the rest of the map is laid out as if it were not there", () => {
		const m = layoutMap([{ id: "a" }, { id: "b" }, { id: "c" }], [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "c", to: "a" }]);
		assert.deepEqual(m.links.filter((l) => l.loop).map((l) => `${l.from}>${l.to}`), ["c>a"]);
	});
});

describe("study order, for one column", () => {
	it("an idea comes after everything it builds on, one step in from what leads to it", () => {
		const order = studyOrder([{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }], [{ from: "a", to: "b" }, { from: "a", to: "c" }, { from: "b", to: "d" }, { from: "c", to: "d" }]);
		assert.deepEqual(order.map((n) => [n.id, n.depth]), [["a", 0], ["b", 1], ["c", 1], ["d", 2]]);
	});
	it("a loop does not stop it: every idea is listed once", () => {
		const order = studyOrder([{ id: "a" }, { id: "b" }], [{ from: "a", to: "b" }, { from: "b", to: "a" }]);
		assert.deepEqual(order.map((n) => n.id).sort(), ["a", "b"]);
	});
});

describe("reading a diagram that is plain boxes and arrows", () => {
	const cases: { name: string; src: string; want: { nodes: [string, string][]; edges: [string, string][] } | null }[] = [
		{ name: "the concept-map format", src: `graph TD\n  a["One · S3"]\n  b["Two"]\n  a --> b`, want: { nodes: [["a", "One · S3"], ["b", "Two"]], edges: [["a", "b"]] } },
		{ name: "ideas named on the arrow's own line", src: `flowchart TB\n  a["One"] --> b["Two"]\n  b --> c(Three)`, want: { nodes: [["a", "One"], ["b", "Two"], ["c", "Three"]], edges: [["a", "b"], ["b", "c"]] } },
		{ name: "a chain on one line", src: `graph TD\n  a --> b --> c`, want: { nodes: [["a", "a"], ["b", "b"], ["c", "c"]], edges: [["a", "b"], ["b", "c"]] } },
		{ name: "styling lines are skipped", src: `graph TD\n  a[One] --> b[Two]\n  classDef x fill:#fff\n  class a x\n  %% a note`, want: { nodes: [["a", "One"], ["b", "Two"]], edges: [["a", "b"]] } },
		{ name: "a label on an arrow is not plain: left to mermaid", src: `graph TD\n  a -->|because| b`, want: null },
		{ name: "a group is not plain", src: `graph TD\n  subgraph g\n  a --> b\n  end`, want: null },
		{ name: "left to right is not rows of blocks", src: `graph LR\n  a --> b`, want: null },
		{ name: "another kind of diagram", src: `sequenceDiagram\n  A->>B: hi`, want: null },
		{ name: "nothing", src: ``, want: null },
	];
	for (const c of cases) {
		it(c.name, () => {
			const got = parseSimpleFlow(c.src);
			if (!c.want) return assert.equal(got, null);
			assert.ok(got);
			assert.deepEqual(got.nodes.map((n) => [n.id, n.label]), c.want.nodes);
			assert.deepEqual(got.edges.map((e) => [e.from, e.to]), c.want.edges);
		});
	}
});
