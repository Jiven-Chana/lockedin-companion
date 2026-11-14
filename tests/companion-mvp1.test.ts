/**
 * Backend for the MVP 1 app (docs/companion/mvp1-plan.md): concept maps
 * (F-12), calendar links (F-03) with their network guards, slide sections,
 * ideas to revisit, and the concept map in the teacher's opening message.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { DEFAULT_PREFS, buildOpeningMessage, mapToMermaid, nodeStatuses, specFor, splitNodeLabel, starterMap } from "../src/core/companion/index.ts";
import { isPrivateAddress } from "../src/server/companion/calendar-fetch.ts";
import { ManualClock } from "../src/server/companion/clock.ts";
import { CompanionContent } from "../src/server/companion/content.ts";
import { ScriptedEngine } from "../src/server/companion/engines/scripted.ts";
import { CompanionService } from "../src/server/companion/service.ts";
import { CompanionStore } from "../src/server/companion/store.ts";

const CONTENT = path.join(import.meta.dirname, "..", "companion", "content");

function setup(fetchCalendar?: (url: string) => Promise<string>) {
	const store = new CompanionStore(fs.mkdtempSync(path.join(os.tmpdir(), "companion-mvp1-")));
	const content = new CompanionContent(store, CONTENT);
	const clock = new ManualClock(new Date(2026, 10, 17, 13, 5));
	const scripted = new ScriptedEngine((id) => content.scriptedSet(id));
	const svc = new CompanionService({ store, content, clock, clockControl: { set: (t) => clock.set(t), reset: () => undefined }, engines: { scripted, learnharness: scripted }, defaultEngine: "scripted", ...(fetchCalendar ? { fetchCalendar } : {}) });
	svc.onboard({});
	return { svc, store };
}

describe("concept maps (core)", () => {
	it("reads slide references from node labels", () => {
		assert.deepEqual(splitNodeLabel("What personas are for · S4"), { title: "What personas are for", slides: [4] });
		assert.deepEqual(splitNodeLabel("Ranges · S4–6"), { title: "Ranges", slides: [4, 5, 6] });
		assert.deepEqual(splitNodeLabel("No refs"), { title: "No refs", slides: [] });
	});

	it("statuses: open miss → revisit, confident right → solid, other answers → shaky, none → not yet", () => {
		const nodes = [{ id: "a", title: "A", slides: [2] }, { id: "b", title: "B", slides: [3] }, { id: "c", title: "C", slides: [4] }, { id: "d", title: "D", slides: [5] }];
		const ev = [
			{ nodeId: "a", slides: [], correct: true, dontKnow: false, confidence: 90, at: "1" },
			{ nodeId: "b", slides: [], correct: true, dontKnow: false, confidence: 30, at: "1" },
			{ slides: [4], correct: false, dontKnow: false, confidence: 50, at: "1" },
		];
		const out = nodeStatuses(nodes, ev, [{ explanation: "Because (Slide 4).", status: "open" }]);
		assert.deepEqual(out.map((n) => n.status), ["solid", "shaky", "revisit", "notyet"]);
	});

	it("starter maps follow slide headings; mermaid output carries status classes", () => {
		const m = starterMap([{ number: 1, title: "Title" }, { number: 2, title: "Two" }, { number: 3, title: "Three" }, { number: 4, title: "Summary" }]);
		assert.deepEqual(m.nodes.map((n) => n.id), ["slide-2", "slide-3"]);
		const src = mapToMermaid(nodeStatuses(m.nodes, [], []), m.edges, { solid: "fill:#fff", shaky: "fill:#fff", revisit: "fill:#fff", notyet: "fill:#fff" });
		assert.match(src, /^graph TD/);
		assert.match(src, /class slide-2 notyet/);
	});

	it("the teacher's opening message carries the lecture's concept map", () => {
		const lecture = { id: "hci-w3-personas", module: "HCI", title: "Personas", week: 3, order: 3, start: new Date(2026, 10, 17, 11).toISOString(), end: new Date(2026, 10, 17, 13).toISOString(), hasMaterials: true };
		const { text } = buildOpeningMessage({ spec: specFor("post-lecture", lecture.id, DEFAULT_PREFS), lecture, slidesMarkdown: "## Slide 1 — A\n\nx", conceptMap: "graph TD\n  a --> b", now: new Date(2026, 10, 17, 13, 5) });
		assert.match(text, /CONCEPT MAP \(plan on these node slugs\)\n```mermaid\ngraph TD\n {2}a --> b\n```/);
	});
});

describe("concept maps (service)", () => {
	it("every demo lecture's map parses with the engine's mermaid parser and matches its question nodeIds", () => {
		const { svc } = setup();
		for (const id of ["hci-w1-intro", "hci-w2-users", "hci-w3-personas", "hci-w4-fieldwork", "gt-w1-dominance", "gt-w2-nash", "gt-w3-mixed"]) {
			const map = svc.lectureMap(id);
			assert.equal(map.source, "authored", id);
			const ids = new Set(map.nodes.map((n) => n.id));
			const set = JSON.parse(fs.readFileSync(path.join(CONTENT, id, "questions.json"), "utf-8")) as { questions: { nodeId: string }[] };
			for (const q of set.questions) assert.ok(ids.has(q.nodeId), `${id}: question node ${q.nodeId} is on the map`);
		}
	});

	it("answers colour the map", async () => {
		const { svc } = setup();
		const { sessionId } = svc.createSession(svc.parseSpec({ kind: "post-lecture", lectureId: "hci-w3-personas" }));
		await svc.whenReady(sessionId);
		const v = await svc.view(sessionId);
		const right = v.question!.options.find((o) => o.label.startsWith("To focus"))!;
		await svc.answer(sessionId, { questionId: v.question!.id, indices: [right.index], confidence: 90 });
		const v2 = await svc.view(sessionId);
		await svc.answer(sessionId, { questionId: v2.question!.id, indices: [v2.question!.options.find((o) => !o.label.startsWith("A pattern"))!.index], confidence: 50 });
		const map = svc.lectureMap("hci-w3-personas");
		const status = Object.fromEntries(map.nodes.map((n) => [n.id, n.status]));
		assert.equal(status["persona-purpose"], "solid");
		assert.equal(status["persona-basis"], "revisit");
		assert.equal(status["scenario-value"], "notyet");
		assert.equal(svc.openMisses("hci-w3-personas").misses.length, 1);
	});

	it("serves slide sections", () => {
		const { svc } = setup();
		const { slides } = svc.lectureSlides("hci-w3-personas");
		assert.equal(slides.length, 10);
		assert.equal(slides[3]!.title, "What personas are for");
	});
});

describe("calendar links (F-03)", () => {
	const ics = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:1\r\nSUMMARY:HCI Lecture\r\nDTSTART:20261117T110000\r\nDTEND:20261117T130000\r\nEND:VEVENT\r\nEND:VCALENDAR";

	it("subscribes via the injected fetcher, normalises webcal://, remembers the link and refreshes it", async () => {
		const seen: string[] = [];
		const { svc, store } = setup(async (url) => { seen.push(url); return ics; });
		const r = await svc.subscribeCalendar("webcal://example.org/me.ics");
		assert.equal(r.added, 1);
		assert.deepEqual(seen, ["https://example.org/me.ics"]);
		assert.equal(store.runtime().calendarUrl, "https://example.org/me.ics");
		await svc.refreshCalendar();
		assert.equal(seen.length, 2);
	});

	it("refuses non-http links and reports fetch failures", async () => {
		const { svc } = setup(async () => { throw new Error("that link points at a private network address"); });
		await assert.rejects(svc.subscribeCalendar("file:///etc/passwd"), /https:\/\/ or webcal/);
		await assert.rejects(svc.subscribeCalendar("https://10.0.0.1/x.ics"), /private network/);
	});

	it("blocks private, loopback and link-local addresses", () => {
		for (const ip of ["127.0.0.1", "10.2.3.4", "172.16.0.1", "192.168.1.1", "169.254.169.254", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "0.0.0.0"]) assert.equal(isPrivateAddress(ip), true, ip);
		for (const ip of ["8.8.8.8", "151.101.1.1", "2606:4700::1111"]) assert.equal(isPrivateAddress(ip), false, ip);
	});
});
