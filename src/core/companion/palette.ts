/**
 * The student's appearance settings, and colour measuring. Until v3.0 this
 * file generated every colour from one seed hue ("Focus"); the colours now
 * live in look.ts (the Blocks look), and what is left here reads the stored
 * settings and measures contrast for the tests.
 *
 *   readAppearance(a)               the stored settings as theme, text size, spacing, motion
 *   themeCss(selector, appearance)  CSS text for a root (the Blocks look)
 *   contrastRatio(a, b)             WCAG contrast of two colours
 *   moduleHue, timeOfDay            kept for data and screens from before v3.0
 */

import { lookCss } from "./look.ts";
import { MOTION_CHOICES, type MotionChoice, type Profile } from "./types.ts";

export type ColorMode = "light" | "dark";
export type TimeOfDay = "dawn" | "day" | "dusk" | "night";
export type ThemeChoice = "light" | "dark" | "system" | "contrast";

/** Known module hues (adjustable later per profile); anything else is hashed. */
const MODULE_HUES: Record<string, number> = { HCI: 285, GT: 160 };

const wrap = (h: number) => ((Math.round(h) % 360) + 360) % 360;
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

/**
 * CSS for a themed root. Since v3.0 every colour comes from the Blocks look
 * (look.ts): the seed hue and the time of day no longer change anything.
 */
export function themeCss(selector: string, appearance: FocusAppearance): string {
	return lookCss(selector, appearance);
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
