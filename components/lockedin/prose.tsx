"use client";

/**
 * Teacher prose, explainers and feedback (v0.1 F-103): Markdown blocks
 * from parseProse (src/core/companion/prose.ts) rendered as React
 * elements: paragraphs, headings, lists, tables, code, mermaid diagrams,
 * KaTeX maths, and "(Slide n)" chips that open that slide.
 *
 * No HTML passthrough: every piece of the model's text is a React text
 * node. The only injected markup is KaTeX's output (trust off, so no
 * links or HTML commands) and mermaid's strict-mode svg (diagram.tsx).
 */

import katex from "katex";
import { createElement, Fragment, type ReactNode } from "react";
import { parseProse, type Inline, type ProseBlock } from "@/src/core";
import { Diagram } from "./diagram";

function maths(tex: string, display: boolean, key: string): ReactNode {
	const html = katex.renderToString(tex, { displayMode: display, throwOnError: false, trust: false, strict: "ignore", output: "html" });
	return createElement(display ? "div" : "span", { key, className: display ? "li-math-block" : "li-math", dangerouslySetInnerHTML: { __html: html } });
}

function inline(nodes: Inline[], onSlide: ((n: number) => void) | undefined, keyBase: string): ReactNode[] {
	return nodes.map((n, i) => {
		const key = `${keyBase}-${i}`;
		switch (n.t) {
			case "text":
				return <Fragment key={key}>{n.v}</Fragment>;
			case "b":
				return <b key={key}>{inline(n.c, onSlide, key)}</b>;
			case "em":
				return <em key={key}>{inline(n.c, onSlide, key)}</em>;
			case "code":
				return <code key={key}>{n.v}</code>;
			case "math":
				return maths(n.v, false, key);
			case "slides":
				return (
					<Fragment key={key}>
						{n.n.map((s, j) => (
							<button key={`${s}-${j}`} type="button" className="li-chip" style={{ margin: "0 2px" }} onClick={() => onSlide?.(s)} aria-label={`Open slide ${s}`}>Slide {s}</button>
						))}
					</Fragment>
				);
		}
	});
}

function block(b: ProseBlock, i: number, onSlide?: (n: number) => void): ReactNode {
	const k = `b${i}`;
	switch (b.t) {
		case "p":
			return <p key={k}>{b.lines.map((l, j) => <Fragment key={j}>{j > 0 ? <br /> : null}{inline(l, onSlide, `${k}-${j}`)}</Fragment>)}</p>;
		case "h":
			return <p key={k} className="li-prose-h"><b>{inline(b.c, onSlide, k)}</b></p>;
		case "ul":
			return <ul key={k}>{b.items.map((it, j) => <li key={j}>{inline(it, onSlide, `${k}-${j}`)}</li>)}</ul>;
		case "ol":
			return <ol key={k} start={b.start}>{b.items.map((it, j) => <li key={j}>{inline(it, onSlide, `${k}-${j}`)}</li>)}</ol>;
		case "code":
			return <pre key={k} className="li-code"><code>{b.v}</code></pre>;
		case "math":
			return maths(b.v, true, k);
		case "mermaid":
			return <Diagram key={k} source={b.v} />;
		case "table":
			return (
				<div key={k} className="li-table-wrap">
					<table className="li-table">
						<thead><tr>{b.head.map((c, j) => <th key={j} style={b.align[j] ? { textAlign: b.align[j]! } : undefined}>{inline(c, onSlide, `${k}-h${j}`)}</th>)}</tr></thead>
						<tbody>{b.rows.map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j} style={b.align[j] ? { textAlign: b.align[j]! } : undefined}>{inline(c, onSlide, `${k}-${ri}-${j}`)}</td>)}</tr>)}</tbody>
					</table>
				</div>
			);
	}
}

export function Prose({ text, onSlide }: { text: string; onSlide?: (n: number) => void }) {
	return <div className="li-prose">{parseProse(text).map((b, i) => block(b, i, onSlide))}</div>;
}
