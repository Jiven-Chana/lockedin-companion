/**
 * One user action is one event (v1.0 X-1). The log is T23's data: 4
 * identical `session_opened` rows within 20 ms were seen in real use, and a
 * check-in logged `checkin_shown` on every answer.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { ManualClock } from "../src/server/companion/clock.ts";
import { CompanionContent } from "../src/server/companion/content.ts";
import { ScriptedEngine } from "../src/server/companion/engines/scripted.ts";
import type { SessionEngine } from "../src/server/companion/engines/types.ts";
import { CompanionService, type CompanionServiceDeps } from "../src/server/companion/service.ts";
import { CompanionStore } from "../src/server/companion/store.ts";

const CONTENT = path.join(import.meta.dirname, "..", "companion", "content");
const NOW = new Date(2026, 10, 17, 12, 58); // Tue 17 Nov 2026

function setup(over: Partial<CompanionServiceDeps> = {}, dir = fs.mkdtempSync(path.join(os.tmpdir(), "companion-events-"))) {
	const store = new CompanionStore(dir);
	const content = new CompanionContent(store, CONTENT);
	const clock = new ManualClock(NOW);
	const scripted = new ScriptedEngine((id) => content.scriptedSet(id));
	let n = 0;
	const svc = new CompanionService({
		store, content, clock,
		clockControl: { set: (t) => clock.set(t), reset: () => clock.set(NOW) },
		engines: { scripted, learnharness: scripted },
		defaultEngine: "scripted",
		newId: (p) => `${p}${++n}`,
		...over,
	});
	const count = (type: string) => store.events().filter((e) => e.type === type).length;
	const of = (type: string) => store.events().filter((e) => e.type === type).map((e) => e.data);
	return { svc, store, clock, dir, count, of };
}

describe("opening a session", () => {
	/** An engine whose view takes a moment, like a real one: the screen's 750 ms updates overlap it. */
	function slowEngine(inner: SessionEngine): SessionEngine {
		return {
			name: inner.name,
			start: (s, c) => inner.start(s, c),
			waitUntilReady: (s, ms, on) => inner.waitUntilReady(s, ms, on),
			view: async (s, l) => {
				await new Promise((r) => setTimeout(r, 5));
				return inner.view(s, l);
			},
			answer: (s, a, now) => inner.answer(s, a, now),
			showMe: (s, q, now) => inner.showMe(s, q, now),
			hint: (s, q) => inner.hint(s, q),
			more: (s, n) => inner.more(s, n),
			retry: (s) => inner.retry(s),
			cost: (s) => inner.cost(s),
			remove: (s) => inner.remove(s),
		};
	}

	it("four overlapping screen updates log one session_opened and one question_shown", async () => {
		const base = setup();
		const scripted = new ScriptedEngine((id) => new CompanionContent(base.store, CONTENT).scriptedSet(id));
		const { svc, count } = setup({ engines: { scripted: slowEngine(scripted), learnharness: slowEngine(scripted) } }, base.dir);
		svc.onboard({});
		const { sessionId } = svc.createSession(svc.parseSpec({ kind: "try-now", lectureId: "hci-w3-personas" }));
		await svc.whenReady(sessionId);
		await Promise.all([svc.view(sessionId), svc.view(sessionId), svc.view(sessionId), svc.view(sessionId)]);
		await svc.view(sessionId);
		assert.equal(count("session_opened"), 1);
		assert.equal(count("question_shown"), 1);
	});

	it("coming back to a stopped session is one more session_opened, marked resumed", async () => {
		const { svc, of } = setup();
		svc.onboard({});
		const { sessionId } = svc.createSession(svc.parseSpec({ kind: "try-now", lectureId: "hci-w3-personas" }));
		await svc.whenReady(sessionId);
		await svc.view(sessionId);
		svc.stop(sessionId);
		await Promise.all([svc.view(sessionId), svc.view(sessionId)]);
		assert.deepEqual(of("session_opened").map((d) => d.resumed), [false, true]);
	});
});

describe("the Sunday check-in", () => {
	function withTarget() {
		const s = setup();
		s.svc.onboard({});
		s.svc.updatePlanSettings({ weeklyTargetMinutes: 300 });
		return s;
	}

	it("showing it once and answering it logs checkin_shown once", () => {
		const { svc, count } = withTarget();
		svc.checkin();
		const { proposed } = svc.answerCheckin({ feeling: "too-much" });
		svc.answerCheckin({ target: proposed });
		assert.equal(count("checkin_shown"), 1);
		assert.equal(count("checkin_answered"), 1);
	});

	it("a target changed in the check-in is one target_changed, via the check-in, and no settings_changed", () => {
		const { svc, count, of } = withTarget();
		const before = count("settings_changed");
		svc.checkin();
		const { proposed, current } = svc.answerCheckin({ feeling: "too-much" });
		assert.notEqual(proposed, current);
		svc.answerCheckin({ target: proposed });
		assert.deepEqual(of("target_changed").map((d) => [d.via, d.from, d.to]), [["settings", null, 300], ["checkin", 300, proposed]]);
		assert.equal(count("settings_changed"), before, "the check-in isn't a settings change");
	});

	it("keeping the target logs target_kept and nothing else about the target", () => {
		const { svc, count } = withTarget();
		svc.checkin();
		svc.answerCheckin({ feeling: "about-right" });
		svc.answerCheckin({ keep: true });
		assert.deepEqual([count("checkin_shown"), count("target_kept"), count("target_changed")], [1, 1, 1]);
	});
});

describe("the AI becoming ready", () => {
	const noteAiReady = (svc: CompanionService, ready: boolean) => (svc as unknown as { noteAiReady: (r: boolean) => void }).noteAiReady(ready);

	it("is logged when it happens, not again on every restart", () => {
		const first = setup({ engineWhenAiReady: "learnharness" });
		first.svc.onboard({});
		noteAiReady(first.svc, true);
		noteAiReady(first.svc, true);
		assert.equal(first.count("engine_ready"), 1);
		// A restart: a new service on the same data folder, and the AI is still connected.
		const second = setup({ engineWhenAiReady: "learnharness" }, first.dir);
		noteAiReady(second.svc, true);
		assert.equal(second.count("engine_ready"), 1, "still one");
		assert.equal(second.svc.defaultEngine(), "learnharness", "and the engine is still the real one");
	});

	it("disconnecting and connecting again is a second engine_ready", () => {
		const { svc, count } = setup({ engineWhenAiReady: "learnharness" });
		svc.onboard({});
		noteAiReady(svc, true);
		noteAiReady(svc, false);
		noteAiReady(svc, true);
		assert.equal(count("engine_ready"), 2);
	});
});

describe("the screens log through the server, once", () => {
	const read = (file: string) => fs.readFileSync(path.join(import.meta.dirname, "..", file), "utf-8");

	it("saving course material is materials_saved from the server only", () => {
		assert.doesNotMatch(read("components/lockedin/material-upload.tsx"), /lockedIn\.event\(/, "the upload screen doesn't log a second event for the save");
	});
});
