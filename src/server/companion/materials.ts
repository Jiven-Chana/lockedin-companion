/**
 * Course material in any shape (v0.1 F-104, V-18): files → pages → proposed
 * course units → the student confirms → units with their own slides.md.
 *
 * Proposals are held under <data>/companion/uploads/<id>/ until saved, so
 * the confirmation screen never re-uploads or re-converts anything.
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { MATERIALS_RULES } from "../../core/companion/policy.ts";
import { assembleSlidesMarkdown, firstLineTitle, type SlidePage } from "../../core/companion/slides.ts";
import { checkProposal, proposeWithoutAi, textToPages, unitChars, wantsAiSplit, type ProposalVia, type ProposedUnit, type UnitPage } from "../../core/companion/units.ts";
import { badRequest, CompanionError } from "./errors.ts";
import type { Generate } from "./generate.ts";

export type PdfToPages = (data: Uint8Array) => Promise<SlidePage[] | "too-long" | "unreadable">;

export interface UploadedFile {
	name: string;
	bytes: Uint8Array;
}

export interface FileProposal {
	file: number;
	name: string;
	kind: "pdf" | "text";
	pageCount: number;
	/** Pages with no text (image-only): listed as "no text found". */
	noText: number[];
	/** Each proposed unit with how much text it holds: under MATERIALS_RULES.minUnitChars it can't be saved (V-24). */
	units: (ProposedUnit & { chars: number })[];
	via: ProposalVia;
	/** Why the AI wasn't used or failed, in plain words (null when it wasn't needed or worked). */
	note: string | null;
}

interface PendingUpload {
	id: string;
	module: string;
	createdAt: string;
	files: { name: string; kind: "pdf" | "text"; pages: SlidePage[] }[];
}

const isPdf = (f: UploadedFile) => /\.pdf$/i.test(f.name) || (f.bytes[0] === 0x25 && f.bytes[1] === 0x50 && f.bytes[2] === 0x44 && f.bytes[3] === 0x46);
const isText = (f: UploadedFile) => /\.(md|markdown|txt)$/i.test(f.name);

export function unitPages(pages: SlidePage[]): UnitPage[] {
	return pages.map((p) => {
		const text = p.kind === "text" ? (p.markdown ?? "").trim() : "";
		return { number: p.number, title: text ? firstLineTitle(text) : "", chars: text.length };
	});
}

const SPLIT_SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: ["units"],
	properties: {
		units: {
			type: "array",
			minItems: 1,
			maxItems: 60,
			items: {
				type: "object",
				additionalProperties: false,
				required: ["title", "week", "from", "to"],
				properties: {
					title: { type: "string", minLength: 1, maxLength: 80 },
					week: { type: "integer", minimum: 0, maximum: 52 },
					from: { type: "integer", minimum: 1 },
					to: { type: "integer", minimum: 1 },
				},
			},
		},
	},
} as const;

type SplitOut = { units: { title: string; week: number; from: number; to: number }[] };
const toUnits = (v: SplitOut): ProposedUnit[] => v.units.map((u) => ({ title: u.title.trim(), week: u.week, pages: [u.from, u.to] }));

export class CourseMaterials {
	constructor(
		private readonly opts: {
			dataDir: string;
			promptsDir: string;
			pdfToPages?: PdfToPages;
			generate?: Generate;
			/** Is the student's AI ready for a split call right now? */
			aiReady: () => Promise<boolean>;
			newId?: () => string;
		},
	) {}

	private uploadsDir(id?: string) {
		const base = path.join(/* turbopackIgnore: true */ this.opts.dataDir, "uploads");
		return id ? path.join(/* turbopackIgnore: true */ base, id.replace(/[^A-Za-z0-9_-]/g, "")) : base;
	}

	private async toPages(f: UploadedFile): Promise<{ kind: "pdf" | "text"; pages: SlidePage[] }> {
		if (f.bytes.length === 0) throw badRequest(`${f.name} is empty`);
		if (f.bytes.length > MATERIALS_RULES.maxFileBytes) throw badRequest(`${f.name} is over 25 MB`);
		if (isPdf(f)) {
			if (!this.opts.pdfToPages) throw new CompanionError("pdf_unavailable", 501, "PDF conversion is not available");
			// The reader uses up the bytes it is given: hand it a copy, so the file itself can still be kept (S-2).
			const pages = await this.opts.pdfToPages(f.bytes.slice());
			if (pages === "too-long") throw badRequest(`${f.name} has too many pages`);
			if (pages === "unreadable") throw badRequest(`${f.name} could not be read`);
			return { kind: "pdf", pages };
		}
		if (isText(f) || !/\.[a-z0-9]{2,5}$/i.test(f.name)) {
			const text = new TextDecoder("utf-8", { fatal: false }).decode(f.bytes);
			return { kind: "text", pages: textToPages(text, MATERIALS_RULES.textPageChars).map((p) => ({ number: p.number, kind: "text" as const, markdown: p.markdown })) };
		}
		throw badRequest(`${f.name}: add PDF, Markdown (.md) or text (.txt) files`);
	}

	private async split(name: string, pages: SlidePage[], moduleName: string): Promise<{ units: ProposedUnit[]; via: ProposalVia; note: string | null }> {
		const summary = unitPages(pages);
		const base = proposeWithoutAi({ name, pages: summary });
		if (!wantsAiSplit({ name, pages: summary }, MATERIALS_RULES.aiSplitMinPages)) return { ...base, note: null };
		if (!this.opts.generate || !(await this.opts.aiReady().catch(() => false))) return { ...base, note: "Connect your AI to split this file into weeks automatically." };
		const system = fs.readFileSync(path.join(/* turbopackIgnore: true */ this.opts.promptsDir, "split.md"), "utf-8");
		const user = [`Module: ${moduleName}`, `File: ${name} (${summary.length} pages)`, "", ...summary.map((p) => `p${p.number}: ${p.title || "(no text)"} [${p.chars} chars]`)].join("\n");
		try {
			const r = await this.opts.generate<SplitOut>({
				slot: "cheap",
				system,
				user,
				toolName: "submit_units",
				toolDescription: "Submit the course units this file splits into.",
				schema: SPLIT_SCHEMA as unknown as Record<string, unknown>,
				validate: (v) => checkProposal(toUnits(v as SplitOut), summary.length),
			});
			return { units: toUnits(r.value), via: "ai", note: null };
		} catch (err) {
			console.warn("[companion] split failed:", err instanceof Error ? err.message : err);
			return { ...base, note: "The AI couldn't split this file, so it's one unit. Fix the title and week below." };
		}
	}

	/** Convert the files and propose units for each. Nothing is saved as course material yet. */
	async propose(module: { code: string; name: string }, files: UploadedFile[]): Promise<{ uploadId: string; files: FileProposal[] }> {
		if (files.length === 0) throw badRequest("add at least one file");
		if (files.length > MATERIALS_RULES.maxFilesPerUpload) throw badRequest(`at most ${MATERIALS_RULES.maxFilesPerUpload} files at once`);
		this.sweep();
		const converted = [];
		for (const f of files) converted.push({ name: f.name, ...(await this.toPages(f)) });
		const proposals: FileProposal[] = [];
		for (const [i, f] of converted.entries()) {
			const split = await this.split(f.name, f.pages, module.name);
			const summary = unitPages(f.pages);
			const r = { ...split, units: split.units.map((u) => ({ ...u, chars: unitChars(summary, u.pages) })) };
			proposals.push({
				file: i,
				name: f.name,
				kind: f.kind,
				pageCount: f.pages.length,
				noText: f.pages.filter((p) => p.kind !== "text" || !(p.markdown ?? "").trim()).map((p) => p.number),
				...r,
			});
		}
		const id = this.opts.newId?.() ?? `up_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
		const dir = this.uploadsDir(id);
		fs.mkdirSync(/* turbopackIgnore: true */ dir, { recursive: true });
		const pending: PendingUpload = { id, module: module.code, createdAt: new Date().toISOString(), files: converted.map((f) => ({ name: f.name, kind: f.kind, pages: f.pages })) };
		fs.writeFileSync(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ dir, "upload.json"), JSON.stringify(pending));
		for (const [i, f] of files.entries()) if (converted[i]!.kind === "pdf") fs.writeFileSync(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ dir, `${i}.pdf`), f.bytes);
		return { uploadId: id, files: proposals };
	}

	/** A held upload, or a 404 when it expired or was already saved. */
	pending(uploadId: string, module: string): PendingUpload & { pdf: (file: number) => Uint8Array | null } {
		const file = path.join(/* turbopackIgnore: true */ this.uploadsDir(uploadId), "upload.json");
		if (!fs.existsSync(/* turbopackIgnore: true */ file)) throw new CompanionError("upload_not_found", 404, "That upload has expired. Add the files again.");
		const p = JSON.parse(fs.readFileSync(/* turbopackIgnore: true */ file, "utf-8")) as PendingUpload;
		if (p.module !== module) throw badRequest("that upload belongs to another module");
		return {
			...p,
			pdf: (i) => {
				const f = path.join(/* turbopackIgnore: true */ this.uploadsDir(uploadId), `${i}.pdf`);
				return fs.existsSync(/* turbopackIgnore: true */ f) ? new Uint8Array(fs.readFileSync(/* turbopackIgnore: true */ f)) : null;
			},
		};
	}

	/** One unit's slides.md: only its pages, numbered as in the original file. */
	static unitMarkdown(pages: SlidePage[], range: [number, number], title: string) {
		return assembleSlidesMarkdown(pages.filter((p) => p.number >= range[0] && p.number <= range[1]), title);
	}

	discard(uploadId: string) {
		fs.rmSync(/* turbopackIgnore: true */ this.uploadsDir(uploadId), { recursive: true, force: true });
	}

	/** Drop proposals nobody confirmed. */
	private sweep() {
		const base = this.uploadsDir();
		if (!fs.existsSync(/* turbopackIgnore: true */ base)) return;
		const cutoff = Date.now() - MATERIALS_RULES.pendingUploadHours * 3_600_000;
		for (const id of fs.readdirSync(/* turbopackIgnore: true */ base)) {
			const f = path.join(/* turbopackIgnore: true */ base, id, "upload.json");
			try {
				if (fs.statSync(/* turbopackIgnore: true */ f).mtimeMs < cutoff) this.discard(id);
			} catch {
				this.discard(id);
			}
		}
	}
}
