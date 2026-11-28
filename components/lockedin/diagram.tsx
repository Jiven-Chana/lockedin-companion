"use client";

/**
 * One diagram in teacher prose, an explainer or feedback (F-103; v3.0).
 * A diagram that is plain boxes and arrows is drawn by LockedIn, as the
 * concept map is (V-33). Anything else is drawn by mermaid, with
 * securityLevel "strict" and the look's own colours (light, dark, high
 * contrast). Mermaid is loaded only when such a diagram appears. If a
 * diagram can't be drawn, its source is shown with a short note instead.
 * Tap to enlarge. A box-and-arrow diagram that carries steps or a gap is
 * a picture that builds up (v3.2, picture.tsx).
 */

import { useEffect, useId, useRef, useState } from "react";
import { parsePictureScript, parseSimpleFlow, safeMermaid, tokenHex } from "@/src/core";
import { BlocksMap } from "./blocks-map";
import { SteppedPicture } from "./picture";
import { useLockedInOptional } from "./root";

let renders = 0;

export function Diagram({ source }: { source: string }) {
	// Plain boxes and arrows: LockedIn draws it, with the same rule and the same blocks as the concept map.
	const flow = parseSimpleFlow(source);
	if (flow) {
		// With steps or a gap written into it, the picture builds up (v3.2). Without, it is shown whole, as before.
		if (parsePictureScript(source, flow.nodes.map((n) => n.id))) return <figure className="li-diagram"><SteppedPicture source={source} /></figure>;
		return (
			<figure className="li-diagram">
				<BlocksMap nodes={flow.nodes} edges={flow.edges} label="Diagram" block={(n, { style }) => <div key={n.id} className="li-idea plain" style={style}><b>{n.label}</b></div>} />
			</figure>
		);
	}
	return <MermaidDiagram source={source} />;
}

function MermaidDiagram({ source }: { source: string }) {
	const root = useLockedInOptional();
	const box = useRef<HTMLDivElement>(null);
	const [svg, setSvg] = useState<string | null>(null);
	const [failed, setFailed] = useState(false);
	const [open, setOpen] = useState(false);
	const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
	const themeKey = root ? `${root.scheme}-${root.appearance.theme}` : "none";

	useEffect(() => {
		let cancelled = false;
		(async () => {
			const el = box.current;
			if (!el) return;
			const css = getComputedStyle(el);
			const v = (n: string) => tokenHex(css.getPropertyValue(`--li-${n}`));
			try {
				const mermaid = (await import("mermaid")).default;
				mermaid.initialize({
					startOnLoad: false,
					securityLevel: "strict",
					theme: "base",
					themeVariables: {
						fontFamily: "Atkinson Hyperlegible, system-ui, sans-serif",
						fontSize: "15px",
						background: v("card"),
						primaryColor: v("card"),
						primaryBorderColor: v("edge"),
						primaryTextColor: v("ink"),
						secondaryColor: v("sand"),
						tertiaryColor: v("card"),
						lineColor: v("ink"),
						textColor: v("ink"),
						noteBkgColor: v("sand"),
						noteTextColor: v("ink"),
						// Mind maps and timelines colour each branch from cScale0–11 (black by default in "base"): one calm tone instead.
						...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [[`cScale${i}`, v("sand")], [`cScaleLabel${i}`, v("ink")], [`cScalePeer${i}`, v("edge")]]).flat()),
						// …and its root from git0: mint, with ink on it.
						git0: v("mint"),
						gitBranchLabel0: v("on"),
					},
				});
				// Labels are quoted first, so one with brackets in it ("calculate d(A)") can't be a syntax error (v1.0.1).
				const { svg: out } = await mermaid.render(`li-dia-${uid}-${++renders}`, safeMermaid(source));
				if (!cancelled) {
					setSvg(out);
					setFailed(false);
				}
			} catch (err) {
				console.warn("[lockedin] diagram render failed:", err);
				if (!cancelled) setFailed(true);
			}
		})();
		return () => { cancelled = true; };
	}, [source, uid, themeKey]);

	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [open]);

	if (failed) {
		return (
			<figure className="li-diagram li-diagram-failed" ref={box}>
				<figcaption className="li-small li-muted">This diagram couldn&apos;t be drawn. Here is what the teacher wrote:</figcaption>
				<pre><code>{source}</code></pre>
			</figure>
		);
	}

	return (
		<figure className="li-diagram" ref={box} aria-busy={svg ? undefined : true}>
			{svg ? (
				<>
					{/* Mermaid's strict mode sanitises labels; the svg is mermaid's own output. */}
					<button type="button" className="li-diagram-svg" aria-label="Enlarge diagram" onClick={() => setOpen(true)} dangerouslySetInnerHTML={{ __html: svg }} />
					{open ? (
						<div className="li-diagram-overlay" role="dialog" aria-modal="true" aria-label="Diagram" onClick={() => setOpen(false)}>
							<div className="li-diagram-large" dangerouslySetInnerHTML={{ __html: svg }} />
							<button type="button" className="li-btn" onClick={() => setOpen(false)}>Close</button>
						</div>
					) : null}
				</>
			) : (
				<div className="li-diagram-loading li-small li-muted">Drawing the diagram…</div>
			)}
		</figure>
	);
}
