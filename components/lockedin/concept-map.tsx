"use client";

/**
 * A lecture's concept map (F-12; v3.0, V-33): drawn by LockedIn as rows of
 * blocks, an idea one row below everything it builds on. Each idea is a
 * button with where the student stands as a shape and a word (never colour
 * alone) and its slides. Pressing one picks it, to practise that idea.
 */

import { useEffect, useRef } from "react";
import type { NodeStatus } from "@/src/core";
import type { ConceptMapData } from "./api";
import { BlocksMap } from "./blocks-map";
import { StatusTag } from "./icons";

/** "Slide 24 +9": the first slide, and how many more. The full list is on the lecture's slide panel. */
export const slideWord = (slides: readonly number[]) => (slides.length === 0 ? "" : slides.length === 1 ? `Slide ${slides[0]}` : `Slide ${slides[0]} +${slides.length - 1}`);
const WORD: Record<NodeStatus, string> = { solid: "secured", shaky: "getting there", revisit: "to revisit", notyet: "not yet" };

export function ConceptMap({ data, selected, onSelect }: { data: ConceptMapData; selected: string | null; onSelect: (id: string) => void }) {
	// Motion (F-118): the ideas arrive in order the first time; after that, one whose standing changed pulses once.
	const last = useRef<Map<string, NodeStatus> | null>(null);
	const changed = new Set<string>();
	if (last.current) for (const n of data.nodes) if (last.current.has(n.id) && last.current.get(n.id) !== n.status) changed.add(n.id);
	const first = last.current === null;
	useEffect(() => {
		last.current = new Map(data.nodes.map((n) => [n.id, n.status]));
	}, [data]);

	return (
		<BlocksMap
			nodes={data.nodes}
			edges={data.edges}
			label="The ideas in this lecture, and what builds on what"
			block={(n, { style }) => (
				<button
					key={n.id}
					type="button"
					className={`li-idea${first ? " li-idea-in" : ""}${changed.has(n.id) ? " li-idea-pulse" : ""}`}
					data-s={n.status}
					style={style}
					aria-pressed={selected === n.id}
					aria-label={`${n.title}, ${WORD[n.status]}${n.slides.length ? `, ${slideWord(n.slides).toLowerCase()}` : ""}`}
					onClick={() => onSelect(n.id)}
				>
					<span className="li-idea-top"><StatusTag status={n.status} /><span className="li-idea-slide">{slideWord(n.slides)}</span></span>
					<b>{n.title}</b>
				</button>
			)}
		/>
	);
}
