/**
 * Mermaid flowcharts as the AI writes them (v1.0.1). A label with brackets
 * in it, such as `D[None: calculate d(A)]`, is a syntax error unless the
 * label is quoted, and the screen then shows the diagram's source instead of
 * the diagram. `safeMermaid` quotes every unquoted label of a flowchart, so
 * what the label says can no longer break how the diagram is read.
 *
 * Only flowcharts ("graph" and "flowchart") are touched: other diagram
 * types have their own grammar, and every diagram seen failing was one.
 */

const FLOWCHART = /^\s*(?:graph|flowchart)\b/i;

const quoted = (label: string) => `"${label.trim().replace(/"/g, "'")}"`;

/** Labels already written as "…", and the multi-character shapes ([[…]], [(…)], [/…/], {{…}}), are left alone. */
const SQUARE = /([A-Za-z0-9_-]+)\[(?!["[(/\\])([^\]\n]*)\](?!\])/g;
const DIAMOND = /([A-Za-z0-9_-]+)\{(?!["{])([^{}\n]*)\}(?!\})/g;
const EDGE = /\|(?!")([^|\n"]*)\|/g;

export function safeMermaid(source: string): string {
	const lines = source.split("\n");
	const head = lines.findIndex((l) => l.trim() !== "");
	if (head < 0 || !FLOWCHART.test(lines[head]!)) return source;
	return lines
		.map((line, i) => {
			if (i <= head) return line;
			// Styling lines hold colours and class names, never labels.
			if (/^\s*(?:classDef|class|style|linkStyle|click|subgraph|end|direction|%%)\b/.test(line)) return line;
			return line
				.replace(SQUARE, (_m, id: string, label: string) => `${id}[${quoted(label)}]`)
				.replace(DIAMOND, (_m, id: string, label: string) => `${id}{${quoted(label)}}`)
				.replace(EDGE, (_m, label: string) => `|${quoted(label)}|`);
		})
		.join("\n");
}
