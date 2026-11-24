/**
 * Gaps by idea (v2.0, V-39, V-43): a gap belongs to an idea, and the idea
 * leaves the list after two right answers on different questions, on
 * different days, each "Fairly sure" or "Certain".
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { ManualClock } from "../src/server/companion/clock.ts";
import { CompanionContent } from "../src/server/companion/content.ts";
import { ScriptedEngine } from "../src/server/companion/engines/scripted.ts";
import { CompanionService } from "../src/server/companion/service.ts";
import { CompanionStore } from "../src/server/companion/store.ts";
import { closeGaps, countedRights, GAP_RULES, gapsByIdea, GENERAL_IDEA, ideaKeyOfMiss, type Miss, type RightAnswer } from "../src/core/companion/index.ts";

const day = (d: number, h = 12) => new Date(2026, 10, d, h); // November 2026
const miss = (id: string, over: Partial<Miss> = {}): Miss => ({
	id, lectureId: "gt-2", sessionId: "s1", questionId: `q-${id}`, nodeId: "nash", questionText: `${id}?`, correctLabels: ["Right"], reason: "wrong",
	status: "open", timesSeen: 0, nextDue: day(21).toISOString(), createdAt: day(20).toISOString(), ...over,
});
const right = (questionId: string, at: Date, confidence: number | null = 70, ideaKey = "gt-2#nash"): RightAnswer => ({ ideaKey, questionId, at, confidence });

describe("which right answers count towards closing a gap (V-43)", () => {
	const since = day(20);
	const table: [string, RightAnswer[], string[]][] = [
		["nothing yet", [], []],
		["one right, fairly sure", [right("a", day(21))], ["a"]],
		["two right on different questions and days: closed", [right("a", day(21)), right("b", day(22))], ["a", "b"]],
		["two on the same day count once", [right("a", day(21, 9)), right("b", day(21, 15))], ["a"]],
		["the same question twice counts once", [right("a", day(21)), right("a", day(22))], ["a"]],
		["unsure answers don't count", [right("a", day(21), 30), right("b", day(22), 0)], []],
		["an answer with no confidence given doesn't count", [right("a", day(21), null), right("b", day(22))], ["b"]],
		["certain counts", [right("a", day(21), 100), right("b", day(23), 100)], ["a", "b"]],
		["answers before the miss don't count", [right("a", day(19)), right("b", day(21))], ["b"]],
		["an answer at the moment of the miss doesn't count", [right("a", day(20))], []],
		["order doesn't matter", [right("b", day(22)), right("a", day(21))], ["a", "b"]],
		["a lucky day then a real one", [right("a", day(21), 30), right("b", day(21, 14)), right("c", day(24))], ["b", "c"]],
	];
	for (const [name, rights, expected] of table) {
		it(name, () => assert.deepEqual(countedRights(since, rights).map((r) => r.questionId), expected));
	}
	it("the numbers", () => assert.deepEqual([GAP_RULES.rightAnswers, GAP_RULES.sureConfidence], [2, 70]));
});

describe("gaps are grouped by idea", () => {
	it("two missed questions on one idea are one gap; another idea is another", () => {
		const gaps = gapsByIdea([miss("m1"), miss("m2", { createdAt: day(21).toISOString() }), miss("m3", { nodeId: "mixed" })], []);
		assert.deepEqual(gaps.map((g) => [g.key, g.misses.map((m) => m.id), g.right, g.needed]), [["gt-2#nash", ["m2", "m1"], 0, 2], ["gt-2#mixed", ["m3"], 0, 2]]);
	});

	it("a question with no idea tagged belongs to its unit as a whole", () => {
		const m = miss("m1", { nodeId: undefined });
		assert.equal(ideaKeyOfMiss(m), `gt-2#${GENERAL_IDEA}`);
		assert.equal(gapsByIdea([m], [])[0]!.nodeId, GENERAL_IDEA);
	});

	it("the same idea name in two units is two gaps", () => {
		assert.equal(gapsByIdea([miss("m1"), miss("m2", { lectureId: "gt-3" })], []).length, 2);
	});

	it("solid misses are not gaps", () => {
		assert.deepEqual(gapsByIdea([miss("m1", { status: "solid" })], []), []);
	});

	it("confident errors come first, then the most recent", () => {
		const gaps = gapsByIdea([
			miss("old", { nodeId: "a", createdAt: day(10).toISOString() }),
			miss("new", { nodeId: "b", createdAt: day(22).toISOString() }),
			miss("sure", { nodeId: "c", createdAt: day(5).toISOString(), confidence: 100 }),
			miss("dk", { nodeId: "d", createdAt: day(23).toISOString(), reason: "dont-know", confidence: 100 }),
		], []);
		assert.deepEqual(gaps.map((g) => [g.nodeId, g.confidentError]), [["c", true], ["d", false], ["b", false], ["a", false]]);
	});

	it("progress is shown, and a new miss starts the count again", () => {
		const one = gapsByIdea([miss("m1")], [right("a", day(21))]);
		assert.deepEqual([one[0]!.right, one[0]!.needed], [1, 2]);
		const again = gapsByIdea([miss("m1"), miss("m2", { createdAt: day(22).toISOString() })], [right("a", day(21))]);
		assert.equal(again[0]!.right, 0, "the right answer came before the latest miss");
	});

	it("right answers on another idea don't help", () => {
		assert.equal(gapsByIdea([miss("m1")], [right("a", day(21), 70, "gt-2#mixed"), right("b", day(22), 70, "gt-2#mixed")])[0]!.right, 0);
	});
});

describe("closing a gap", () => {
	const now = day(23);
	it("two counted right answers make every open miss on the idea solid", () => {
		const misses = [miss("m1"), miss("m2"), miss("other", { nodeId: "mixed" })];
		const out = closeGaps(misses, [right("a", day(21)), right("b", day(22))], now);
		assert.deepEqual(out.map((m) => [m.id, m.status, m.solidAt ?? null]), [["m1", "solid", now.toISOString()], ["m2", "solid", now.toISOString()], ["other", "open", null]]);
	});
	it("one is not enough, and nothing changes", () => {
		const misses = [miss("m1")];
		assert.equal(closeGaps(misses, [right("a", day(21))], now), misses, "the same array back");
	});
	it("a gap already solid stays as it was", () => {
		const solid = miss("m1", { status: "solid", solidAt: day(15).toISOString() });
		assert.equal(closeGaps([solid], [right("a", day(21)), right("b", day(22))], now)[0]!.solidAt, day(15).toISOString());
	});
});

// ─── through the service ────────────────────────────────────────────────────

async function setup(now: Date) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "companion-gaps-"));
	const store = new CompanionStore(dir);
	const content = new CompanionContent(store, path.join(import.meta.dirname, "..", "companion", "content"));
	const clock = new ManualClock(now);
	let n = 0;
	const engine = () => new ScriptedEngine((id) => content.scriptedSet(id), (picks) => content.practiseSet(picks));
	const svc = new CompanionService({
		store, content, clock,
		clockControl: { set: (t) => clock.set(t), reset: () => clock.set(now) },
		engines: { scripted: engine(), learnharness: engine() },
		defaultEngine: "scripted",
		generate: (async () => { throw new Error("not called"); }) as never,
		newId: (p) => `${p}${++n}`,
	});
	await svc.onboardFlow({ calendar: { kind: "none" }, modules: [{ code: "GT", name: "Game Theory" }] });
	store.saveLectures([...store.allLectures(), { id: "gt-2", module: "GT", title: "Nash", week: 0, order: 9, kind: "lecture", hasMaterials: true, source: { file: "notes.pdf", pages: [1, 9] } }]);
	fs.mkdirSync(store.materialsDir("gt-2"), { recursive: true });
	fs.writeFileSync(path.join(store.materialsDir("gt-2"), "slides.md"), "# Nash\n\n## Slide 1 — Nash\n\nText.\n");
	fs.writeFileSync(path.join(store.materialsDir("gt-2"), "map.mmd"), 'graph TD\n  nash["Nash equilibrium · S1"]\n');
	fs.writeFileSync(path.join(store.materialsDir("gt-2"), "bank.json"), JSON.stringify([1, 2, 3].map((i) => ({ id: `gt-2-q${i}`, stem: `Nash ${i}?`, options: ["Right", "Wrong A", "Wrong B"], correct: 0, explanation: "Because (Slide 1).", slides: [1], node: "nash", difficulty: i }))));
	/** One session on the unit: every question answered; `wrong` names the stems answered wrongly. */
	const session = async (wrong: string[], confidence: number | undefined) => {
		const { sessionId } = svc.createSession(svc.parseSpec({ kind: "post-lecture", lectureId: "gt-2" }));
		await svc.whenReady(sessionId);
		for (;;) {
			const v = await svc.view(sessionId);
			if (v.status !== "question" || !v.question) return;
			const want = wrong.includes(v.question.stem) ? "Wrong A" : "Right";
			await svc.answer(sessionId, { questionId: v.question.id, indices: [v.question.options.findIndex((o) => o.label === want) + 1], ...(confidence === undefined ? {} : { confidence }) });
		}
	};
	return { svc, store, clock, session };
}

describe("a gap closes after two sure right answers on different days, through the service (V-43)", () => {
	it("day 1 a miss; day 2 one right; day 3 a second right on another question closes it", async () => {
		const { store, clock, session } = await setup(day(20, 13));
		await session(["Nash 1?"], 100);
		const m = store.misses()[0]!;
		assert.deepEqual([m.status, m.nodeId, m.chosen, m.reason, m.confidence], ["open", "nash", ["Wrong A"], "wrong", 100], "what was chosen is kept with the miss");
		assert.deepEqual(store.events().filter((e) => e.type === "answer")[0]!.data.chosen, ["Wrong A"]);

		clock.set(day(21, 13));
		await session([], 70);
		assert.equal(store.misses()[0]!.status, "open", "three right answers on one day count once");

		clock.set(day(22, 13));
		await session([], 70);
		assert.equal(store.misses()[0]!.status, "solid");
		assert.equal(store.misses()[0]!.solidAt, day(22, 13).toISOString());
		const closed = store.events().filter((e) => e.type === "gap_closed");
		assert.deepEqual(closed.map((e) => e.data), [{ idea: "gt-2#nash", questions: 1 }]);
	});

	it("right answers given without saying how sure never close it", async () => {
		const { store, clock, session } = await setup(day(20, 13));
		await session(["Nash 1?"], 70);
		for (const d of [21, 22, 23]) {
			clock.set(day(d, 13));
			await session([], undefined);
		}
		assert.equal(store.misses()[0]!.status, "open");
	});

	it("missing it again starts the count again", async () => {
		const { store, clock, session } = await setup(day(20, 13));
		await session(["Nash 1?"], 70);
		clock.set(day(21, 13));
		await session([], 70);
		clock.set(day(22, 13));
		await session(["Nash 2?"], 70);
		assert.deepEqual(store.misses().map((x) => x.status), ["open", "open"], "the second right answer of day 22 came before the new miss");
		clock.set(day(23, 13));
		await session([], 70);
		assert.deepEqual(store.misses().map((x) => x.status), ["open", "open"], "one counted since the new miss");
		clock.set(day(24, 13));
		await session([], 70);
		assert.deepEqual(store.misses().map((x) => x.status), ["solid", "solid"], "both questions on the idea close together");
	});
});

