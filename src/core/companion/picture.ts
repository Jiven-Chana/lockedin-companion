/**
 * Pictures that build up (v3.2, V-101). A diagram of plain boxes and arrows
 * can carry, as comment lines, the steps it arrives in and one gap to guess:
 *
 *   %% step G, fake :: A forger :: The generator turns noise into a fake image.
 *   %% step D=learning, G=held still :: Only D's weights change.
 *   %% gap score :: The fake's score… :: *goes up => why | goes down => why
 *
 * The tutor and the explainer writer add these to the diagram they already
 * write. They are comments, so a diagram LockedIn cannot draw is still one
 * mermaid can. This file only reads them: anything missing or wrong is left
 * out, and with nothing left the whole picture shows, as it did before.
 * Pure: no IO, browser-safe.
 */

import { PICTURE_RULES } from "./policy.ts";

/** One step: the blocks it lights, a short note on some of them, and one sentence. */
export interface PictureStep { title?: string; say: string; lit: string[]; notes: Record<string, string> }
export interface PictureOption { label: string; why: string; right: boolean }
/** One block to guess before the picture builds up. Nothing is marked. */
export interface PictureGap { node: string; ask: string; options: PictureOption[] }
export interface PictureScript { steps: PictureStep[]; gap?: PictureGap }
/** What is on the picture at one moment. */
export interface PictureFrame { shown: string[]; lit: string[]; notes: Record<string, string> }

const LINE = /^\s*%%\s*(step|gap)\b\s*(.*)$/i;
const parts = (text: string) => text.split("::").map((p) => p.trim());

function readStep(rest: string, known: ReadonlySet<string>): PictureStep | null {
	const p = parts(rest);
	if (p.length < 2) return null;
	const title = p.length > 2 ? p[1]! : "";
	const say = (p.length > 2 ? p.slice(2).join(" :: ") : p[1]!).trim().slice(0, PICTURE_RULES.sayMax);
	if (!say) return null;
	const lit: string[] = [];
	const notes: Record<string, string> = {};
	for (const item of p[0]!.split(",")) {
		const eq = item.indexOf("=");
		const id = (eq < 0 ? item : item.slice(0, eq)).trim();
		if (!known.has(id) || lit.includes(id)) continue;
		lit.push(id);
		const note = eq < 0 ? "" : item.slice(eq + 1).trim().slice(0, PICTURE_RULES.noteMax).trim();
		if (note) notes[id] = note;
	}
	return { ...(title ? { title: title.slice(0, PICTURE_RULES.titleMax) } : {}), say, lit, notes };
}

function readGap(rest: string, known: ReadonlySet<string>): PictureGap | null {
	const p = parts(rest);
	if (p.length < 3 || !known.has(p[0]!) || !p[1]) return null;
	const options = p.slice(2).join(" :: ").split("|").map((o): PictureOption | null => {
		const text = o.trim();
		const right = text.startsWith("*");
		const body = right ? text.slice(1).trim() : text;
		const at = body.indexOf("=>");
		const label = (at < 0 ? body : body.slice(0, at)).trim();
		return label ? { label, why: at < 0 ? "" : body.slice(at + 2).trim().slice(0, PICTURE_RULES.whyMax), right } : null;
	}).filter((o): o is PictureOption => o !== null).slice(0, PICTURE_RULES.optionsMax);
	if (options.length < PICTURE_RULES.optionsMin || options.filter((o) => o.right).length !== 1) return null;
	return { node: p[0]!, ask: p[1]!.slice(0, PICTURE_RULES.askMax), options };
}

/** The steps and the gap written into a diagram's comment lines, or null when there is nothing usable. */
export function parsePictureScript(source: string, nodeIds: readonly string[]): PictureScript | null {
	const known = new Set(nodeIds);
	const steps: PictureStep[] = [];
	let gap: PictureGap | undefined;
	for (const line of source.split("\n")) {
		const m = LINE.exec(line);
		if (!m) continue;
		if (m[1]!.toLowerCase() === "step") {
			const s = readStep(m[2]!, known);
			if (s && steps.length < PICTURE_RULES.maxSteps) steps.push(s);
		} else gap ??= readGap(m[2]!, known) ?? undefined;
	}
	// One step is not a build-up: the picture is then shown whole.
	const built = steps.length >= PICTURE_RULES.minSteps ? steps : [];
	return built.length || gap ? { steps: built, ...(gap ? { gap } : {}) } : null;
}

/**
 * What is on the picture at a step (counting from 0), or with everything
 * shown. A block arrives at the first step that names it and stays; a block
 * no step names is there from the start. Only the current step's blocks are
 * lit and carry notes.
 */
export function pictureFrame(script: PictureScript, nodeIds: readonly string[], at: number | "all"): PictureFrame {
	if (at === "all" || !script.steps.length) return { shown: [...nodeIds], lit: [], notes: {} };
	const i = Math.min(script.steps.length - 1, Math.max(0, at));
	const named = new Set(script.steps.flatMap((s) => s.lit));
	const arrived = new Set(script.steps.slice(0, i + 1).flatMap((s) => s.lit));
	const step = script.steps[i]!;
	return { shown: nodeIds.filter((id) => !named.has(id) || arrived.has(id)), lit: step.lit, notes: step.notes };
}
