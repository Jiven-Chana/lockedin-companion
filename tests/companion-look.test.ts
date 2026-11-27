/**
 * The Blocks look (v3.0): every colour is defined once and means one
 * thing. Mint is right and secured, lilac is your pick and to revisit, a
 * module's colour is that module, and text on a colour is always ink.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
	colourDistance,
	contrastRatio,
	LOOK,
	lookCss,
	lookTokens,
	MODULE_COLOUR_CHOICES,
	MODULE_COLOUR_ORDER,
	MODULE_COLOURS,
	MODULE_SHAPES,
	moduleLook,
	moduleTint,
	readAppearance,
	type LookMode,
} from "../src/core/companion/index.ts";

const MODES: LookMode[] = ["light", "dark", "contrast"];

describe("each colour means one thing", () => {
	it("mint and lilac are never a module's colour", () => {
		const hexes = Object.values(MODULE_COLOURS).map((h) => h.toUpperCase());
		assert.ok(!hexes.includes(LOOK.mint.toUpperCase()) && !hexes.includes(LOOK.lilac.toUpperCase()));
	});

	it("no default module colour can be mistaken for right, for to-revisit, or for another module", () => {
		const names = [...MODULE_COLOUR_ORDER];
		for (const a of names) {
			for (const [word, hex] of [["mint", LOOK.mint], ["lilac", LOOK.lilac]] as const) assert.ok(colourDistance(MODULE_COLOURS[a], hex) >= 0.11, `${a} is too near ${word}: ${colourDistance(MODULE_COLOURS[a], hex).toFixed(3)}`);
			for (const b of names) if (a < b) assert.ok(colourDistance(MODULE_COLOURS[a], MODULE_COLOURS[b]) >= 0.1, `${a} is too near ${b}: ${colourDistance(MODULE_COLOURS[a], MODULE_COLOURS[b]).toFixed(3)}`);
		}
	});

	it("there is no yellow by default, and no red anywhere", () => {
		assert.ok(!(MODULE_COLOUR_ORDER as readonly string[]).includes("sunflower"));
		assert.ok((MODULE_COLOUR_CHOICES as readonly string[]).includes("sunflower"), "yellow can still be picked");
		const reddish = (hex: string) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]; return r > 200 && g < 110 && b < 110; };
		for (const hex of [...Object.values(MODULE_COLOURS), LOOK.mint, LOOK.lilac]) assert.ok(!reddish(hex), hex);
	});
});

describe("text can be read on everything", () => {
	for (const mode of MODES) {
		it(`${mode}: body text, quiet text and the menu bar`, () => {
			const t = lookTokens(mode);
			for (const surface of [t.paper, t.card, t.sand]) assert.ok(contrastRatio(t.ink, surface) >= 7, `ink on ${surface}`);
			for (const surface of [t.paper, t.card]) assert.ok(contrastRatio(t.quiet, surface) >= 4.5, `quiet on ${surface}`);
			assert.ok(contrastRatio(t["bar-ink"], t.bar) >= 7);
		});
		it(`${mode}: text on a colour is always ink, and always readable`, () => {
			const t = lookTokens(mode);
			assert.equal(t.on.toUpperCase(), LOOK.ink.toUpperCase());
			for (const hex of [t.mint, t.lilac, ...Object.values(MODULE_COLOURS)]) assert.ok(contrastRatio(t.on, hex) >= 4.5, `ink on ${hex}`);
		});
		it(`${mode}: a module's soft tint (lectures in the week) keeps its text readable`, () => {
			for (const name of MODULE_COLOUR_CHOICES) {
				const tint = moduleTint(name, mode);
				assert.ok(contrastRatio(tint.softInk, tint.soft) >= 7, `${name}: ${tint.softInk} on ${tint.soft}`);
			}
		});
	}
});

describe("which colour and shape a module gets", () => {
	const modules = ["HCI", "GT", "NC", "RAC", "LALP", "RSIM", "EXTRA"].map((code) => ({ code }));

	it("in the order of the student's modules; the seventh starts the list again", () => {
		assert.deepEqual(modules.map((m) => moduleLook(m.code, modules).colour), [...MODULE_COLOUR_ORDER, MODULE_COLOUR_ORDER[0]]);
		assert.deepEqual(modules.slice(0, 6).map((m) => moduleLook(m.code, modules).shape), [...MODULE_SHAPES]);
	});

	const cases: { name: string; code: string; list: { code: string; colour?: string }[]; want: string }[] = [
		{ name: "a colour the student picked wins", code: "GT", list: [{ code: "HCI" }, { code: "GT", colour: "sunflower" }], want: "sunflower" },
		{ name: "a colour that does not exist is ignored", code: "GT", list: [{ code: "HCI" }, { code: "GT", colour: "crimson" }], want: MODULE_COLOUR_ORDER[1] },
		{ name: "mint and lilac cannot be picked", code: "HCI", list: [{ code: "HCI", colour: "mint" }], want: MODULE_COLOUR_ORDER[0] },
		{ name: "upper and lower case are the same module", code: "hci", list: [{ code: "HCI" }, { code: "GT" }], want: MODULE_COLOUR_ORDER[0] },
	];
	for (const c of cases) it(c.name, () => assert.equal(moduleLook(c.code, c.list).colour, c.want));

	it("a module that is not in the list still gets a colour, the same one every time", () => {
		const a = moduleLook("study", modules), b = moduleLook("study", modules);
		assert.deepEqual(a, b);
		assert.ok((MODULE_COLOUR_ORDER as readonly string[]).includes(a.colour));
	});
});

describe("the look as CSS", () => {
	it("system mode gives both light and dark, so nothing flashes; a fixed mode gives one", () => {
		const system = lookCss(".li", readAppearance({ theme: "system" } as never));
		assert.match(system, /prefers-color-scheme: dark/);
		assert.match(system, new RegExp(`--li-paper:${LOOK.light.paper}`));
		assert.match(system, new RegExp(`--li-paper:${LOOK.dark.paper}`));
		assert.doesNotMatch(lookCss(".li", readAppearance({ theme: "light" } as never)), /prefers-color-scheme/);
		assert.match(lookCss(".li", readAppearance({ theme: "contrast" } as never)), /--li-paper:#000000/);
	});

	it("carries every module colour as a class, in each mode, so a region can take a module's colour", () => {
		const css = lookCss(".li", readAppearance({ theme: "system" } as never));
		for (const name of MODULE_COLOUR_CHOICES) assert.equal(css.split(`.li-mod-${name}{`).length - 1, 2, name);
		assert.match(css, new RegExp(`\\.li-mod-tangerine\\{--li-mod:${MODULE_COLOURS.tangerine};`));
	});

	it("a theme colour picked before v3.0 is read and no longer changes anything", () => {
		const a = lookCss(".li", readAppearance({ theme: "light", accent: "40" } as never));
		const b = lookCss(".li", readAppearance({ theme: "light", accent: "auto" } as never));
		assert.equal(a, b);
	});
});

describe("colours are written in one place", () => {
	const ROOT = path.join(import.meta.dirname, "..");
	const files = (dir: string, ext: RegExp): string[] => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name), ext) : ext.test(e.name) ? [path.join(dir, e.name)] : []));
	// Printed things stay black on white in every theme: a slide, a PDF page, the pairing QR code.
	const PRINTED = /#fff(?:fff)?\b|#000(?:000)?\b/gi;
	const COLOUR = /#[0-9a-f]{3,8}\b|\brgba?\(|\boklch\(|\bhsla?\(/gi;

	it("no colour is written in the laptop app's screens or stylesheet: they all come from the look", () => {
		const found: string[] = [];
		for (const f of files("components/lockedin", /\.(tsx|ts|css)$/)) {
			const text = fs.readFileSync(path.join(ROOT, f), "utf-8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
			text.split("\n").forEach((line, i) => {
				if (/li-allow-colour/.test(line)) return;
				const hits = (line.replace(PRINTED, "").match(COLOUR) ?? []).filter((h) => !/^#\d+$/.test(h) || h.length > 5);
				// "#1" in text ("question #1") is not a colour.
				for (const h of hits) if (!/^#\d{1,2}$/.test(h)) found.push(`${f}:${i + 1} ${h}`);
			});
		}
		assert.deepEqual(found, []);
	});
});
