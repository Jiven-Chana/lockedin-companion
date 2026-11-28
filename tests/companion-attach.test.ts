/**
 * v3.1 Part B: attaching a file to a Learn session. Jiven, 28 Nov: "I dont
 * have the oppourtunity to attach say a worked solution to the learn session
 * chat so the AI can walk me through the questions to get me to a stage
 * where I can actually attempt an augmentation of the question myself."
 *
 * AI usage is the constraint: a file is read as text where it has text, and
 * as a picture only where it has none.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { ATTACH_COPY, ATTACH_RULES, attachmentBlock, attachmentKind } from "../src/core/companion/index.ts";

const ROOT = path.join(import.meta.dirname, "..");
const enc = (s: string) => new TextEncoder().encode(s);

describe("what kind of file was attached", () => {
	const cases: Array<[string, string, Uint8Array, ReturnType<typeof attachmentKind>]> = [
		["a photo of working, by its name", "working.jpg", enc("x"), "image"],
		["a screenshot", "Screenshot 2026-11-28.PNG", enc("x"), "image"],
		["a picture by its first bytes, whatever it is called", "IMG_0042", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]), "image"],
		["a JPEG by its first bytes", "photo", new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), "image"],
		["a problem sheet", "Sheet 7.pdf", enc("%PDF-1.7"), "pdf"],
		["a worked solution in Markdown", "solutions.md", enc("# Q1"), "text"],
		["a saved web page", "sheet.html", enc("<html>"), "html"],
		["a Word file is not taken", "sheet.docx", enc("PK"), null],
		["a HEIC photo is not taken: the AI cannot read it", "IMG_1.heic", enc("x"), null],
	];
	for (const [name, file, head, kind] of cases) it(name, () => assert.equal(attachmentKind(file, head), kind));
	it("the picker offers what is taken", () => {
		for (const ext of [".pdf", ".md", ".txt", ".html", ".png", ".jpg", ".jpeg", ".webp"]) assert.ok(ATTACH_RULES.accept.split(",").includes(ext), ext);
	});
});

describe("what the tutor is given", () => {
	it("each file by name, its text, and how many pictures of it come with the message", () => {
		const block = attachmentBlock([
			{ name: "Sheet 7.pdf", text: "## Page 1\nQ1. Find the Nash equilibria of the game below.", images: 0 },
			{ name: "working.jpg", text: "", images: 1 },
		]);
		assert.match(block, /^ATTACHED BY ME \(2 files\)\n/);
		assert.match(block, /### Sheet 7\.pdf\n## Page 1\nQ1\. Find the Nash equilibria/);
		assert.match(block, /### working\.jpg\n\(1 picture of this file is attached to this message\.\)/);
	});
	it("one file reads as one", () => {
		assert.match(attachmentBlock([{ name: "a.md", text: "x", images: 0 }]), /^ATTACHED BY ME \(1 file\)\n/);
	});
	it("nothing attached: nothing said", () => assert.equal(attachmentBlock([]), ""));
	it("long files are cut to the budget, shared between them, and say they were cut", () => {
		const long = "word ".repeat(20_000);
		const block = attachmentBlock([{ name: "a.pdf", text: long, images: 0 }, { name: "b.pdf", text: long, images: 0 }]);
		assert.ok(block.length <= ATTACH_RULES.textTokenBudget * 4 + 400, String(block.length));
		assert.equal(block.split("(cut here: the file is longer)").length - 1, 2);
		// A short file beside a long one keeps all of itself.
		const mixed = attachmentBlock([{ name: "short.md", text: "Q1 only.", images: 0 }, { name: "long.pdf", text: long, images: 0 }]);
		assert.match(mixed, /### short\.md\nQ1 only\./);
	});
	it("a PDF page with no text travels as a picture, and the text says which page", () => {
		const block = attachmentBlock([{ name: "scan.pdf", text: "## Page 1\n(no text on this page: see its picture)", images: 1 }]);
		assert.match(block, /\(1 picture of this file is attached to this message\.\)/);
	});
});

describe("the limits and the words", () => {
	it("a few files a session, and only a few pictures: pictures are what cost", () => {
		assert.equal(ATTACH_RULES.maxPerSession, 5);
		assert.ok(ATTACH_RULES.pageImages <= 3);
		assert.ok(ATTACH_RULES.textTokenBudget <= 6_000);
	});
	it("says what can be attached and what went wrong, in plain words", () => {
		assert.match(ATTACH_COPY.wrongKind("a.docx"), /^a\.docx: attach a PDF, text, a web page or a picture/);
		assert.match(ATTACH_COPY.tooMany, /5 files/);
		assert.match(ATTACH_COPY.busy, /writing/);
		assert.equal(ATTACH_COPY.sentWith(["Sheet 7.pdf"]), "I've attached Sheet 7.pdf.");
		assert.equal(ATTACH_COPY.sentWith(["a.pdf", "b.jpg"]), "I've attached a.pdf and b.jpg.");
	});
});

describe("what the tutor is told to do with an attachment", () => {
	const method = fs.readFileSync(path.join(ROOT, "companion", "seed", "prompt-patches", "teacher", "05-method.with.md"), "utf-8");
	it("walk through it, then set one like it for the student to try", () => {
		assert.match(method, /ATTACHED BY ME/);
		assert.match(method, /one step at a time/i);
		assert.match(method, /a variation/i);
		assert.match(method, /never (just )?hand (them|the learner) the (whole|full) solution/i);
	});
});
