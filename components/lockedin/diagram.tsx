"use client";

/**
 * One mermaid diagram in teacher prose, an explainer or feedback (v0.1
 * F-103). Rendered with securityLevel "strict" and themed from the live
 * Focus tokens (light, dark, high contrast), as the concept map is.
 * Mermaid is loaded only when a diagram appears. If a diagram can't be
 * drawn, its source is shown with a short note instead. Tap to enlarge.
 */

import { useEffect, useId, useRef, useState } from "react";
import { tokenHex } from "@/src/core";
import { useLockedInOptional } from "./root";

let renders = 0;

export function Diagram({ source }: { source: string }) {
	const root = useLockedInOptional();
	const box = useRef<HTMLDivElement>(null);
	const [svg, setSvg] = useState<string | null>(null);
	const [failed, setFailed] = useState(false);
	const [open, setOpen] = useState(false);
	const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
	const themeKey = root ? `${root.scheme}-${root.appearance.theme}-${root.appearance.hue}` : "none";

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
						background: v("surface"),
						primaryColor: v("soft"),
						primaryBorderColor: v("accent"),
						primaryTextColor: v("ink"),
						secondaryColor: v("surface"),
						tertiaryColor: v("surface"),
						lineColor: v("muted"),
						textColor: v("ink"),
						noteBkgColor: v("soft"),
						noteTextColor: v("ink"),
					},
				});
				const { svg: out } = await mermaid.render(`li-dia-${uid}-${++renders}`, source);
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
