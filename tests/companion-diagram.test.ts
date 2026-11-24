/**
 * Diagram labels can't break the diagram (v1.0.1). From Jiven's own packs:
 * 1 of 63 explainer diagrams failed to draw, on `D[None: calculate d(A)]`.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { safeMermaid } from "../src/core/companion/index.ts";

describe("safeMermaid quotes a flowchart's labels", () => {
	const cases: Array<[string, string, string]> = [
		["the label that failed", "flowchart LR\n B --> D[None: calculate d(A)]", 'flowchart LR\n B --> D["None: calculate d(A)"]'],
		["two nodes on one line", "graph TD\n A[Payoff u(x, y)] --> B[Best response]", 'graph TD\n A["Payoff u(x, y)"] --> B["Best response"]'],
		["a decision", "flowchart TD\n C{Is d(A) > 0?} --> D[Stop]", 'flowchart TD\n C{"Is d(A) > 0?"} --> D["Stop"]'],
		["a label on an arrow", "flowchart LR\n A -->|v(S) rises| B", 'flowchart LR\n A -->|"v(S) rises"| B'],
		["a quote inside a label", 'flowchart LR\n A[The "core" of v] --> B', "flowchart LR\n A[\"The 'core' of v\"] --> B"],
		["already quoted is left alone", 'flowchart LR\n A["u(x)"] -->|"d(A)"| B{"ok?"}', 'flowchart LR\n A["u(x)"] -->|"d(A)"| B{"ok?"}'],
		["other shapes are left alone", "flowchart LR\n A[[Sub]] --> B[(Store)] --> C{{Prep}} --> D[/In/]", "flowchart LR\n A[[Sub]] --> B[(Store)] --> C{{Prep}} --> D[/In/]"],
		["round nodes are left alone", "flowchart LR\n A(Start) --> B((End))", "flowchart LR\n A(Start) --> B((End))"],
		["styling lines are left alone", "graph TD\n A[One]\n classDef solid fill:#fff,stroke:#000\n class A solid", 'graph TD\n A["One"]\n classDef solid fill:#fff,stroke:#000\n class A solid'],
		["the concept map's own labels", 'graph TD\n  core["the core · S92, S93"]\n  core --> stable-sets', 'graph TD\n  core["the core · S92, S93"]\n  core --> stable-sets'],
	];
	for (const [name, source, expected] of cases) it(name, () => assert.equal(safeMermaid(source), expected));

	it("other diagram types are not touched", () => {
		for (const source of ["mindmap\n  root((Games))\n    Nash[Nash d(A)]", "sequenceDiagram\n A->>B: v(S)", "timeline\n 1944 : von Neumann [book]", "stateDiagram-v2\n [*] --> Open"]) assert.equal(safeMermaid(source), source);
	});

	it("making it safe twice changes nothing more", () => {
		for (const [, source] of cases) assert.equal(safeMermaid(safeMermaid(source)), safeMermaid(source));
	});

	it("empty or odd input comes back as it was", () => {
		for (const source of ["", "\n\n", "not a diagram [at all]"]) assert.equal(safeMermaid(source), source);
	});
});
