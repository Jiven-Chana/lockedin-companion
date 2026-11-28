/**
 * Teacher prose, explainers and feedback as blocks (v0.1 F-103). Pure and
 * browser-safe: components/lockedin/prose.tsx renders these with React
 * text nodes, so no raw HTML in a model's text ever reaches the page.
 *
 * Supported: paragraphs (single newlines are line breaks), # headings,
 * - and 1. lists, GFM pipe tables, fenced code, ```mermaid diagrams,
 * $$…$$ display maths, and inline **bold**, *em*, `code`, $maths$ and
 * "(Slide n)" chips. The teacher is asked for exactly these
 * (companion/seed/prompts/shared/40-formatting.md).
 */

export type Inline =
	| { t: "text"; v: string }
	| { t: "b"; c: Inline[] }
	| { t: "em"; c: Inline[] }
	| { t: "code"; v: string }
	| { t: "math"; v: string }
	| { t: "slides"; n: number[] };

export type CellAlign = "left" | "center" | "right" | null;

export type ProseBlock =
	| { t: "p"; lines: Inline[][] }
	| { t: "h"; level: number; c: Inline[] }
	| { t: "ul"; items: Inline[][] }
	| { t: "ol"; start: number; items: Inline[][] }
	| { t: "code"; lang: string; v: string }
	| { t: "mermaid"; v: string }
	| { t: "math"; v: string }
	| { t: "table"; align: CellAlign[]; head: Inline[][]; rows: Inline[][][] };

// ─── inline ─────────────────────────────────────────────────────────────────

// Order matters: code and maths are opaque, slide chips before emphasis.
// Inline maths follows pandoc's rule so prices ("$5 and $10") stay text:
// no space just inside either dollar, and no digit right after the closing one.
// The last thing before the closing dollar may be an escaped character ("\}", "\|", "\,"): a set
// such as $S(i)=\{\mathrm{yes}\}$ ends on one, and was left as raw text until v3.1.1. An escaped dollar never closes.
const INLINE = /(`[^`\n]+`)|(\$(?=[^\s$])(?:[^$\n\\]|\\.)*?(?:[^\s$\\]|\\[^\s$])\$(?!\d)|\$[^\s$]\$(?!\d))|(\(\s*Slides?\s+[\d\s,–-]+\))|(\*\*(?=\S)[^*]*?\S\*\*)|(\*(?=\S)[^*\n]*?\S\*|\*[^\s*]\*)/g;

export function parseInline(text: string): Inline[] {
	const out: Inline[] = [];
	const push = (v: string) => {
		if (!v) return;
		const prev = out[out.length - 1];
		if (prev?.t === "text") prev.v += v;
		else out.push({ t: "text", v });
	};
	let last = 0;
	for (const m of text.matchAll(INLINE)) {
		push(text.slice(last, m.index));
		const tok = m[0];
		if (m[1]) out.push({ t: "code", v: tok.slice(1, -1) });
		else if (m[2]) out.push({ t: "math", v: tok.slice(1, -1) });
		else if (m[3]) out.push({ t: "slides", n: [...tok.matchAll(/\d+/g)].map((x) => Number(x[0])) });
		else if (m[4]) out.push({ t: "b", c: parseInline(tok.slice(2, -2)) });
		else out.push({ t: "em", c: parseInline(tok.slice(1, -1)) });
		last = m.index + tok.length;
	}
	push(text.slice(last));
	return out;
}

// ─── blocks ─────────────────────────────────────────────────────────────────

const FENCE = /^\s*(`{3,}|~{3,})\s*([\w+-]*)\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const UL = /^\s*[-*•]\s+(.*)$/;
const OL = /^\s*(\d{1,4})[.)]\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

function splitRow(line: string): string[] {
	let s = line.trim();
	if (s.startsWith("|")) s = s.slice(1);
	if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
	const cells: string[] = [];
	let cur = "";
	for (let i = 0; i < s.length; i++) {
		if (s[i] === "\\" && s[i + 1] === "|") {
			cur += "|";
			i++;
		} else if (s[i] === "|") {
			cells.push(cur.trim());
			cur = "";
		} else cur += s[i];
	}
	cells.push(cur.trim());
	return cells;
}

function alignOf(cell: string): CellAlign {
	const c = cell.trim();
	if (c.startsWith(":") && c.endsWith(":")) return "center";
	if (c.endsWith(":")) return "right";
	if (c.startsWith(":")) return "left";
	return null;
}

const isTableStart = (lines: string[], i: number) => lines[i]!.includes("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]!) && lines[i + 1]!.includes("-");

function startsBlock(lines: string[], i: number): boolean {
	const l = lines[i]!;
	return FENCE.test(l) || HEADING.test(l) || UL.test(l) || OL.test(l) || l.trim().startsWith("$$") || isTableStart(lines, i);
}

export function parseProse(text: string): ProseBlock[] {
	const lines = text.replace(/\r\n?/g, "\n").split("\n");
	const blocks: ProseBlock[] = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i]!;
		if (!line.trim()) {
			i++;
			continue;
		}

		const fence = FENCE.exec(line);
		if (fence) {
			const close = new RegExp(`^\\s*${fence[1]![0] === "`" ? "`" : "~"}{${fence[1]!.length},}\\s*$`);
			const body: string[] = [];
			i++;
			while (i < lines.length && !close.test(lines[i]!)) body.push(lines[i++]!);
			i++; // the closing fence (or past the end)
			const lang = fence[2]!.toLowerCase();
			const v = body.join("\n");
			blocks.push(lang === "mermaid" ? { t: "mermaid", v } : { t: "code", lang, v });
			continue;
		}

		if (line.trim().startsWith("$$")) {
			const first = line.trim().slice(2);
			if (first.endsWith("$$") && first.length >= 2) {
				blocks.push({ t: "math", v: first.slice(0, -2).trim() });
				i++;
				continue;
			}
			const body: string[] = first.trim() ? [first] : [];
			i++;
			while (i < lines.length && !lines[i]!.trim().endsWith("$$")) body.push(lines[i++]!);
			if (i < lines.length) {
				const tail = lines[i]!.trim().slice(0, -2);
				if (tail.trim()) body.push(tail);
				i++;
			}
			blocks.push({ t: "math", v: body.join("\n").trim() });
			continue;
		}

		const heading = HEADING.exec(line);
		if (heading) {
			blocks.push({ t: "h", level: heading[1]!.length, c: parseInline(heading[2]!) });
			i++;
			continue;
		}

		if (isTableStart(lines, i)) {
			const head = splitRow(line);
			const align = splitRow(lines[i + 1]!).map(alignOf);
			i += 2;
			const rows: Inline[][][] = [];
			while (i < lines.length && lines[i]!.trim() && lines[i]!.includes("|")) {
				const cells = splitRow(lines[i++]!);
				rows.push(head.map((_, k) => parseInline(cells[k] ?? "")));
			}
			blocks.push({ t: "table", align: head.map((_, k) => align[k] ?? null), head: head.map(parseInline), rows });
			continue;
		}

		if (UL.test(line)) {
			const items: Inline[][] = [];
			while (i < lines.length && UL.test(lines[i]!)) items.push(parseInline(UL.exec(lines[i++]!)![1]!));
			blocks.push({ t: "ul", items });
			continue;
		}

		const ol = OL.exec(line);
		if (ol) {
			const items: Inline[][] = [];
			while (i < lines.length && OL.test(lines[i]!)) items.push(parseInline(OL.exec(lines[i++]!)![2]!));
			blocks.push({ t: "ol", start: Number(ol[1]), items });
			continue;
		}

		const para: Inline[][] = [];
		while (i < lines.length && lines[i]!.trim() && (para.length === 0 || !startsBlock(lines, i))) para.push(parseInline(lines[i++]!.trim()));
		blocks.push({ t: "p", lines: para });
	}
	return blocks;
}
