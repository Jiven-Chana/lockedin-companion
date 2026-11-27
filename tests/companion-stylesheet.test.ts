/**
 * The laptop stylesheet parses (v3.0). One stray brace stops every screen
 * from loading, and neither the type check nor lint reads CSS.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import postcss from "postcss";

const FILES = ["components/lockedin/lockedin.css", "relay/web/styles.css"];

describe("the stylesheets", () => {
	for (const f of FILES) {
		it(`${f} parses`, () => {
			const css = fs.readFileSync(path.join(import.meta.dirname, "..", f), "utf-8");
			assert.doesNotThrow(() => postcss.parse(css, { from: f }));
		});
	}
});
