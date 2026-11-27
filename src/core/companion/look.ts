/**
 * The Blocks look (v3.0, V-80): every colour LockedIn shows, defined once
 * and used by the laptop app, the phone app and the diagrams. Pure and
 * browser-safe; tests/companion-look.test.ts holds it to its rules.
 *
 * Each colour means one thing:
 *   mint     right, secured, done
 *   lilac    your pick when it was not the answer; an idea to revisit
 *   a module colour   that module, and nothing else
 *   ink, paper, card, sand   text and outlines, the page, reading surfaces, grid lines
 * There is no red. Text on a colour is always ink, in light and in dark.
 * A state is never colour alone: a shape and a word go with it.
 */

import type { FocusAppearance } from "./palette.ts";

export type LookMode = "light" | "dark" | "contrast";

export const LOOK = {
	/** Text on any colour, in every mode. */
	ink: "#1F1B2D",
	mint: "#7BE0AE",
	lilac: "#CDBEFF",
	light: { paper: "#FFF3DC", card: "#FFFDF8", sand: "#F1DFBC", text: "#1F1B2D", quiet: "#4B4560", edge: "#1F1B2D", bar: "#1F1B2D", barText: "#FFF3DC" },
	dark: { paper: "#17141F", card: "#262233", sand: "#3A3550", text: "#FFF6E3", quiet: "#B9B2CC", edge: "#0B0A10", bar: "#0B0A10", barText: "#FFF6E3" },
	contrast: { paper: "#000000", card: "#000000", sand: "#2A2A2A", text: "#FFFFFF", quiet: "#F2F2F2", edge: "#FFFFFF", bar: "#000000", barText: "#FFFFFF" },
} as const;

/** A module's colour block. Bright, and far enough from mint and lilac that a module never looks "right" or "to revisit". */
export const MODULE_COLOURS = {
	tangerine: "#FF9248",
	rose: "#FF94BC",
	sky: "#5AAEFF",
	lime: "#D0E84E",
	aqua: "#22C3CF",
	orchid: "#E27FEA",
	sunflower: "#FFD037",
} as const;
export type ModuleColour = keyof typeof MODULE_COLOURS;
/** The colours modules get, in the order of the student's modules. No yellow by default (look test, 27 Nov). */
export const MODULE_COLOUR_ORDER = ["tangerine", "rose", "sky", "lime", "aqua", "orchid"] as const satisfies readonly ModuleColour[];
/** What a student can pick for a module in Me. */
export const MODULE_COLOUR_CHOICES = [...MODULE_COLOUR_ORDER, "sunflower"] as const satisfies readonly ModuleColour[];
/** A module's mark: a simple shape with its colour, so a module is never told apart by colour alone. */
export const MODULE_SHAPES = ["circle", "triangle", "square", "diamond", "hexagon", "star"] as const;
export type ModuleShape = (typeof MODULE_SHAPES)[number];

/**
 * A module's colour and shape: the colour the student picked, else by the
 * module's place in their list. A code that is not in the list (free study)
 * still gets one, the same every time.
 */
export function moduleLook(code: string, modules: readonly { code: string; colour?: string }[]): { colour: ModuleColour; shape: ModuleShape } {
	const key = code.toUpperCase();
	let i = modules.findIndex((m) => m.code.toUpperCase() === key);
	const picked = i >= 0 ? modules[i]!.colour : undefined;
	if (i < 0) {
		let h = 0;
		for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) % 9973;
		i = h;
	}
	const colour = picked && (MODULE_COLOUR_CHOICES as readonly string[]).includes(picked) ? (picked as ModuleColour) : MODULE_COLOUR_ORDER[i % MODULE_COLOUR_ORDER.length]!;
	return { colour, shape: MODULE_SHAPES[i % MODULE_SHAPES.length]! };
}

// ─── colour arithmetic ───────────────────────────────────────────────────────

const channels = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const linear = (v: number) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };

/** `amount` of `a` laid over `b`, as #RRGGBB. */
export function mixHex(a: string, b: string, amount: number): string {
	const [x, y] = [channels(a), channels(b)];
	return `#${x.map((v, i) => Math.round(v * amount + y[i]! * (1 - amount)).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

/** How far apart two colours look (distance in OKLab; about 0.02 is just noticeable). */
export function colourDistance(a: string, b: string): number {
	const lab = (hex: string) => {
		const [r, g, bl] = channels(hex).map(linear) as [number, number, number];
		const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * bl);
		const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * bl);
		const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * bl);
		return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
	};
	const [p, q] = [lab(a), lab(b)];
	return Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!, p[2]! - q[2]!);
}

/**
 * A module's colours in a mode: the bright block, and a soft tint for things
 * that only show (a lecture in the week). On the bright block text is ink;
 * on the soft tint it is the page's own text colour.
 */
export function moduleTint(name: ModuleColour, mode: LookMode): { bright: string; soft: string; softInk: string } {
	const bright = MODULE_COLOURS[name];
	const base = LOOK[mode];
	return { bright, soft: mode === "contrast" ? base.card : mixHex(bright, base.card, mode === "dark" ? 0.26 : 0.36), softInk: base.text };
}

// ─── tokens ──────────────────────────────────────────────────────────────────

export const LOOK_TOKEN_NAMES = [
	"paper", "card", "sand", "ink", "quiet", "edge", "bar", "bar-ink", "bar-quiet", "bar-line", "bar-soft", "on", "on-card", "mint", "lilac",
	"mint-soft", "lilac-soft", "mod", "mod-soft", "mod-soft-ink",
] as const;
export type LookToken = (typeof LOOK_TOKEN_NAMES)[number];
export type LookTokens = Record<LookToken, string>;

/** Every colour of a mode, as CSS custom property values (`--li-<name>`). */
export function lookTokens(mode: LookMode): LookTokens {
	const b = LOOK[mode];
	const soft = (hex: string) => (mode === "contrast" ? b.card : mixHex(hex, b.card, mode === "dark" ? 0.26 : 0.36));
	return {
		paper: b.paper,
		card: b.card,
		sand: b.sand,
		ink: b.text,
		quiet: b.quiet,
		edge: b.edge,
		bar: b.bar,
		"bar-ink": b.barText,
		"bar-quiet": mixHex(b.barText, b.bar, 0.74),
		"bar-line": mixHex(b.barText, b.bar, 0.36),
		"bar-soft": mixHex(b.barText, b.bar, 0.16),
		on: LOOK.ink,
		// The reading surface on a colour (a button, a tile): light in every mode, because the colour under it never changes.
		"on-card": LOOK.light.card,
		mint: LOOK.mint,
		lilac: LOOK.lilac,
		"mint-soft": soft(LOOK.mint),
		"lilac-soft": soft(LOOK.lilac),
		// Outside a module's region there is no module colour: sand stands in.
		mod: b.sand,
		"mod-soft": b.sand,
		"mod-soft-ink": b.text,
	};
}

/**
 * The names the stylesheet used before v3.0, pointed at the look. Kept so a
 * screen that has not been redrawn yet still takes every colour from here.
 */
const LEGACY: Record<string, string> = {
	"bg-a": "paper", "bg-b": "paper", rail: "bar", surface: "card", "surface-2": "sand", muted: "quiet", line: "sand",
	accent: "ink", "accent-ink": "paper", "accent-text": "ink", soft: "sand", shadow: "edge",
	deep: "bar", "deep-b": "bar", "deep-ink": "bar-ink", "deep-muted": "bar-quiet", "deep-line": "bar-line", "deep-accent": "mint", "deep-soft": "bar-soft", "deep-panel": "bar",
	solid: "edge", "solid-bg": "mint", "solid-ink": "on", revisit: "edge", "revisit-bg": "lilac", "revisit-ink": "on", notyet: "quiet",
};

function declarations(mode: LookMode): string {
	const t = lookTokens(mode);
	return LOOK_TOKEN_NAMES.map((n) => `--li-${n}:${t[n]};`).join("") + Object.entries(LEGACY).map(([old, now]) => `--li-${old}:var(--li-${now});`).join("");
}
function moduleClasses(selector: string, mode: LookMode): string {
	return MODULE_COLOUR_CHOICES.map((name) => {
		const t = moduleTint(name, mode);
		return `${selector} .li-mod-${name}{--li-mod:${t.bright};--li-mod-soft:${t.soft};--li-mod-soft-ink:${t.softInk};}`;
	}).join("");
}
const block = (selector: string, mode: LookMode) => `${selector}{${declarations(mode)}color-scheme:${mode === "light" ? "light" : "dark"};}${moduleClasses(selector, mode)}`;

/** CSS for a root in the Blocks look. "system" gives both modes behind prefers-color-scheme, so nothing flashes. */
export function lookCss(selector: string, appearance: Pick<FocusAppearance, "theme">): string {
	if (appearance.theme === "contrast") return block(selector, "contrast");
	if (appearance.theme === "system") return `${block(selector, "light")}@media (prefers-color-scheme: dark){${block(selector, "dark")}}`;
	return block(selector, appearance.theme);
}

// ─── the phone ───────────────────────────────────────────────────────────────

/** The marks round the phone stylesheet's colours (relay/web/styles.css). What lies between them is written by `phoneLookCss`, never by hand. */
export const PHONE_LOOK_MARKS = ["/* look:start (written from src/core/companion/look.ts by relay/scripts/look.ts; do not edit) */", "/* look:end */"] as const;

/**
 * The phone app's colours: the same look, as plain custom properties
 * (`--paper`, `--mod`, …) for a stylesheet that is served as a static file.
 * The phone follows the system for light and dark. tests/companion-look.test.ts
 * fails when the phone's stylesheet does not hold exactly this.
 */
export function phoneLookCss(): string {
	const names: LookToken[] = ["paper", "card", "sand", "ink", "quiet", "edge", "bar", "bar-ink", "bar-quiet", "on", "on-card", "mint", "lilac"];
	const root = (mode: LookMode) => { const t = lookTokens(mode); return names.map((n) => `--${n}: ${t[n]};`).join(" ") + ` --mod: ${t.sand}; --mod-soft: ${t.sand}; --mod-soft-ink: ${t.ink};`; };
	const mods = (mode: LookMode) => MODULE_COLOUR_CHOICES.map((name) => { const t = moduleTint(name, mode); return `.mod-${name} { --mod: ${t.bright}; --mod-soft: ${t.soft}; --mod-soft-ink: ${t.softInk}; }`; });
	return [
		PHONE_LOOK_MARKS[0],
		`:root { ${root("light")} color-scheme: light dark; }`,
		...mods("light"),
		"@media (prefers-color-scheme: dark) {",
		`\t:root { ${root("dark")} }`,
		...mods("dark").map((l) => `\t${l}`),
		"}",
		PHONE_LOOK_MARKS[1],
	].join("\n");
}
