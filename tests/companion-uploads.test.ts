/**
 * v3.1 Part A: adding course material. Jiven, 28 Nov: "I cant upload
 * multiple pdfs… I cant upload htmls or mds." Each file now travels by
 * itself, a file that cannot be read is named and the others are kept, and
 * a web page (.html) is material like any other.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { SlidePage } from "../src/core/companion/index.ts";
import { MATERIALS_COPY, MATERIALS_RULES, coversWeek, eachFile, materialKind, parseSlides, weekLabel } from "../src/core/companion/index.ts";
import { ManualClock } from "../src/server/companion/clock.ts";
import { CompanionContent } from "../src/server/companion/content.ts";
import { ScriptedEngine } from "../src/server/companion/engines/scripted.ts";
import { htmlToMarkdown } from "../src/server/companion/html.ts";
import { CompanionService } from "../src/server/companion/service.ts";
import { CompanionStore } from "../src/server/companion/store.ts";

const ROOT = path.join(import.meta.dirname, "..");
const enc = (s: string) => new TextEncoder().encode(s);
const FILL = " It explains the idea step by step, with a worked example and a short check.".repeat(4);
const pdf = (...titles: string[]) => new Uint8Array([0x25, 0x50, 0x44, 0x46, ...enc(titles.join("|"))]);
const pdfToPages = async (data: Uint8Array): Promise<SlidePage[]> => new TextDecoder().decode(data.slice(4)).split("|").map((t, i) => ({ number: i + 1, kind: "text" as const, markdown: `# ${t}\nBody of ${t}.${FILL}` }));

const PAGE = `<!doctype html><html><head><title>Week 7: GANs</title><style>p{color:red}</style><script>alert("x")</script></head><body>
<nav><a href="/">Home</a><a href="/modules">Modules</a></nav>
<article><h1>Generative adversarial networks</h1><p>A generator makes samples and a discriminator tells them from real data.${FILL}</p>
<h2>The minimax objective</h2><p>The two are trained against each other on one objective.${FILL}</p><ul><li>the generator minimises it</li><li>the discriminator maximises it</li></ul></article>
<footer>Copyright the university</footer></body></html>`;

async function setup() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "companion-up-"));
	const store = new CompanionStore(dir);
	const content = new CompanionContent(store, path.join(ROOT, "companion", "content"));
	const clock = new ManualClock(new Date(2026, 10, 23, 12));
	let n = 0;
	const svc = new CompanionService({
		store, content, clock,
		clockControl: { set: (t) => clock.set(t), reset: () => undefined },
		engines: { scripted: new ScriptedEngine((id) => content.scriptedSet(id)), learnharness: new ScriptedEngine((id) => content.scriptedSet(id)) },
		defaultEngine: "scripted",
		convertPdf: pdfToPages,
		promptsDir: path.join(ROOT, "companion", "prompts"),
		newId: (p) => `${p}${++n}`,
	});
	await svc.onboardFlow({ calendar: { kind: "none" }, modules: [{ code: "NC", name: "Neural Computation" }] });
	return { svc, store };
}

describe("what kind of file it is", () => {
	const cases: Array<[string, string, string | Uint8Array, ReturnType<typeof materialKind>]> = [
		["a PDF by its name", "Week 1.pdf", "x", "pdf"],
		["a PDF by its first bytes, whatever it is called", "download", pdf("a"), "pdf"],
		["Markdown", "notes.md", "# x", "text"],
		["Markdown, long ending", "notes.MARKDOWN", "# x", "text"],
		["plain text", "notes.txt", "x", "text"],
		["a web page", "Week 7.html", "<html>", "html"],
		["a web page, short ending", "page.HTM", "<p>x</p>", "html"],
		["a web page with no ending, by how it starts", "saved-page", "  <!DOCTYPE html><html>", "html"],
		["a file with no ending is read as text", "README", "plain words", "text"],
		["a Word file is not taken", "notes.docx", "PK", null],
		["nor slides from PowerPoint", "deck.pptx", "PK", null],
	];
	for (const [name, file, head, kind] of cases) it(name, () => assert.equal(materialKind(file, typeof head === "string" ? enc(head) : head), kind));

	it("the pickers offer exactly what is taken", () => {
		for (const ext of [".pdf", ".md", ".markdown", ".txt", ".html", ".htm"]) assert.ok(MATERIALS_RULES.accept.split(",").includes(ext), ext);
		for (const f of ["components/lockedin/material-upload.tsx", "components/lockedin/screens/welcome.tsx", "components/lockedin/screens/lecture.tsx"]) {
			const src = fs.readFileSync(path.join(ROOT, f), "utf-8");
			assert.ok(src.includes("accept={MATERIALS_RULES.accept}"), f);
			assert.ok(!/accept="\.pdf/.test(src), `${f} writes its own list`);
		}
		assert.match(MATERIALS_COPY.formats, /web page/);
	});
});

describe("a web page becomes text to study from", () => {
	it("keeps its headings, paragraphs and lists; drops scripts, styles and the page's furniture", () => {
		const md = htmlToMarkdown(PAGE)!;
		// The reader may set the page's top heading one level down; either way it is a heading the text is split at.
		assert.match(md, /^#{1,2} Generative adversarial networks/m);
		assert.match(md, /^#{2,3} The minimax objective/m);
		assert.match(md, /^- the generator minimises it$/m);
		assert.doesNotMatch(md, /alert|color:red|<p>|<h1>/);
	});
	it("a page with no article markup is still read", () => {
		const md = htmlToMarkdown(`<html><body><h1>Notes</h1><div>Line one of the notes.${FILL}</div></body></html>`)!;
		assert.match(md, /Notes/);
		assert.match(md, /Line one of the notes/);
	});
	it("a page with nothing to read is not material", () => {
		assert.equal(htmlToMarkdown("<html><body><script>app()</script></body></html>"), null);
	});
});

describe("several files at once", () => {
	it("each is sent by itself, in order, and one that fails does not stop the rest", async () => {
		const sent: string[] = [];
		const r = await eachFile([{ name: "a.pdf" }, { name: "b.docx" }, { name: "c.md" }], async (f) => {
			sent.push(f.name);
			if (f.name === "b.docx") throw new Error("b.docx: add PDF, Markdown, text or a web page");
			return f.name.toUpperCase();
		});
		assert.deepEqual(sent, ["a.pdf", "b.docx", "c.md"]);
		assert.deepEqual(r.done, ["A.PDF", "C.MD"]);
		assert.deepEqual(r.failed, [{ name: "b.docx", error: "b.docx: add PDF, Markdown, text or a web page" }]);
	});
	it("says which could not be read", () => {
		assert.equal(MATERIALS_COPY.couldNotRead([{ name: "b.docx", error: "b.docx: wrong kind" }]), "Not added: b.docx: wrong kind");
		assert.match(MATERIALS_COPY.couldNotRead([{ name: "a", error: "a is empty" }, { name: "b", error: "b is over 25 MB" }]), /^Not added: a is empty; b is over 25 MB$/);
	});
	it("the screens send one file a request, so the total size never matters", () => {
		for (const f of ["components/lockedin/material-upload.tsx", "components/lockedin/screens/welcome.tsx"]) {
			const src = fs.readFileSync(path.join(ROOT, f), "utf-8");
			assert.ok(src.includes("eachFile("), f);
			assert.ok(!/for \(const f of files\) form\.append\("file", f\)/.test(src), `${f} still puts every file in one request`);
		}
	});

	it("the server keeps the files it can read and names the one it cannot", async () => {
		const { svc } = await setup();
		const r = await svc.proposeMaterials("NC", [
			{ name: "Week 1.pdf", bytes: pdf("Neurons", "Weights") },
			{ name: "notes.docx", bytes: new Uint8Array([1, 2]) },
			{ name: "Week 2.pdf", bytes: pdf("Loss", "Gradient") },
		]);
		assert.deepEqual(r.files.map((f) => [f.file, f.name]), [[0, "Week 1.pdf"], [1, "Week 2.pdf"]]);
		assert.equal(r.failed.length, 1);
		assert.match(r.failed[0]!.error, /^notes\.docx: /);
		// Saving uses each kept file's own pages and its own PDF.
		const saved = svc.saveMaterials("NC", { uploadId: r.uploadId, units: r.files.flatMap((f) => f.units.map((u) => ({ file: f.file, title: u.title, week: u.week, pages: u.pages }))) });
		assert.deepEqual(saved.units.map((u) => u.week), [1, 2]);
		assert.match(fs.readFileSync(path.join(svc.materialsPdf(saved.units[1]!.id)!), "latin1"), /Loss\|Gradient/);
	});
	it("with nothing readable it says why, as before", async () => {
		const { svc } = await setup();
		await assert.rejects(svc.proposeMaterials("NC", [{ name: "notes.docx", bytes: new Uint8Array([1, 2]) }]), /notes\.docx: add PDF, Markdown \(\.md\), text \(\.txt\) or a web page \(\.html\)/);
		await assert.rejects(svc.proposeMaterials("NC", [{ name: "x.pdf", bytes: new Uint8Array() }, { name: "y.pdf", bytes: new Uint8Array() }]), /x\.pdf is empty/);
	});
	it("setup saves what it can and reports the rest", async () => {
		const { svc } = await setup();
		const r = await svc.quickMaterials("NC", [{ name: "Week 3.pdf", bytes: pdf("Backprop", "Chain rule") }, { name: "deck.pptx", bytes: new Uint8Array([1]) }]);
		assert.equal(r.units.length, 1);
		assert.equal(r.failed.length, 1);
		assert.match(r.failed[0]!.error, /^deck\.pptx: /);
	});
});

describe("a web page as course material", () => {
	it("is split at its headings, like Markdown, and can be saved", async () => {
		const { svc, store } = await setup();
		const r = await svc.proposeMaterials("NC", [{ name: "Week 7.html", bytes: enc(PAGE) }]);
		assert.equal(r.failed.length, 0);
		assert.equal(r.files[0]!.kind, "text");
		assert.equal(r.files[0]!.pageCount, 2);
		assert.equal(r.files[0]!.units[0]!.week, 7);
		const saved = svc.saveMaterials("NC", { uploadId: r.uploadId, units: r.files[0]!.units.map((u) => ({ file: 0, title: u.title, week: u.week, pages: u.pages })) });
		const slides = parseSlides(fs.readFileSync(path.join(store.materialsDir(saved.units[0]!.id), "slides.md"), "utf-8"));
		assert.deepEqual(slides.map((s) => s.title), ["Generative adversarial networks", "The minimax objective"]);
	});
	it("a page with nothing to read is refused by name", async () => {
		const { svc } = await setup();
		await assert.rejects(svc.proposeMaterials("NC", [{ name: "app.html", bytes: enc("<html><body><script>x()</script></body></html>") }]), /app\.html has no text to read/);
	});
});

describe("a lecture's own page takes the same kinds of file", () => {
	const start = async () => {
		const { svc, store } = await setup();
		const r = await svc.proposeMaterials("NC", [{ name: "Week 1.pdf", bytes: pdf("Neurons", "Weights") }]);
		const id = svc.saveMaterials("NC", { uploadId: r.uploadId, units: r.files[0]!.units.map((u) => ({ file: 0, title: u.title, week: u.week, pages: u.pages })) }).units[0]!.id;
		return { svc, store, id };
	};
	it("Markdown replaces the unit's material, and its old PDF goes", async () => {
		const { svc, id } = await start();
		const r = await svc.importMaterials(id, { name: "week1.md", bytes: enc(`# Perceptrons\nA perceptron is a weighted sum and a threshold.${FILL}\n\n## Learning rule\nWeights move towards the examples it gets wrong.${FILL}`) });
		assert.equal(r.slideCount, 2);
		assert.deepEqual(r.slides.map((s) => s.title), ["Perceptrons", "Learning rule"]);
		assert.equal(svc.materialsPdf(id), null, "the page pictures of the old PDF would no longer match");
	});
	it("a web page too", async () => {
		const { svc, id } = await start();
		assert.equal((await svc.importMaterials(id, { name: "Week 7.html", bytes: enc(PAGE) })).slideCount, 2);
	});
	it("a PDF as before, by name or by its bytes alone", async () => {
		const { svc, id } = await start();
		assert.equal((await svc.importMaterials(id, { name: "new.pdf", bytes: pdf("One", "Two", "Three") })).slideCount, 3);
		assert.equal((await svc.importMaterials(id, pdf("One", "Two"))).slideCount, 2);
		assert.ok(svc.materialsPdf(id));
	});
	it("a Word file is refused by name", async () => {
		const { svc, id } = await start();
		await assert.rejects(svc.importMaterials(id, { name: "notes.docx", bytes: new Uint8Array([1, 2]) }), /notes\.docx: add PDF/);
	});
});

/**
 * v3.1.1. Jiven, 28 Nov: "when I go to set week, the user doesnt have the
 * oppurtunity to set multiple weeks for 1 material and multiple materials in
 * one week." A unit's week could be set only while it was unset, and only to
 * one week.
 */
describe("a unit's weeks", () => {
	it("a unit covering several weeks says so", () => {
		assert.equal(weekLabel(7), "Week 7");
		assert.equal(weekLabel(7, 9), "Weeks 7 to 9");
		assert.equal(weekLabel(7, 7), "Week 7");
		assert.equal(weekLabel(0), "Week not set");
		assert.equal(weekLabel(0, 9), "Week not set");
	});
	it("it belongs to every week it covers", () => {
		assert.deepEqual([6, 7, 8, 9, 10].map((w) => coversWeek({ week: 7, weekTo: 9 }, w)), [false, true, true, true, false]);
		assert.deepEqual([6, 7, 8].map((w) => coversWeek({ week: 7 }, w)), [false, true, false]);
		assert.equal(coversWeek({ week: 0 }, 0), false, "a unit with no week belongs to none");
	});

	const two = async () => {
		const { svc, store } = await setup();
		const a = await svc.proposeMaterials("NC", [{ name: "gans.pdf", bytes: pdf("GANs", "Training") }]);
		const b = await svc.proposeMaterials("NC", [{ name: "diffusion.pdf", bytes: pdf("Diffusion", "Sampling") }]);
		const save = (r: typeof a) => svc.saveMaterials("NC", { uploadId: r.uploadId, units: r.files[0]!.units.map((u) => ({ file: 0, title: u.title, week: u.week, pages: u.pages })) }).units[0]!.id;
		return { svc, store, first: save(a), second: save(b) };
	};
	it("one unit can be given a range of weeks, and changed again afterwards", async () => {
		const { svc, first } = await two();
		assert.deepEqual([svc.setUnitWeek(first, { week: 7, weekTo: 9 }).week, svc.setUnitWeek(first, { week: 7, weekTo: 9 }).weekTo], [7, 9]);
		const again = svc.setUnitWeek(first, { week: 8 });
		assert.deepEqual([again.week, again.weekTo], [8, undefined], "back to one week: the range is gone");
		assert.equal(svc.setUnitWeek(first, { week: 5, weekTo: 5 }).weekTo, undefined);
	});
	it("two units can share a week", async () => {
		const { svc, first, second } = await two();
		svc.setUnitWeek(first, { week: 8 });
		svc.setUnitWeek(second, { week: 8 });
		const units = svc.course().find((m) => m.code === "NC")!.units;
		assert.deepEqual(units.map((u) => u.week), [8, 8]);
	});
	it("a range that runs backwards, or past week 52, is refused", async () => {
		const { svc, first } = await two();
		assert.throws(() => svc.setUnitWeek(first, { week: 9, weekTo: 7 }), /last week/);
		assert.throws(() => svc.setUnitWeek(first, { week: 9, weekTo: 60 }), /1 to 52/);
		assert.throws(() => svc.setUnitWeek(first, { week: 0 }), /1 to 52/);
	});
	it("the Library lets the week be changed on any unit, not only while it is unset", () => {
		const src = fs.readFileSync(path.join(ROOT, "components", "lockedin", "screens", "library.tsx"), "utf-8");
		assert.ok(/<SetWeek [^>]*week=\{l\.week\}/.test(src), "the week control is given the unit's own week");
		assert.ok(!/l\.week > 0 \|\| l\.start \? weekLabel/.test(src), "it is no longer shown only when the week is missing");
	});
});
