"use client";

/**
 * A lecture's concept map (mvp1-plan F-12): the teacher's own plan format,
 * a mermaid `graph TD`, rendered with mermaid (securityLevel "strict") and
 * coloured by the student's results from the live theme tokens. Nodes are
 * clickable; an ordered list carries the same map for keyboards and screen
 * readers.
 */

import { useEffect, useId, useRef, useState } from "react";
import { mapToMermaid, tokenHex, type NodeStatus } from "@/src/core";
import type { ConceptMapData } from "./api";
import { StatusTag } from "./icons";
import { useLockedIn } from "./root";

let renders = 0;

export function ConceptMap({ data, selected, onSelect }: { data: ConceptMapData; selected: string | null; onSelect: (id: string) => void }) {
	const { scheme, appearance } = useLockedIn();
	const box = useRef<HTMLDivElement>(null);
	const [svg, setSvg] = useState<string | null>(null);
	const [failed, setFailed] = useState(false);
	const uid = useId().replace(/[^a-zA-Z0-9]/g, "");

	useEffect(() => {
		let cancelled = false;
		(async () => {
			const el = box.current;
			if (!el) return;
			const css = getComputedStyle(el);
			const v = (n: string) => tokenHex(css.getPropertyValue(`--li-${n}`));
			const classDefs: Record<NodeStatus, string> = {
				solid: `fill:${v("solid-bg")},stroke:${v("solid")},color:${v("solid-ink")},stroke-width:2px`,
				shaky: `fill:${v("surface")},stroke:${v("solid")},color:${v("solid-ink")},stroke-width:2px,stroke-dasharray:6 3`,
				revisit: `fill:${v("revisit-bg")},stroke:${v("revisit")},color:${v("revisit-ink")},stroke-width:2.5px`,
				notyet: `fill:${v("surface")},stroke:${v("notyet")},color:${v("muted")},stroke-width:1.5px,stroke-dasharray:4 4`,
			};
			try {
				const mermaid = (await import("mermaid")).default;
				mermaid.initialize({
					startOnLoad: false,
					securityLevel: "strict",
					theme: "base",
					themeVariables: { fontFamily: "Atkinson Hyperlegible, system-ui, sans-serif", fontSize: "15px", lineColor: v("muted"), primaryTextColor: v("ink"), primaryColor: v("surface"), primaryBorderColor: v("line") },
					flowchart: { curve: "basis", nodeSpacing: 36, rankSpacing: 52, padding: 14 },
				});
				const { svg: out } = await mermaid.render(`li-map-${uid}-${++renders}`, mapToMermaid(data.nodes, data.edges, classDefs));
				if (!cancelled) { setSvg(out); setFailed(false); }
			} catch (err) {
				console.warn("[lockedin] concept map render failed:", err);
				if (!cancelled) setFailed(true);
			}
		})();
		return () => { cancelled = true; };
	}, [data, scheme, appearance.theme, appearance.hue, uid]);

	function onClick(e: React.MouseEvent) {
		const g = (e.target as Element).closest("g.node");
		const m = g?.id ? /flowchart-(.+)-\d+$/.exec(g.id) : null;
		if (m?.[1]) onSelect(m[1]);
	}

	return (
		<div className="li-stack">
			<div ref={box} className="li-map li-card flat" style={{ minHeight: 280, display: "flex", justifyContent: "center", alignItems: "center", padding: 24 }} onClick={onClick}>
				{svg ? <div style={{ width: "100%", display: "flex", justifyContent: "center" }} dangerouslySetInnerHTML={{ __html: svg }} /> : failed ? <span className="li-muted">The map couldn&apos;t be drawn; the list below has the same ideas.</span> : <span className="li-muted">Drawing the map…</span>}
			</div>
			<ol aria-label="Ideas in this lecture, in order" className="li-stack" style={{ gap: 6, margin: 0, paddingLeft: 0, listStyle: "none" }}>
				{data.nodes.map((n) => (
					<li key={n.id}>
						<button type="button" className="li-opt" aria-pressed={selected === n.id} onClick={() => onSelect(n.id)} style={{ minHeight: 48, padding: "8px 14px", borderColor: selected === n.id ? "var(--li-accent)" : undefined }}>
							<span style={{ flexGrow: 1 }}>{n.title}{n.slides.length ? <span className="li-muted li-small"> · Slide {n.slides.join(", ")}</span> : null}</span>
							<StatusTag status={n.status} />
						</button>
					</li>
				))}
			</ol>
		</div>
	);
}
