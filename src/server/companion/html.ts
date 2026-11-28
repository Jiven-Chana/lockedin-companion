/**
 * A saved web page as course material (v3.1): its readable text as Markdown,
 * headings kept, so it splits into pages the way a Markdown file does.
 * Scripts, styles and the page's own furniture (menus, footers) are dropped.
 * Returns null when there is nothing worth reading.
 */

import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });
/** Less than this is a page that drew itself with a script, or an empty one. */
const MIN_TEXT = 40;

export function htmlToMarkdown(html: string): string | null {
	const page = /<html[\s>]/i.test(html) ? html : `<!doctype html><html><body>${html}</body></html>`;
	// Readability keeps the article and drops menus and footers. It takes its own copy: it changes the document it reads.
	let article: string | null = null;
	try {
		article = new Readability(parseHTML(page).document as unknown as Document).parse()?.content ?? null;
	} catch {
		article = null;
	}
	const { document } = parseHTML(page);
	for (const el of document.querySelectorAll("script, style, noscript, nav, footer, header, iframe, svg, form")) el.remove();
	const whole = document.body?.innerHTML ?? "";
	const pick = (source: string | null) => {
		if (!source) return null;
		const md = turndown.turndown(source).replace(/^(\s*)([-*]|\d+\.)\s{2,}/gm, "$1$2 ").replace(/\n{3,}/g, "\n\n").trim();
		return md.replace(/[#\s*_>-]/g, "").length >= MIN_TEXT ? md : null;
	};
	const fromArticle = pick(article);
	const fromWhole = pick(whole);
	// A page of notes with no article markup can lose most of itself to Readability: keep whichever read more.
	if (fromArticle && fromWhole) return fromWhole.length > fromArticle.length * 1.5 ? fromWhole : fromArticle;
	return fromArticle ?? fromWhole;
}
