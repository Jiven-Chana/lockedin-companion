/**
 * Rich rendering (v0.1 F-103): teacher prose → blocks → React. Parsing is
 * pure; rendering is checked with renderToStaticMarkup (effects such as
 * mermaid's render don't run there, so a diagram shows its placeholder).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseInline, parseProse, type ProseBlock } from "../src/core/companion/index.ts";
import { Prose } from "../components/lockedin/prose.tsx";

const kinds = (blocks: ProseBlock[]) => blocks.map((b) => b.t);

describe("prose blocks", () => {
	const cases: Array<[string, string, string[]]> = [
		["paragraphs split on blank lines", "One.\nStill one.\n\nTwo.", ["p", "p"]],
		["a heading, a list and a paragraph", "## Recap\n- a\n- b\nAfter.", ["h", "ul", "p"]],
		["a numbered list", "1. first\n2. second", ["ol"]],
		["a fenced mermaid diagram", "Look:\n```mermaid\ngraph TD\n  a --> b\n```\nDone.", ["p", "mermaid", "p"]],
		["other fenced code stays code", "```python\nprint('<b>')\n```", ["code"]],
		["display maths on its own lines", "$$\na^2 + b^2 = c^2\n$$", ["math"]],
		["display maths on one line", "$$ e^{i\\pi} + 1 = 0 $$", ["math"]],
		["a pipe table", "| Player | Left | Right |\n|---|:-:|--:|\n| A | 3 | 1 |\n| B | 0 | 2 |", ["table"]],
		["a pipe in text is not a table", "Either a | b, nothing else.", ["p"]],
		["an unclosed fence takes the rest", "```mermaid\ngraph TD", ["mermaid"]],
	];
	for (const [name, text, expected] of cases) it(name, () => assert.deepEqual(kinds(parseProse(text)), expected));

	it("keeps the diagram source and the language", () => {
		const [, d] = parseProse("x\n```mermaid\ngraph TD\n  a --> b\n```");
		assert.deepEqual(d, { t: "mermaid", v: "graph TD\n  a --> b" });
	});

	it("reads table alignment and pads short rows", () => {
		const [t] = parseProse("| a | b | c |\n|:--|:-:|--:|\n| 1 |");
		assert.ok(t && t.t === "table");
		assert.deepEqual(t.align, ["left", "center", "right"]);
		assert.equal(t.rows[0]!.length, 3);
	});
});

describe("inline marks", () => {
	const brief = (s: string) => parseInline(s).map((x) => (x.t === "text" ? `text:${x.v}` : x.t === "slides" ? `slides:${x.n.join(",")}` : x.t === "b" || x.t === "em" ? `${x.t}` : `${x.t}:${x.v}`));
	const cases: Array<[string, string, string[]]> = [
		["inline maths", "so $x^2$ grows", ["text:so ", "math:x^2", "text: grows"]],
		["a one-character formula", "let $n$ be", ["text:let ", "math:n", "text: be"]],
		// v3.1.1: maths that ends on an escaped character was left as raw text (Jiven, 28 Nov: "the widgets in the learn box sometimes dont render math").
		["maths ending in an escaped brace", "is exactly $S(i)=\\{\\mathrm{yes}\\}$ or $S(i)=\\{\\mathrm{no}\\}$, never empty", ["text:is exactly ", "math:S(i)=\\{\\mathrm{yes}\\}", "text: or ", "math:S(i)=\\{\\mathrm{no}\\}", "text:, never empty"]],
		["maths ending in a thin space or a bar", "norm $\\|x\\|$ and $a\\,$ here", ["text:norm ", "math:\\|x\\|", "text: and ", "math:a\\,", "text: here"]],
		["a set written out", "the set $\\{1,2\\}$.", ["text:the set ", "math:\\{1,2\\}", "text:."]],
		["an escaped dollar is still not the end of maths", "costs $5\\$ maybe", ["text:costs $5\\$ maybe"]],
		["prices are not maths", "It costs $5 and $10 now", ["text:It costs $5 and $10 now"]],
		["a dollar with a space inside is not maths", "pay $ 5 $ later", ["text:pay $ 5 $ later"]],
		["slide chips", "See (Slide 4) and (Slides 6, 7).", ["text:See ", "slides:4", "text: and ", "slides:6,7", "text:."]],
		["bold, em and code", "**key** *idea* `x`", ["b", "text: ", "em", "text: ", "code:x"]],
		["maths inside code is code", "`$x$`", ["code:$x$"]],
	];
	for (const [name, text, expected] of cases) it(name, () => assert.deepEqual(brief(text), expected));
});

describe("rendering is safe", () => {
	const html = (text: string) => renderToStaticMarkup(createElement(Prose, { text }));

	it("raw HTML in a model's text is shown as text, never as markup", () => {
		const out = html('Hi <script>alert(1)</script> <img src=x onerror="alert(2)"> **bold <b>x</b>**');
		assert.ok(!out.includes("<script"), out);
		assert.ok(!out.includes("<img"), out);
		assert.ok(out.includes("&lt;script&gt;"), out);
	});

	it("HTML inside a code block or a table cell stays text", () => {
		const out = html("```\n<script>x</script>\n```\n\n| a |\n|---|\n| <iframe src=evil> |");
		assert.ok(!out.includes("<script") && !out.includes("<iframe"), out);
	});

	it("KaTeX refuses links and HTML commands", () => {
		const out = html("$\\href{javascript:alert(1)}{click}$ and $$\\htmlClass{x}{y}$$");
		assert.ok(!out.includes("javascript:"), out);
		assert.ok(!out.includes('class="x"'), out);
	});

	it("maths renders as KaTeX markup, tables as tables", () => {
		const out = html("$a^2$\n\n| a | b |\n|---|---|\n| 1 | 2 |");
		assert.ok(out.includes('class="katex"'), out);
		assert.ok(out.includes("<table") && out.includes("<th"), out);
	});

	it("a diagram renders a labelled placeholder before mermaid runs", () => {
		const out = html("```mermaid\ngraph TD\n  a --> b\n```");
		assert.ok(out.includes("li-diagram"), out);
	});
});
