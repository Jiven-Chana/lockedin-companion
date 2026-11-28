/**
 * Lecture content resolution: slides, slide PDFs, scripted question sets
 * and the sample timetable.
 *
 * Lookup order for per-lecture files: the data directory's materials
 * (`<data>/companion/materials/<id>/`, written by the seed script and the
 * materials upload) first, then the repo's `companion/content/<id>/`, so a
 * fresh checkout works before seeding.
 */

import fs from "node:fs";
import path from "node:path";
import { slideTitles } from "../../core/companion/slides.ts";
import { validateScriptedSet } from "../../core/companion/scripted.ts";
import { bankToScriptedSet, type BankQuestion, type Explainer } from "../../core/companion/study-pack.ts";
import type { SampleTimetable } from "../../core/companion/timetable.ts";
import type { ScriptedSet } from "../../core/companion/types.ts";
import { assertSafeId, type CompanionStore } from "./store.ts";

export class CompanionContent {
	constructor(
		private readonly store: CompanionStore,
		/** The repo's companion/content directory. */
		readonly repoContentDir: string,
	) {}

	private candidates(lectureId: string, file: string): string[] {
		assertSafeId(lectureId, "lecture id");
		return [path.join(/* turbopackIgnore: true */ this.store.materialsDir(lectureId), file), path.join(/* turbopackIgnore: true */ this.repoContentDir, lectureId, file)];
	}

	private find(lectureId: string, file: string): string | null {
		return this.candidates(lectureId, file).find((p) => fs.existsSync(/* turbopackIgnore: true */ p)) ?? null;
	}

	slidesPath(lectureId: string): string | null {
		return this.find(lectureId, "slides.md");
	}

	slidesMarkdown(lectureId: string): string | null {
		const p = this.slidesPath(lectureId);
		return p ? fs.readFileSync(/* turbopackIgnore: true */ p, "utf-8") : null;
	}

	hasMaterials(lectureId: string): boolean {
		try {
			return this.slidesPath(lectureId) !== null;
		} catch {
			return false;
		}
	}

	slideTitles(lectureId: string): string[] {
		const md = this.slidesMarkdown(lectureId);
		return md ? slideTitles(md).map((s) => s.title) : [];
	}

	/** The lecture's concept map (mermaid graph TD), if one was authored or saved. */
	conceptMapSource(lectureId: string): string | null {
		const p = this.find(lectureId, "map.mmd");
		return p ? fs.readFileSync(/* turbopackIgnore: true */ p, "utf-8") : null;
	}

	/** The unit's original PDF. An empty file (uploads saved before v1.0 lost their bytes) is no PDF. */
	pdfPath(lectureId: string): string | null {
		const p = this.find(lectureId, "slides.pdf");
		return p && fs.statSync(/* turbopackIgnore: true */ p).size > 0 ? p : null;
	}

	/** Where the pictures of a unit's PDF pages are kept (V-21). */
	pagesDir(lectureId: string): string {
		return path.join(/* turbopackIgnore: true */ this.store.materialsDir(assertSafeId(lectureId, "lecture id")), "pages");
	}

	/** The scripted set for a lecture, validated. Throws on an invalid file (authoring error). */
	/**
	 * The set for a Practise round (V-40): the chosen questions, in the order
	 * chosen, each knowing the unit it came from.
	 */
	practiseSet(picks: readonly { lectureId: string; questionId: string }[]): ScriptedSet | null {
		const sets = new Map<string, ScriptedSet | null>();
		const questions = picks.flatMap((p) => {
			if (!sets.has(p.lectureId)) sets.set(p.lectureId, this.scriptedSet(p.lectureId));
			const q = sets.get(p.lectureId)?.questions.find((x) => x.id === p.questionId);
			return q ? [{ ...q, lectureId: p.lectureId }] : [];
		});
		return questions.length ? { lectureId: picks[0]!.lectureId, questions } : null;
	}

	scriptedSet(lectureId: string): ScriptedSet | null {
		const p = this.find(lectureId, "questions.json");
		if (!p) {
			// No authored set: a generated study pack's bank is the fallback (F-105), so the
			// scripted engine works on the student's own material.
			const bankFile = this.find(lectureId, "bank.json");
			if (!bankFile) return null;
			const bank = JSON.parse(fs.readFileSync(/* turbopackIgnore: true */ bankFile, "utf-8")) as BankQuestion[];
			const explainersFile = this.find(lectureId, "explainers.json");
			const explainers = explainersFile ? (JSON.parse(fs.readFileSync(/* turbopackIgnore: true */ explainersFile, "utf-8")) as Explainer[]) : [];
			const set = bankToScriptedSet(lectureId, bank, explainers);
			return set.questions.length ? set : null;
		}
		const parsed = validateScriptedSet(JSON.parse(fs.readFileSync(/* turbopackIgnore: true */ p, "utf-8")));
		if (!parsed.ok) throw new Error(`invalid scripted set ${p}: ${parsed.errors.join("; ")}`);
		return parsed.set;
	}

	sampleTimetable(): SampleTimetable {
		return JSON.parse(fs.readFileSync(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ this.repoContentDir, "sample-timetable.json"), "utf-8")) as SampleTimetable;
	}

	/** Write converted slides (materials upload). */
	/** `pdf: null` removes a PDF kept from before (v3.1): text put in its place has no pages to picture. */
	writeMaterials(lectureId: string, files: { slidesMd: string; pdf?: Uint8Array | null }): string {
		const dir = this.store.materialsDir(lectureId);
		fs.mkdirSync(/* turbopackIgnore: true */ dir, { recursive: true });
		fs.writeFileSync(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ dir, "slides.md"), files.slidesMd, "utf-8");
		// The old PDF may be one file shared with sibling units (a hard link): remove
		// the name before writing, so only this unit changes. Its page pictures go too.
		fs.rmSync(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ dir, "pages"), { recursive: true, force: true });
		if (files.pdf !== undefined) fs.rmSync(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ dir, "slides.pdf"), { force: true });
		if (files.pdf) {
			fs.writeFileSync(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ dir, "slides.pdf"), files.pdf);
		}
		return dir;
	}

	/** Delete a lecture's uploaded material (the bundled demo content in the repo is never touched). */
	removeMaterials(lectureId: string): void {
		fs.rmSync(/* turbopackIgnore: true */ this.store.materialsDir(lectureId), { recursive: true, force: true });
	}
}
