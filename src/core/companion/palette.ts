/**
 * The "Focus" palette engine (docs/companion/mvp1-plan.md §2.2): every
 * colour in the LockedIn app is generated in OKLCH from ONE seed hue, for
 * light or dark mode, with a fixed high-contrast override. Pure and
 * browser-safe; tests/companion-palette.test.ts checks contrast for every hue.
 *
 *   paletteTokens(hue, mode)        the token set (CSS custom property values)
 *   themeCss(selector, appearance)  CSS text for a root, incl. "system" mode
 *   moduleHue(code)                 each module's own hue (Auto colour)
 *   timeOfDay(date)                 dawn | day | dusk | night (ambient layer)
 */

import { MOTION_CHOICES, type MotionChoice, type Profile } from "./types.ts";

export type ColorMode = "light" | "dark";
export type TimeOfDay = "dawn" | "day" | "dusk" | "night";
export type ThemeChoice = "light" | "dark" | "system" | "contrast";

export const DEFAULT_SEED_HUE = 285;

/** Known module hues (adjustable later per profile); anything else is hashed. */
const MODULE_HUES: Record<string, number> = { HCI: 285, GT: 160 };

const wrap = (h: number) => ((Math.round(h) % 360) + 360) % 360;
const ok = (l: number, c: number, h: number, alpha?: number) =>
	`oklch(${l} ${c} ${wrap(h)}${alpha === undefined ? "" : ` / ${alpha}`})`;

export const TOKEN_NAMES = [
	"bg-a", "bg-b", "rail", "surface", "surface-2", "ink", "muted", "line", "accent", "accent-ink",
	"accent-text", "soft", "shadow", "deep", "deep-b", "deep-ink", "deep-muted", "deep-line",
	"deep-accent", "deep-soft", "deep-panel", "solid", "solid-bg", "solid-ink", "revisit", "revisit-bg",
	"revisit-ink", "notyet",
] as const;
export type TokenName = (typeof TOKEN_NAMES)[number];
export type Tokens = Record<TokenName, string>;

function ambient(h: number, mode: ColorMode, tod: TimeOfDay): [string, string] {
	if (mode === "dark") {
		const lift = tod === "night" ? 0 : tod === "dusk" ? 0.01 : 0.02;
		return [ok(0.22 + lift, 0.045, h), ok(0.16 + lift, 0.035, h + 25)];
	}
	switch (tod) {
		case "dawn": return [ok(0.965, 0.04, h + 55), ok(0.985, 0.015, h)];
		case "dusk": return [ok(0.93, 0.05, h - 40), ok(0.96, 0.035, h + 10)];
		case "night": return [ok(0.9, 0.03, h), ok(0.93, 0.02, h + 20)]; // quiet hours in light mode: dimmed
		default: return [ok(0.99, 0.012, h), ok(0.97, 0.025, h + 25)];
	}
}

export function paletteTokens(hue: number, mode: ColorMode, tod: TimeOfDay = "day"): Tokens {
	const h = wrap(hue);
	const [bgA, bgB] = ambient(h, mode, tod);
	const dark = mode === "dark";
	return {
		"bg-a": bgA,
		"bg-b": bgB,
		rail: dark ? ok(0.21, 0.035, h, 0.85) : ok(0.995, 0.008, h, 0.65),
		surface: dark ? ok(0.27, 0.035, h) : ok(0.995, 0.006, h),
		"surface-2": dark ? ok(0.31, 0.04, h) : ok(0.975, 0.012, h),
		ink: dark ? ok(0.96, 0.01, h) : ok(0.23, 0.035, h),
		muted: dark ? ok(0.8, 0.03, h) : ok(0.45, 0.035, h),
		line: dark ? ok(0.4, 0.04, h) : ok(0.9, 0.022, h),
		accent: dark ? ok(0.8, 0.12, h) : ok(0.5, 0.16, h),
		"accent-ink": dark ? ok(0.2, 0.04, h) : "#ffffff",
		"accent-text": dark ? ok(0.88, 0.08, h) : ok(0.4, 0.14, h),
		soft: dark ? ok(0.35, 0.06, h) : ok(0.945, 0.04, h),
		shadow: dark ? "rgba(0, 0, 0, 0.4)" : ok(0.5, 0.08, h, 0.14),
		deep: dark ? ok(0.24, 0.07, h) : ok(0.3, 0.09, h),
		"deep-b": dark ? ok(0.12, 0.04, h + 30) : ok(0.14, 0.05, h + 30),
		"deep-ink": ok(0.97, 0.01, h),
		"deep-muted": ok(0.82, 0.04, h),
		"deep-line": ok(0.42, 0.07, h),
		"deep-accent": ok(0.84, 0.13, h),
		"deep-soft": ok(0.36, 0.07, h),
		"deep-panel": ok(0.22, 0.06, h),
		// Status: blue vs orange, differing in lightness too, always with an icon (never red, never alone).
		solid: dark ? ok(0.78, 0.1, 240) : ok(0.5, 0.12, 240),
		"solid-bg": dark ? ok(0.32, 0.06, 240) : ok(0.94, 0.035, 240),
		"solid-ink": dark ? ok(0.92, 0.04, 240) : ok(0.3, 0.08, 240),
		revisit: dark ? ok(0.8, 0.12, 60) : ok(0.6, 0.15, 50),
		"revisit-bg": dark ? ok(0.33, 0.06, 55) : ok(0.96, 0.045, 60),
		"revisit-ink": dark ? ok(0.92, 0.06, 60) : ok(0.4, 0.11, 50),
		notyet: dark ? ok(0.6, 0.02, h) : ok(0.8, 0.02, h),
	};
}

/** High contrast ignores the seed (behaviour-change §6: per-person, not a diagnosis-shaped default). */
export function contrastTokens(): Tokens {
	const t = {} as Tokens;
	for (const n of TOKEN_NAMES) t[n] = "#000000";
	return {
		...t,
		"bg-a": "#000000", "bg-b": "#000000", rail: "#000000", surface: "#000000", "surface-2": "#111111",
		ink: "#ffffff", muted: "#f2f2f2", line: "#ffffff", accent: "#ffe14d", "accent-ink": "#000000",
		"accent-text": "#ffe14d", soft: "#222222", shadow: "transparent", deep: "#000000", "deep-b": "#000000",
		"deep-ink": "#ffffff", "deep-muted": "#f2f2f2", "deep-line": "#ffffff", "deep-accent": "#ffe14d",
		"deep-soft": "#222222", "deep-panel": "#000000", solid: "#7dd3fc", "solid-bg": "#000000", "solid-ink": "#7dd3fc",
		revisit: "#fdba74", "revisit-bg": "#000000", "revisit-ink": "#fdba74", notyet: "#bbbbbb",
	};
}

export function moduleHue(code: string): number {
	const known = MODULE_HUES[code.toUpperCase()];
	if (known !== undefined) return known;
	let h = 0;
	for (const ch of code.toUpperCase()) h = (h * 31 + ch.charCodeAt(0)) % 360;
	return h;
}

export function timeOfDay(d: Date): TimeOfDay {
	const hr = d.getHours();
	if (hr >= 5 && hr < 10) return "dawn";
	if (hr >= 10 && hr < 17) return "day";
	if (hr >= 17 && hr < 22) return "dusk";
	return "night";
}

/** The appearance record (Profile.appearance) read as Focus settings. `accent` holds "auto" or a hue in degrees. */
export interface FocusAppearance {
	theme: ThemeChoice;
	hue: number | "auto";
	textSize: "normal" | "large" | "xlarge";
	loose: boolean;
	motion: MotionChoice;
}

/** Old profiles (v0.0) have `reduceMotion: boolean` instead of `motion` (F-118): reduce → Off, otherwise Calm. */
export function migrateAppearance<T extends Partial<Profile["appearance"]> & { reduceMotion?: unknown }>(a: T): Omit<T, "reduceMotion"> & { motion: MotionChoice } {
	const { reduceMotion, ...rest } = a;
	const motion = MOTION_CHOICES.includes(a.motion as MotionChoice) ? (a.motion as MotionChoice) : reduceMotion === true ? "off" : "calm";
	return { ...rest, motion };
}

export function readAppearance(a: Partial<Profile["appearance"]> | null | undefined): FocusAppearance {
	const theme: ThemeChoice = a?.theme === "dark" || a?.theme === "light" || a?.theme === "contrast" ? a.theme : "system";
	const n = Number(a?.accent);
	return {
		theme,
		hue: a?.accent && a.accent !== "auto" && Number.isFinite(n) ? wrap(n) : "auto",
		textSize: a?.textSize === "large" || a?.textSize === "xlarge" ? a.textSize : "normal",
		loose: a?.lineSpacing === "loose",
		motion: migrateAppearance(a ?? {}).motion,
	};
}

const decl = (t: Tokens) => TOKEN_NAMES.map((n) => `--li-${n}:${t[n]};`).join("");

/** CSS for a themed root. "system" emits both modes behind prefers-color-scheme, so there is no flash. */
export function themeCss(selector: string, appearance: FocusAppearance, opts: { hue?: number; tod?: TimeOfDay } = {}): string {
	const hue = opts.hue ?? (appearance.hue === "auto" ? DEFAULT_SEED_HUE : appearance.hue);
	const tod = opts.tod ?? "day";
	if (appearance.theme === "contrast") return `${selector}{${decl(contrastTokens())}color-scheme:dark;}`;
	if (appearance.theme === "system") {
		return `${selector}{${decl(paletteTokens(hue, "light", tod))}color-scheme:light;}@media (prefers-color-scheme: dark){${selector}{${decl(paletteTokens(hue, "dark", tod))}color-scheme:dark;}}`;
	}
	return `${selector}{${decl(paletteTokens(hue, appearance.theme, tod))}color-scheme:${appearance.theme};}`;
}

// ─── contrast (for tests and guards) ─────────────────────────────────────────

/** OKLCH → relative luminance (WCAG), via OKLab and linear sRGB, clamped to gamut. */
export function oklchLuminance(l: number, c: number, h: number): number {
	const hr = (h * Math.PI) / 180;
	const a = c * Math.cos(hr);
	const b = c * Math.sin(hr);
	const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
	const clamp = (x: number) => Math.min(1, Math.max(0, x));
	const r = clamp(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_);
	const g = clamp(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_);
	const bl = clamp(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_);
	return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
}

/** Luminance of a token value we generate ("oklch(l c h[ / a])", "#rrggbb"). */
export function tokenLuminance(value: string): number {
	const m = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)/.exec(value);
	if (m) return oklchLuminance(Number(m[1]), Number(m[2]), Number(m[3]));
	const hex = /^#([0-9a-f]{6})$/i.exec(value);
	if (!hex) throw new Error(`cannot measure ${value}`);
	const ch = (i: number) => {
		const v = parseInt(hex[1]!.slice(i, i + 2), 16) / 255;
		return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * ch(0) + 0.7152 * ch(2) + 0.0722 * ch(4);
}

export function contrastRatio(a: string, b: string): number {
	const [x, y] = [tokenLuminance(a), tokenLuminance(b)].sort((p, q) => q - p) as [number, number];
	return (x + 0.05) / (y + 0.05);
}

/** A generated token as #rrggbb, for libraries that can't parse oklch() (mermaid's colour parser). */
export function tokenHex(value: string): string {
	const v = value.trim();
	if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
	const m = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)/.exec(v);
	if (!m) return "#888888";
	const [l, c, h] = [Number(m[1]), Number(m[2]), (Number(m[3]) * Math.PI) / 180];
	const a = c * Math.cos(h);
	const b = c * Math.sin(h);
	const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
	const lin = [
		4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
		-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
		-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
	];
	const enc = (x: number) => {
		const y = Math.min(1, Math.max(0, x));
		const s = y <= 0.0031308 ? 12.92 * y : 1.055 * y ** (1 / 2.4) - 0.055;
		return Math.round(s * 255).toString(16).padStart(2, "0");
	};
	return `#${lin.map(enc).join("")}`;
}
