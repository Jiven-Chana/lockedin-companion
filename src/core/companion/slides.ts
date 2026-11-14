/**
 * Lecture slides as Markdown: one `## Slide n — <title>` heading per page,
 * which is what the teacher cites as "(Slide n)" (plan §7.5, INT-01-g).
 */

export interface SlidePage {
	number: number;
	kind: "text" | "image-only" | "empty";
	markdown?: string;
}

export interface SlideAssembly {
	markdown: string;
	/** Pages that came out without text: caption these by hand (there is no OCR). */
	needsCaption: number[];
	slideCount: number;
}

const HEADING_RE = /^##\s+Slide\s+(\d+)\s*(?:[—–-]\s*(.*))?$/;

function firstLineTitle(markdown: string): string {
	for (const raw of markdown.split("\n")) {
		const line = raw.replace(/^#+\s*/, "").replace(/[*_`]/g, "").trim();
		if (line) return line.length > 80 ? `${line.slice(0, 77)}…` : line;
	}
	return "";
}

/** Assemble converted PDF pages into slides.md. */
export function assembleSlidesMarkdown(pages: SlidePage[], lectureTitle: string): SlideAssembly {
	const needsCaption: number[] = [];
	const parts = [`# ${lectureTitle}`, ""];
	for (const page of [...pages].sort((a, b) => a.number - b.number)) {
		const body = page.kind === "text" ? (page.markdown ?? "").trim() : "";
		if (!body) needsCaption.push(page.number);
		const title = firstLineTitle(body) || "(no text on this slide: add a one-line caption)";
		// Demote the page's own headings so only slide headings are level 2.
		const demoted = body.replace(/^(#{1,5})\s/gm, (_m, hashes: string) => `${"#".repeat(Math.min(6, hashes.length + 2))} `);
		parts.push(`## Slide ${page.number} — ${title}`, "", demoted, "");
	}
	return { markdown: `${parts.join("\n").trim()}\n`, needsCaption, slideCount: pages.length };
}

export interface SlideSection {
	number: number;
	title: string;
	body: string;
}

/** Split slides.md back into its slides. */
export function parseSlides(markdown: string): SlideSection[] {
	const out: SlideSection[] = [];
	let current: SlideSection | null = null;
	for (const line of markdown.split("\n")) {
		const m = HEADING_RE.exec(line.trim());
		if (m) {
			if (current) out.push(current);
			current = { number: Number(m[1]), title: (m[2] ?? "").trim(), body: "" };
		} else if (current) {
			current.body += `${line}\n`;
		}
	}
	if (current) out.push(current);
	return out.map((s) => ({ ...s, body: s.body.trim() }));
}

export function slideTitles(markdown: string): { number: number; title: string }[] {
	return parseSlides(markdown).map(({ number, title }) => ({ number, title }));
}

/** "(Slide 4)", "(Slides 4–5)", "(Slide 4, 6)" → [4, 5, 6] (sorted, unique). */
export function parseSlideRefs(text: string | undefined): number[] {
	if (!text) return [];
	const refs = new Set<number>();
	for (const m of text.matchAll(/\(\s*Slides?\s+([\d\s,–-]+(?:\s*(?:and|&)\s*\d+)?)\s*\)/gi)) {
		const spec = m[1]!.replace(/\s*(?:and|&)\s*/gi, ",");
		for (const part of spec.split(",")) {
			const range = part.trim().split(/\s*[–-]\s*/);
			const a = Number(range[0]);
			const b = range[1] !== undefined ? Number(range[1]) : a;
			if (!Number.isInteger(a) || !Number.isInteger(b) || a <= 0) continue;
			for (let n = Math.min(a, b); n <= Math.max(a, b) && n - Math.min(a, b) < 50; n++) refs.add(n);
		}
	}
	return [...refs].sort((x, y) => x - y);
}

export const estimateSlideTokens = (text: string): number => Math.ceil(text.length / 4);

/**
 * Trim slides to fit the opening message's budget (§6.3: keep them under
 * about 8k tokens). In order: drop speaker notes, drop lines repeated on
 * most slides (footers, course codes), collapse blank runs, then cut each
 * slide body evenly. Slide headings always survive, so citations stay valid.
 */
export function trimSlides(markdown: string, maxTokens: number): { markdown: string; trimmed: boolean } {
	const slides = parseSlides(markdown);
	if (slides.length === 0) {
		const fits = estimateSlideTokens(markdown) <= maxTokens;
		return { markdown: fits ? markdown : markdown.slice(0, maxTokens * 4), trimmed: !fits };
	}
	let trimmed = false;
	// 1. Speaker notes: everything after a "Notes:"/"Speaker notes" line within a slide.
	let bodies = slides.map((s) => {
		const idx = s.body.search(/^(?:#+\s*)?(?:speaker\s+)?notes\s*:?\s*$/im);
		if (idx >= 0) trimmed = true;
		return idx >= 0 ? s.body.slice(0, idx).trim() : s.body;
	});
	// 2. Repeated lines (footers): on more than half the slides, at least 3 slides.
	if (slides.length >= 3) {
		const counts = new Map<string, number>();
		for (const body of bodies) for (const line of new Set(body.split("\n").map((l) => l.trim()).filter(Boolean))) counts.set(line, (counts.get(line) ?? 0) + 1);
		const repeated = new Set([...counts].filter(([, n]) => n > slides.length / 2).map(([line]) => line));
		if (repeated.size > 0) {
			trimmed = true;
			bodies = bodies.map((b) => b.split("\n").filter((l) => !repeated.has(l.trim())).join("\n"));
		}
	}
	// 3. Collapse blank runs.
	bodies = bodies.map((b) => b.replace(/\n{3,}/g, "\n\n").trim());
	const render = (bs: string[]) =>
		`${slides.map((s, i) => `## Slide ${s.number}${s.title ? ` — ${s.title}` : ""}\n\n${bs[i]}`.trim()).join("\n\n")}\n`;
	let out = render(bodies);
	// 4. Even cut per slide until it fits.
	if (estimateSlideTokens(out) > maxTokens) {
		trimmed = true;
		const headingChars = slides.reduce((n, s) => n + s.title.length + 20, 0);
		const perSlide = Math.max(80, Math.floor((maxTokens * 4 - headingChars) / slides.length));
		bodies = bodies.map((b) => (b.length > perSlide ? `${b.slice(0, perSlide).trimEnd()}…` : b));
		out = render(bodies);
		if (estimateSlideTokens(out) > maxTokens) out = out.slice(0, maxTokens * 4);
	}
	return { markdown: out, trimmed };
}
