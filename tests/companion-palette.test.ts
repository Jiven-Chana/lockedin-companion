/** The Focus palette engine: any seed hue gives readable text in light and dark (mvp1-plan §2.2). */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { contrastRatio, contrastTokens, tokenHex, moduleHue, paletteTokens, readAppearance, themeCss, timeOfDay, type ColorMode } from "../src/core/companion/index.ts";

const PAIRS: [string, string, number][] = [
	["ink", "surface", 4.5],
	["muted", "surface", 4.5],
	["ink", "surface-2", 4.5],
	["accent-ink", "accent", 4.5],
	["accent-text", "soft", 4.5],
	["deep-ink", "deep", 4.5],
	["deep-muted", "deep-panel", 4.5],
	["solid-ink", "solid-bg", 4.5],
	["revisit-ink", "revisit-bg", 4.5],
];

describe("paletteTokens", () => {
	for (const mode of ["light", "dark"] as ColorMode[]) {
		it(`text contrast ≥ 4.5:1 for every seed hue in ${mode} mode`, () => {
			for (let h = 0; h < 360; h += 10) {
				const t = paletteTokens(h, mode) as Record<string, string>;
				for (const [fg, bg, min] of PAIRS) {
					const r = contrastRatio(t[fg]!, t[bg]!);
					assert.ok(r >= min, `hue ${h} ${mode}: ${fg} on ${bg} is ${r.toFixed(2)}:1`);
				}
			}
		});
	}

	it("high contrast ignores the seed and passes 7:1", () => {
		const t = contrastTokens();
		assert.ok(contrastRatio(t.ink, t.surface) >= 7);
		assert.ok(contrastRatio(t["accent-ink"], t.accent) >= 7);
	});

	it("converts tokens to hex for libraries that can't parse oklch()", () => {
		assert.equal(tokenHex("oklch(1 0 0)"), "#ffffff");
		assert.equal(tokenHex("oklch(0 0 0)"), "#000000");
		assert.match(tokenHex(paletteTokens(285, "light").accent), /^#[0-9a-f]{6}$/);
		assert.equal(tokenHex("#ABCDEF"), "#abcdef");
	});

	it("status hues differ in lightness, not hue alone", () => {
		const t = paletteTokens(285, "light");
		assert.ok(contrastRatio(t.solid, t.revisit) > 1.3);
	});
});

describe("appearance and theme CSS", () => {
	it("reads the stored appearance, defaulting to system + auto", () => {
		assert.deepEqual(readAppearance(undefined), { theme: "system", hue: "auto", textSize: "normal", loose: false, reduceMotion: false });
		assert.equal(readAppearance({ theme: "dark", accent: "40" } as never).hue, 40);
		assert.equal(readAppearance({ accent: "blue" } as never).hue, "auto");
	});

	it("system mode emits both schemes behind a media query", () => {
		const css = themeCss(".li", readAppearance({ theme: "system" } as never));
		assert.match(css, /prefers-color-scheme: dark/);
		assert.match(css, /--li-ink:/);
		assert.doesNotMatch(themeCss(".li", readAppearance({ theme: "light" } as never)), /prefers-color-scheme/);
	});

	it("modules get stable, distinct hues; time of day follows the clock", () => {
		assert.equal(moduleHue("HCI"), 285);
		assert.equal(moduleHue("GT"), 160);
		assert.equal(moduleHue("COMP2001"), moduleHue("comp2001"));
		assert.equal(timeOfDay(new Date(2026, 10, 17, 7)), "dawn");
		assert.equal(timeOfDay(new Date(2026, 10, 17, 13)), "day");
		assert.equal(timeOfDay(new Date(2026, 10, 17, 19)), "dusk");
		assert.equal(timeOfDay(new Date(2026, 10, 17, 23)), "night");
	});
});
