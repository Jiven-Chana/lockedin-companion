/**
 * Course material in any shape (v0.1 F-104, V-18) through CompanionService:
 * weekly files, a whole-semester file split by the AI, pasted Canvas text,
 * no AI, the confirmation save, removal, the module calendar, and calendar
 * re-imports that never lose uploads. Fake PDF converter and fake AI.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { SlidePage } from "../src/core/companion/index.ts";
import { parseSlides } from "../src/core/companion/index.ts";
import { ManualClock } from "../src/server/companion/clock.ts";
import { CompanionContent } from "../src/server/companion/content.ts";
import { ScriptedEngine } from "../src/server/companion/engines/scripted.ts";
import { CompanionError } from "../src/server/companion/errors.ts";
import type { Generate, GenerateRequest } from "../src/server/companion/generate.ts";
import { CompanionService } from "../src/server/companion/service.ts";
import { CompanionStore } from "../src/server/companion/store.ts";

const CONTENT = path.join(import.meta.dirname, "..", "companion", "content");
const PROMPTS = path.join(import.meta.dirname, "..", "companion", "prompts");
const NOW = new Date(2026, 10, 23, 12); // Mon 23 Nov 2026

/** A fake PDF: the bytes are the page titles joined by "|". */
const pdf = (...titles: string[]) => new Uint8Array([0x25, 0x50, 0x44, 0x46, ...new TextEncoder().encode(titles.join("|"))]);
/** Like the real PDF reader, the fake one uses up the bytes it is given (v1.0 S-2: the stored PDF came out empty). */
const pdfToPages = async (data: Uint8Array): Promise<SlidePage[]> => {
	const titles = new TextDecoder().decode(data.slice(4)).split("|");
	data.fill(0);
	return titles.map((t, i) => (t === "IMG" ? { number: i + 1, kind: "image-only" as const } : { number: i + 1, kind: "text" as const, markdown: `# ${t}\nBody of ${t}.` }));
};

async function setup(opts: { aiReady?: boolean; split?: (req: GenerateRequest) => unknown } = {}) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "companion-mat-"));
	const store = new CompanionStore(dir);
	const content = new CompanionContent(store, CONTENT);
	const clock = new ManualClock(NOW);
	const calls: GenerateRequest[] = [];
	const renders: string[] = [];
	const generate: Generate = async <T,>(req: GenerateRequest) => {
		calls.push(req);
		const value = opts.split ? opts.split(req) : { units: [] };
		const problem = req.validate?.(value);
		if (problem) throw new Error(`invalid: ${problem}`);
		return { value: value as T, model: "fake/split", cost: null, ms: 1 };
	};
	let n = 0;
	const svc = new CompanionService({
		store, content, clock,
		clockControl: { set: (t) => clock.set(t), reset: () => clock.set(NOW) },
		engines: { scripted: new ScriptedEngine((id) => content.scriptedSet(id)), learnharness: new ScriptedEngine((id) => content.scriptedSet(id)) },
		defaultEngine: "scripted",
		convertPdf: pdfToPages,
		renderPdfPage: async (file, page) => {
			renders.push(`${path.basename(path.dirname(file))}:${page}`);
			await new Promise((r) => setTimeout(r, 2));
			return fs.statSync(file).size > 0 ? new TextEncoder().encode(`png of page ${page}`) : null;
		},
		generate,
		promptsDir: PROMPTS,
		newId: (p) => `${p}${++n}`,
	});
	// The AI's readiness without the engine: stub the check the materials use.
	(svc.courseMaterials as unknown as { opts: { aiReady: () => Promise<boolean> } }).opts.aiReady = async () => opts.aiReady ?? false;
	await svc.onboardFlow({ calendar: { kind: "none" }, modules: [{ code: "GT", name: "Game Theory" }] });
	return { svc, store, dir, calls, renders, events: () => store.events().map((e) => e.type) };
}

const semester = () => pdf("Game Theory", ...Array.from({ length: 13 }, (_, i) => `Dominance ${i}`), ...Array.from({ length: 14 }, (_, i) => `Nash ${i}`));

describe("proposing course units", () => {
	it("a weekly-labelled PDF is one unit, with no AI call", async () => {
		const { svc, calls } = await setup({ aiReady: true });
		const r = await svc.proposeMaterials("GT", [{ name: "GT_Week2_nash.pdf", bytes: pdf("Nash equilibrium", "Best responses") }]);
		assert.deepEqual(r.files[0]!.units, [{ title: "Nash equilibrium", week: 2, pages: [1, 2] }]);
		assert.equal(r.files[0]!.via, "name");
		assert.equal(calls.length, 0);
	});

	it("a whole-semester PDF is split by the AI on the Cheap slot", async () => {
		const { svc, calls } = await setup({ aiReady: true, split: () => ({ units: [{ title: "Dominance", week: 1, from: 2, to: 14 }, { title: "Nash equilibrium", week: 2, from: 15, to: 28 }] }) });
		const r = await svc.proposeMaterials("GT", [{ name: "GT full course.pdf", bytes: semester() }]);
		assert.equal(calls.length, 1);
		assert.equal(calls[0]!.slot, "cheap");
		assert.match(calls[0]!.user, /p15: Nash 0/);
		assert.equal(r.files[0]!.via, "ai");
		assert.deepEqual(r.files[0]!.units.map((u) => [u.title, u.week, u.pages]), [["Dominance", 1, [2, 14]], ["Nash equilibrium", 2, [15, 28]]]);
	});

	it("without a ready AI, a big unlabelled file is one unit with a plain note", async () => {
		const { svc, calls } = await setup({ aiReady: false });
		const r = await svc.proposeMaterials("GT", [{ name: "slides.pdf", bytes: semester() }]);
		assert.equal(calls.length, 0);
		assert.equal(r.files[0]!.units.length, 1);
		assert.equal(r.files[0]!.units[0]!.week, 0);
		assert.match(r.files[0]!.note ?? "", /Connect your AI/);
	});

	it("an AI split that fails its checks falls back, with a note", async () => {
		const { svc } = await setup({ aiReady: true, split: () => ({ units: [{ title: "Oops", week: 1, from: 5, to: 99 }] }) });
		const r = await svc.proposeMaterials("GT", [{ name: "slides.pdf", bytes: semester() }]);
		assert.equal(r.files[0]!.via, "fallback");
		assert.match(r.files[0]!.note ?? "", /couldn't split/);
	});

	it("pasted Canvas text splits by its Week headings", async () => {
		const { svc } = await setup();
		const text = "Week 1: Dominance\nWhat dominance means...\n\nWeek 2: Nash\nBest responses...";
		const r = await svc.proposeMaterials("GT", [{ name: "Canvas summary.md", bytes: new TextEncoder().encode(text) }]);
		assert.deepEqual(r.files[0]!.units.map((u) => [u.title, u.week]), [["Dominance", 1], ["Nash", 2]]);
	});

	it("image-only pages are listed as no text found", async () => {
		const { svc } = await setup();
		const r = await svc.proposeMaterials("GT", [{ name: "Week 3.pdf", bytes: pdf("Mixed", "IMG", "Summary") }]);
		assert.deepEqual(r.files[0]!.noText, [2]);
	});

	const refused: Array<[string, { name: string; bytes: Uint8Array }[], RegExp]> = [
		["no files", [], /at least one file/],
		["a Word file", [{ name: "notes.docx", bytes: new Uint8Array([1, 2]) }], /PDF, Markdown/],
		["an empty file", [{ name: "x.pdf", bytes: new Uint8Array() }], /empty/],
	];
	for (const [name, files, message] of refused) it(`refuses ${name}`, async () => {
		const { svc } = await setup();
		await assert.rejects(svc.proposeMaterials("GT", files), message);
	});

	it("an unknown module is a 404", async () => {
		const { svc } = await setup();
		await assert.rejects(svc.proposeMaterials("XX", [{ name: "a.md", bytes: new TextEncoder().encode("x") }]), (e: CompanionError) => e.status === 404);
	});
});

describe("saving the confirmed units", () => {
	async function proposed() {
		const s = await setup({ aiReady: true, split: () => ({ units: [{ title: "Dominance", week: 1, from: 2, to: 14 }, { title: "Nash equilibrium", week: 2, from: 15, to: 28 }] }) });
		const r = await s.svc.proposeMaterials("GT", [{ name: "GT full course.pdf", bytes: semester() }]);
		return { ...s, r };
	}

	it("each unit gets only its pages, numbered as in the original file, and one shared PDF", async () => {
		const { svc, r, store, events } = await proposed();
		const units = r.files[0]!.units.map((u) => ({ file: 0, ...u, title: u.title === "Nash equilibrium" ? "Nash equilibria" : u.title }));
		const saved = svc.saveMaterials("GT", { uploadId: r.uploadId, units });
		assert.deepEqual(saved.units.map((u) => [u.id, u.title, u.week, u.start]), [["gt-dominance", "Dominance", 1, undefined], ["gt-nash-equilibria", "Nash equilibria", 2, undefined]]);
		const slides = parseSlides(fs.readFileSync(path.join(store.materialsDir("gt-nash-equilibria"), "slides.md"), "utf-8"));
		assert.deepEqual([slides[0]!.number, slides.at(-1)!.number], [15, 28], "citations point at the real pages");
		const a = fs.statSync(path.join(store.materialsDir("gt-dominance"), "slides.pdf"));
		const b = fs.statSync(path.join(store.materialsDir("gt-nash-equilibria"), "slides.pdf"));
		assert.equal(a.ino, b.ino, "one copy of the PDF on disk");
		assert.ok(events().includes("materials_saved"));
		assert.throws(() => svc.saveMaterials("GT", { uploadId: r.uploadId, units }), /expired/, "a saved upload can't be saved twice");
	});

	it("the stored PDF is the uploaded file, not an empty one (S-2)", async () => {
		const { svc, r, store } = await proposed();
		const saved = svc.saveMaterials("GT", { uploadId: r.uploadId, units: r.files[0]!.units.map((u) => ({ file: 0, ...u })) });
		const stored = fs.readFileSync(path.join(store.materialsDir(saved.units[0]!.id), "slides.pdf"));
		assert.deepEqual(new Uint8Array(stored), semester());
		assert.equal(svc.materials(saved.units[0]!.id).hasPdf, true);
		assert.equal(svc.lectureSlides(saved.units[0]!.id).hasPdf, true);
	});

	it("an empty stored PDF (uploads from before the fix) counts as no PDF", async () => {
		const { svc, r, store } = await proposed();
		const saved = svc.saveMaterials("GT", { uploadId: r.uploadId, units: r.files[0]!.units.map((u) => ({ file: 0, ...u })) });
		const id = saved.units[0]!.id;
		fs.truncateSync(path.join(store.materialsDir(id), "slides.pdf"), 0);
		assert.equal(svc.materials(id).hasPdf, false);
		assert.equal(svc.lectureSlides(id).hasPdf, false);
		await assert.rejects(svc.slidePage(id, 2), (e: CompanionError) => e.status === 404 && e.code === "page_not_found");
	});

	it("a page of the unit is drawn once and kept; other pages and units without a PDF are not found (V-21)", async () => {
		const { svc, r, renders } = await proposed();
		const saved = svc.saveMaterials("GT", { uploadId: r.uploadId, units: r.files[0]!.units.map((u) => ({ file: 0, ...u })) });
		const nash = saved.units[1]!.id; // pages 15 to 28
		const [a, b] = await Promise.all([svc.slidePage(nash, 15), svc.slidePage(nash, 15)]);
		assert.equal(a, b);
		assert.equal(fs.readFileSync(a, "utf-8"), "png of page 15");
		await svc.slidePage(nash, 15);
		assert.deepEqual(renders, [`${nash}:15`], "drawn once, then read from disk");
		await assert.rejects(svc.slidePage(nash, 3), (e: CompanionError) => e.code === "page_not_found", "page 3 belongs to the other unit");
		await assert.rejects(svc.slidePage(nash, 1.5), (e: CompanionError) => e.status === 400);
		await assert.rejects(svc.slidePage("hci-w3-personas", 1), (e: CompanionError) => e.code === "page_not_found", "the sample lecture has no PDF");
		assert.equal(svc.lectureSlides("hci-w3-personas").hasPdf, false);
	});

	it("replacing a unit's material keeps the new PDF and forgets the old page pictures", async () => {
		const { svc, r, store } = await proposed();
		const saved = svc.saveMaterials("GT", { uploadId: r.uploadId, units: r.files[0]!.units.map((u) => ({ file: 0, ...u })) });
		const id = saved.units[0]!.id; // pages 2 to 14
		const old = await svc.slidePage(id, 2);
		await svc.importMaterials(id, pdf("One", "Two"));
		assert.deepEqual(new Uint8Array(fs.readFileSync(path.join(store.materialsDir(id), "slides.pdf"))), pdf("One", "Two"));
		assert.equal(fs.existsSync(old), false);
		assert.equal(fs.readFileSync(await svc.slidePage(id, 2), "utf-8"), "png of page 2");
	});

	it("units are quizzable straight away, with no timetable", async () => {
		const { svc, r } = await proposed();
		svc.saveMaterials("GT", { uploadId: r.uploadId, units: r.files[0]!.units.map((u) => ({ file: 0, ...u })) });
		const course = svc.course();
		assert.deepEqual(course[0]!.units.map((u) => u.title), ["Dominance", "Nash equilibrium"]);
		assert.ok(course[0]!.units.every((u) => u.hasMaterials));
	});

	it("overlapping pages are refused and nothing is saved", async () => {
		const { svc, r, store } = await proposed();
		assert.throws(() => svc.saveMaterials("GT", { uploadId: r.uploadId, units: [{ file: 0, title: "A", week: 1, pages: [2, 20] }, { file: 0, title: "B", week: 2, pages: [15, 28] }] }), /overlap/);
		assert.deepEqual(store.lectures(), []);
	});

	it("removing a unit hides it and keeps its history", async () => {
		const { svc, r, store } = await proposed();
		const [first] = svc.saveMaterials("GT", { uploadId: r.uploadId, units: r.files[0]!.units.map((u) => ({ file: 0, ...u })) }).units;
		svc.removeMaterials(first!.id);
		assert.ok(!store.lectures().some((l) => l.id === first!.id));
		assert.ok(store.allLectures().find((l) => l.id === first!.id)?.archived);
	});
});

describe("the module calendar", () => {
	it('"this is week 8" sets the week; reading weeks hold it', async () => {
		const { svc, events } = await setup();
		const m = svc.setModuleWeek("GT", { week: 8, readingWeeks: [6] });
		assert.deepEqual([m.week, m.reading, m.weekOneStart], [8, false, "2026-09-28"]);
		assert.equal(svc.course()[0]!.week, 8);
		assert.ok(events().includes("module_week_set"));
		assert.deepEqual([svc.setModuleWeek("GT", { week: 6, inReadingWeek: true }).week, svc.course()[0]!.reading], [6, true]);
		assert.equal(svc.setModuleWeek("GT", { week: null }).week, null, "it can be cleared");
	});
	it("refuses a silly week", async () => {
		const { svc } = await setup();
		assert.throws(() => svc.setModuleWeek("GT", { week: 0 }), /1 to 52/);
	});
});

describe("calendar re-imports merge (F-104)", () => {
	const ics = (titles: string[]) =>
		["BEGIN:VCALENDAR", ...titles.flatMap((t, i) => ["BEGIN:VEVENT", `UID:e${i}`, `SUMMARY:GT: ${t}`, `DTSTART:202611${24 + i}T100000Z`, `DTEND:202611${24 + i}T110000Z`, "END:VEVENT"]), "END:VCALENDAR"].join("\r\n");

	it("units and 'I wasn't there' survive; a vanished event is archived, not deleted", async () => {
		const { svc, store } = await setup();
		const r = await svc.proposeMaterials("GT", [{ name: "Week 2.pdf", bytes: pdf("Nash") }]);
		svc.saveMaterials("GT", { uploadId: r.uploadId, units: r.files[0]!.units.map((u) => ({ file: 0, ...u })) });
		svc.importIcs(ics(["Lecture A", "Lecture B"]));
		const [a, b] = store.lectures().filter((l) => l.start);
		svc.markMissed(a!.id, true);
		svc.importIcs(ics(["Lecture A"]));
		const live = store.lectures();
		assert.ok(live.some((l) => !l.start && l.title === "Nash"), "the unit is kept");
		assert.equal(live.find((l) => l.id === a!.id)?.attended, false, "I wasn't there is kept");
		assert.ok(!live.some((l) => l.id === b!.id), "the vanished event is hidden");
		assert.ok(store.allLectures().find((l) => l.id === b!.id)?.archived, "…and kept as history");
	});
});
