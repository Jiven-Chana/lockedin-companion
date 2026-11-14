"use client";

/**
 * Teacher prose as light Markdown (paragraphs, lists, **bold**, *em*,
 * `code`) with every "(Slide n)" turned into a chip that opens that slide.
 * Deliberately small: no HTML passthrough, so nothing in a model's text can
 * inject markup.
 */

import { Fragment } from "react";

function inline(text: string, onSlide?: (n: number) => void, keyBase = "i"): React.ReactNode[] {
	const out: React.ReactNode[] = [];
	const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\(\s*Slides?\s+[\d\s,–-]+\))/g;
	let last = 0;
	let m: RegExpExecArray | null;
	let k = 0;
	while ((m = re.exec(text))) {
		if (m.index > last) out.push(text.slice(last, m.index));
		const tok = m[0];
		const key = `${keyBase}-${k++}`;
		if (tok.startsWith("**")) out.push(<b key={key}>{tok.slice(2, -2)}</b>);
		else if (tok.startsWith("`")) out.push(<code key={key}>{tok.slice(1, -1)}</code>);
		else if (tok.startsWith("*")) out.push(<em key={key}>{tok.slice(1, -1)}</em>);
		else {
			const nums = [...tok.matchAll(/\d+/g)].map((x) => Number(x[0]));
			out.push(
				<Fragment key={key}>
					{nums.map((n) => (
						<button key={n} type="button" className="li-chip" style={{ margin: "0 2px" }} onClick={() => onSlide?.(n)} aria-label={`Open slide ${n}`}>Slide {n}</button>
					))}
				</Fragment>,
			);
		}
		last = m.index + tok.length;
	}
	if (last < text.length) out.push(text.slice(last));
	return out;
}

export function Prose({ text, onSlide }: { text: string; onSlide?: (n: number) => void }) {
	const blocks = text.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
	return (
		<div className="li-prose">
			{blocks.map((b, i) => {
				const lines = b.split("\n");
				if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
					return <ul key={i}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*[-*•]\s+/, ""), onSlide, `${i}-${j}`)}</li>)}</ul>;
				}
				const heading = /^#{1,6}\s+(.*)$/.exec(b);
				if (heading) return <p key={i}><b>{inline(heading[1]!, onSlide, `${i}`)}</b></p>;
				return <p key={i}>{lines.map((l, j) => <Fragment key={j}>{j > 0 ? <br /> : null}{inline(l, onSlide, `${i}-${j}`)}</Fragment>)}</p>;
			})}
		</div>
	);
}
