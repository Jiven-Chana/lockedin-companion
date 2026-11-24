"use client";

/**
 * One diagram-led explainer (v0.1 F-105): the terms it introduces, a short
 * body, one diagram, its slides, and "Try it", which always leads to a
 * question (explainers never replace questions: Sam, LIT-17).
 */

import type { Explainer } from "@/src/core";
import { Diagram } from "./diagram";
import { Prose } from "./prose";

export function ExplainerCard({ explainer, onSlide, onTry, busy }: { explainer: Explainer; onSlide?: (n: number) => void; onTry?: () => void; busy?: boolean }) {
	return (
		<article className="li-card flat li-stack li-explainer" style={{ gap: 10 }} aria-labelledby={`ex-${explainer.id}`}>
			<h3 id={`ex-${explainer.id}`} className="li-h2" style={{ fontSize: "1.25em", margin: 0 }}>{explainer.title}</h3>
			{explainer.terms.length ? <div className="li-row" style={{ gap: 6 }} aria-label="New terms">{explainer.terms.map((t) => <span key={t} className="li-chip">{t}</span>)}</div> : null}
			<Prose text={explainer.body} onSlide={onSlide} />
			<Diagram source={explainer.diagram} />
			<div className="li-row" style={{ gap: 8 }}>
				{explainer.slides.map((n) => <button key={n} type="button" className="li-chip" onClick={() => onSlide?.(n)} aria-label={`Open slide ${n}`}>Slide {n}</button>)}
				<span style={{ flexGrow: 1 }} />
				{onTry ? <button type="button" className="li-btn primary" disabled={busy} onClick={onTry}>Try it</button> : null}
			</div>
		</article>
	);
}
