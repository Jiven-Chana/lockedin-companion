/**
 * v3.1.1. Jiven, 28 Nov: "The voice to speech should be accompanied
 * whereever the user can type." Dictation was on Learn's boxes only. Every
 * box where a student writes words now has the Speak button beside it.
 * (Boxes that take a date, a time, a week, a name of a few characters, a
 * calendar link or a key do not: there is nothing to say.)
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const UI = path.join(import.meta.dirname, "..", "components", "lockedin");
const read = (f: string) => fs.readFileSync(path.join(UI, f), "utf-8");

describe("a Speak button wherever a student writes words", () => {
	const boxes: Array<[string, string, string]> = [
		["what you want from a Learn session", "learn-intent.tsx", "learn-intent"],
		["how you want it taught", "learn-ask.tsx", "learn-how"],
		["why you chose an answer", "screens/session.tsx", "why"],
		["the line to the tutor, a written answer and a reason in Learn (one button, whichever box you are in)", "screens/learn.tsx", "learn"],
		["the setup and week-planning chat", "screens/setup-chat.tsx", "setup-chat"],
		["a module's notes", "module-notes.tsx", "module-notes"],
		["pasted course notes", "material-upload.tsx", "paste"],
		["the Library's search", "screens/library.tsx", "search"],
	];
	for (const [name, file, field] of boxes) {
		it(name, () => {
			const src = read(file);
			assert.ok(src.includes("<MicButton"), `${file} shows the button`);
			assert.ok(src.includes("useMic(") && src.includes(`, "${field}");`), `${file} logs its use as "${field}"`);
		});
	}
	it("the button says what it does on any box, not only on a reason", () => {
		const src = read("mic.tsx");
		assert.ok(!src.includes("Say your reason"));
		assert.ok(src.includes("Say it instead of typing"));
	});
	it("no key is written into the code: it is read from the laptop's own settings", () => {
		const all = ["mic.tsx", "voice-section.tsx", "screens/me.tsx", "screens/connect.tsx"].map(read).join("\n");
		assert.ok(!/DEEPGRAM_API_KEY\s*=\s*["'][^"']/.test(all));
	});
});
