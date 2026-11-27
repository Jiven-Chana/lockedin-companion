"use client";

/**
 * A map drawn by LockedIn (v3.0, V-33): rows of blocks, with the links as
 * straight lines behind them. The layout is the tested rule in
 * src/core/companion/map-layout.ts; this file only draws what it decides.
 *
 * A map too wide for its space is shown smaller, down to three quarters.
 * Wider than that, or on a narrow screen, it becomes one column in study
 * order, where there are no lines at all.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { layoutMap, linkPath, MAP_SIZE, studyOrder, type MapEdge } from "@/src/core";

const PAD = 8;
/** A map may shrink this far to fit before it becomes a column. */
const SMALLEST = 0.75;
/** Below this width a map is always a column. */
const NARROW = 520;

export function BlocksMap<T extends { id: string }>({ nodes, edges, label, block, column }: {
	nodes: readonly T[];
	edges: readonly MapEdge[];
	label: string;
	/** One idea as a block. `style` places it; pass it on to the element. */
	block: (node: T, place: { style: React.CSSProperties; index: number; column: boolean }) => React.ReactNode;
	/** Always one column (a narrow panel). */
	column?: boolean;
}) {
	const box = useRef<HTMLDivElement>(null);
	const [room, setRoom] = useState<number | null>(null);
	useEffect(() => {
		const el = box.current;
		if (!el) return;
		const measure = () => setRoom(el.clientWidth);
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	}, []);
	const laid = useMemo(() => layoutMap(nodes, edges), [nodes, edges]);
	const width = laid.width + PAD * 2 + 6;
	const zoom = room === null ? 1 : Math.min(1, room / width);
	const asColumn = column || (room !== null && (room < NARROW || zoom < SMALLEST));

	if (asColumn) {
		return (
			<div ref={box} className="li-map-col" role="group" aria-label={label}>
				{studyOrder(nodes, edges).map((n, i) => block(n, { style: { marginLeft: Math.min(n.depth, 4) * 22, ["--i" as string]: i }, index: i, column: true }))}
			</div>
		);
	}
	return (
		<div ref={box} className="li-map-box" role="group" aria-label={label}>
			<div className="li-map" style={{ width, height: laid.height + PAD * 2 + 6, zoom: zoom < 1 ? zoom : undefined }}>
				<svg className="li-map-links" width={laid.width + PAD * 2} height={laid.height + PAD * 2} aria-hidden="true">
					{laid.links.map((l) => {
						const pts = l.points.map(([x, y]) => [x + PAD, y + PAD] as [number, number]);
						const [x, y] = pts.at(-1)!;
						// The line stops short of the block, where its arrowhead takes over.
						const line = pts.map((p, i) => (i === pts.length - 1 ? ([p[0], p[1] - 7] as [number, number]) : p));
						return (
							<g key={`${l.from}>${l.to}`} data-loop={l.loop ? "true" : undefined}>
								<path d={linkPath(line)} />
								<polygon points={`${x - 6},${y - 9} ${x + 6},${y - 9} ${x},${y - 1}`} />
							</g>
						);
					})}
				</svg>
				{laid.nodes.map((n, i) => block(n, { style: { position: "absolute", left: n.x + PAD, top: n.y + PAD, width: MAP_SIZE.w, height: MAP_SIZE.h, ["--i" as string]: i }, index: i, column: false }))}
			</div>
		</div>
	);
}
