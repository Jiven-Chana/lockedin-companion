/**
 * The stored appearance settings and the colour measuring that the look's
 * tests use. The colours themselves are tested in companion-look.test.ts.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { contrastRatio, moduleHue, readAppearance, themeCss, timeOfDay, tokenHex } from "../src/core/companion/index.ts";

describe("appearance", () => {
	it("reads the stored appearance, defaulting to system", () => {
		assert.deepEqual(readAppearance(null), { theme: "system", hue: "auto", textSize: "normal", loose: false, motion: "calm" });
		assert.equal(readAppearance({ theme: "dark", accent: "40" } as never).hue, 40);
		assert.equal(readAppearance({ accent: "blue" } as never).hue, "auto");
	});

	it("system mode emits both schemes behind a media query", () => {
		const css = themeCss(".li", readAppearance({ theme: "system" } as never));
		assert.match(css, /prefers-color-scheme: dark/);
		assert.doesNotMatch(themeCss(".li", readAppearance({ theme: "light" } as never)), /prefers-color-scheme/);
	});
});

describe("colour measuring", () => {
	it("contrast is the WCAG ratio, either way round", () => {
		assert.equal(Math.round(contrastRatio("#000000", "#ffffff")), 21);
		assert.equal(contrastRatio("#000000", "#ffffff"), contrastRatio("#ffffff", "#000000"));
		assert.equal(contrastRatio("#777777", "#777777"), 1);
	});

	it("converts a generated colour to hex for libraries that need it", () => {
		assert.match(tokenHex("oklch(0.5 0.16 285)"), /^#[0-9a-f]{6}$/);
		assert.equal(tokenHex("#AABBCC"), "#aabbcc");
	});
});

describe("kept from before v3.0", () => {
	it("a module's hue is stable; time of day follows the clock", () => {
		assert.equal(moduleHue("HCI"), moduleHue("hci"));
		assert.equal(timeOfDay(new Date(2026, 10, 17, 7)), "dawn");
		assert.equal(timeOfDay(new Date(2026, 10, 17, 23)), "night");
	});
});
