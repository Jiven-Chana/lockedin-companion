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
import { assignQuestionIds, nextGapId, stemKey, type BankQuestion } from "../src/core/companion/study-pack.ts";

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
	const replies: unknown[] = [];
	const asked: { user: string; system: string }[] = [];
	const engine = () => new ScriptedEngine((id) => content.scriptedSet(id), (picks) => content.practiseSet(picks));
	const svc = new CompanionService({
		store, content, clock,
		clockControl: { set: (t) => clock.set(t), reset: () => clock.set(now) },
		engines: { scripted: engine(), learnharness: engine() },
		defaultEngine: "scripted",
		// A stand-in for the AI: it returns what the test queued, after running the caller's own check on it.
		generate: (async (req: { user: string; system: string; validate?: (v: unknown) => string | null }) => {
			asked.push({ user: req.user, system: req.system });
			const value = replies.shift();
			if (!value) throw new Error("the AI did not answer");
			const problem = req.validate?.(value) ?? null;
			if (problem) throw new Error(problem);
			return { value, model: "fake/model" };
		}) as never,
		promptsDir: path.join(import.meta.dirname, "..", "companion", "prompts"),
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
	return { svc, store, clock, session, replies, asked };
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

describe("the gaps list: module, idea, the questions missed (V-39)", () => {
	it("names the idea and its unit, what was chosen, and how far it is towards leaving", async () => {
		const { svc, clock, session } = await setup(day(20, 13));
		assert.deepEqual(svc.gaps(), { modules: [], ideas: 0 });
		await session(["Nash 1?", "Nash 3?"], 100);
		let g = svc.gaps();
		assert.deepEqual([g.ideas, g.modules.map((m) => [m.code, m.name, m.ideas.length])], [1, [["GT", "Game Theory", 1]]]);
		const idea = g.modules[0]!.ideas[0]!;
		assert.deepEqual([idea.key, idea.title, idea.unit, idea.missed, idea.right, idea.needed, idea.confidentError, idea.canPractise], ["gt-2#nash", "Nash equilibrium", "Nash", 2, 0, 2, true, true]);
		assert.deepEqual(idea.questions.map((q) => [q.text, q.chosen, q.correct, q.reason, q.slide]).sort(), [["Nash 1?", ["Wrong A"], ["Right"], "wrong", 1], ["Nash 3?", ["Wrong A"], ["Right"], "wrong", 1]]);

		clock.set(day(21, 13));
		await session([], 70);
		g = svc.gaps();
		assert.deepEqual([g.modules[0]!.ideas[0]!.right, g.modules[0]!.ideas[0]!.missed], [1, 2]);

		clock.set(day(22, 13));
		await session([], 70);
		assert.deepEqual(svc.gaps(), { modules: [], ideas: 0 }, "the idea has left the list");
	});

	it("\"Practise this idea\" is a round on that idea only", async () => {
		const { svc, store, session } = await setup(day(20, 13));
		// A second idea in the same unit, so staying on one idea means something.
		const bankFile = path.join(store.materialsDir("gt-2"), "bank.json");
		const bank = JSON.parse(fs.readFileSync(bankFile, "utf-8")) as { id: string; stem: string; node: string }[];
		fs.writeFileSync(bankFile, JSON.stringify([...bank, { ...bank[0], id: "gt-2-q4", stem: "Mixed 4?", node: "mixed" }, { ...bank[0], id: "gt-2-q5", stem: "Mixed 5?", node: "mixed" }]));
		await session(["Nash 1?"], 70);
		const { sessionId } = svc.startPractise({ module: "GT", idea: "gt-2#nash" });
		const spec = store.session(sessionId)!.spec;
		assert.deepEqual([spec.practise!.idea, spec.practise!.picks.map((p) => p.questionId).sort()], ["gt-2#nash", ["gt-2-q1", "gt-2-q2", "gt-2-q3"]]);
		await assert.rejects(svc.more(sessionId, {}), (e: { code?: string }) => e.code === "no_more_questions", "more stays on the idea too");
		assert.throws(() => svc.startPractise({ module: "GT", idea: "gt-2#nothing" }), (e: { status?: number; code?: string }) => e.status === 422 && e.code === "no_questions");
		assert.throws(() => svc.startPractise({ module: "GT", idea: "nash" }), (e: { status?: number }) => e.status === 400);
	});
});

describe("a question keeps its id when a study pack is written again (V-39)", () => {
	const fresh = (stem: string, node = "nash"): Omit<BankQuestion, "id"> => ({ stem, options: ["A", "B", "C"], correct: 0, explanation: "Because.", slides: [1], node, difficulty: 1 });
	const had = (id: string, stem: string, over: Partial<BankQuestion> = {}): BankQuestion => ({ ...fresh(stem), id, ...over });

	it("a first pack numbers from 1", () => {
		const r = assignQuestionIds("gt-2", [fresh("One?"), fresh("Two?")], []);
		assert.deepEqual([r.bank.map((q) => q.id), r.lastNumber], [["gt-2-q1", "gt-2-q2"], 2]);
	});

	it("the same question keeps its id wherever it now sits; a new one never takes an old number", () => {
		const previous = [had("gt-2-q1", "What is a Nash equilibrium?"), had("gt-2-q2", "Dropped this time?"), had("gt-2-q3", "Why is (B, R) stable?")];
		const r = assignQuestionIds("gt-2", [fresh("Why is (B,R) stable"), fresh("A brand new question?"), fresh("what is a nash equilibrium?")], previous, 3);
		assert.deepEqual(r.bank.map((q) => q.id), ["gt-2-q3", "gt-2-q4", "gt-2-q1"]);
		assert.equal(r.lastNumber, 4);
	});

	it("a number is never reused, even after the question that had it is gone", () => {
		const r = assignQuestionIds("gt-2", [fresh("New?")], [had("gt-2-q2", "Old?")], 9);
		assert.deepEqual([r.bank[0]!.id, r.lastNumber], ["gt-2-q10", 10]);
	});

	it("two new questions with the same words don't share an id", () => {
		const r = assignQuestionIds("gt-2", [fresh("Same?"), fresh("Same?")], [had("gt-2-q1", "Same?")]);
		assert.deepEqual(r.bank.map((q) => q.id), ["gt-2-q1", "gt-2-q2"]);
	});

	it("questions written for a gap are kept while their idea is on the map", () => {
		const previous = [had("gt-2-q1", "One?"), had("gt-2-g1", "Written for a gap?", { origin: "gap" }), had("gt-2-g2", "On an idea that is gone?", { origin: "gap", node: "old" })];
		const r = assignQuestionIds("gt-2", [fresh("One?")], previous, 1, new Set(["nash"]));
		assert.deepEqual(r.bank.map((q) => [q.id, q.origin ?? null]), [["gt-2-q1", null], ["gt-2-g1", "gap"]]);
	});

	it("stems match by their words, not their punctuation or case", () => {
		assert.equal(stemKey("  Why is (B, R)  stable? "), stemKey("why is b r stable"));
		assert.notEqual(stemKey("Why is (B, R) stable?"), stemKey("Why is (T, L) stable?"));
	});

	it("gap ids count up and never collide", () => {
		assert.equal(nextGapId("gt-2", []), "gt-2-g1");
		assert.equal(nextGapId("gt-2", [had("gt-2-q7", "x"), had("gt-2-g3", "y", { origin: "gap" })]), "gt-2-g4");
		assert.equal(nextGapId("gt-2", [had("gt-2-g3", "y", { origin: "gap" })], 2), "gt-2-g6");
	});
});

describe("new questions written around a gap (V-39)", () => {
	const written = (stem: string, over: Record<string, unknown> = {}) => ({ stem, options: ["Right", "Wrong A", "Wrong B"], correct: 0, explanation: "Because (Slide 1).", slides: [1], node: "nash", difficulty: 2, ...over });
	const missed = [{ stem: "Nash 1?", chosen: ["Wrong A"], correct: ["Right"], reason: "wrong", confidence: 100, why: "I thought both players had to be happy" }];

	it("the AI is told the idea, what was chosen and why, and what already exists; its questions join the bank marked as gap questions", async () => {
		const { svc, store, replies, asked } = await setup(day(20, 13));
		replies.push({ questions: [written("Can one player gain by changing alone at a Nash equilibrium?"), written("Is a Nash equilibrium always best for both players?", { difficulty: 3 }), written("What stops a player moving away from a Nash equilibrium?")] });
		const out = await svc.packs!.writeForIdea("gt-2", "nash", missed, 3);
		assert.deepEqual(out.map((q) => [q.id, q.origin, q.node]), [["gt-2-g1", "gap", "nash"], ["gt-2-g2", "gap", "nash"], ["gt-2-g3", "gap", "nash"]]);
		const user = asked[0]!.user;
		for (const part of ["nash: Nash equilibrium", "WRITE 3 QUESTIONS", "They chose: Wrong A", "How sure they were: 100%", "I thought both players had to be happy", "- Nash 1?", "SLIDES"]) assert.ok(user.includes(part), `the request includes "${part}"`);
		assert.match(asked[0]!.system, /never gives the answer away/);
		const bank = JSON.parse(fs.readFileSync(path.join(store.materialsDir("gt-2"), "bank.json"), "utf-8")) as { id: string }[];
		assert.deepEqual(bank.map((q) => q.id), ["gt-2-q1", "gt-2-q2", "gt-2-q3", "gt-2-g1", "gt-2-g2", "gt-2-g3"]);
		assert.deepEqual(store.events().filter((e) => e.type === "gap_questions_written").map((e) => [e.data.written, e.data.asked, e.data.node]), [[3, 3, "nash"]]);
	});

	it("a repeat of an existing question, a question on another idea, or one that breaks the rules is not used", async () => {
		const { svc, replies } = await setup(day(20, 13));
		replies.push({ questions: [written("nash 1"), written("On another idea?", { node: "mixed" }), written("x".repeat(220)), written("A good one?"), written("Another good one?"), written("A third good one?")] });
		const out = await svc.packs!.writeForIdea("gt-2", "nash", missed, 5);
		assert.deepEqual(out.map((q) => q.stem), ["A good one?", "Another good one?", "A third good one?"]);
	});

	it("too few usable questions is a failed try, with the reasons sent back", async () => {
		const { svc, replies } = await setup(day(20, 13));
		replies.push({ questions: [written("Nash 1?"), written("Only one good?")] });
		await assert.rejects(svc.packs!.writeForIdea("gt-2", "nash", missed, 5), /fix these questions: #1: this repeats an existing question/);
	});

	it("an idea that is not on the unit's map can't be written for", async () => {
		const { svc } = await setup(day(20, 13));
		await assert.rejects(svc.packs!.writeForIdea("gt-2", "sampling", missed, 5), /not on the unit's map/);
	});

	it("with no AI connected, \"Practise this idea\" still runs, on the idea's own questions", async () => {
		const { svc, store, session } = await setup(day(20, 13));
		await session(["Nash 1?"], 70);
		const r = await svc.practise({ module: "GT", idea: "gt-2#nash" });
		assert.equal(r.written, 0);
		assert.equal(store.session(r.sessionId)!.spec.practise!.picks.length, 3);
	});

	it("questions just written lead the round, and the rest are the idea's least-asked", async () => {
		const { svc, store, replies, session } = await setup(day(20, 13));
		await session(["Nash 1?"], 70);
		replies.push({ questions: [written("New one?"), written("New two?"), written("New three?")] });
		const fresh = await svc.packs!.writeForIdea("gt-2", "nash", missed, 3);
		const { sessionId } = svc.startPractise({ module: "GT", idea: "gt-2#nash" }, fresh.map((q) => q.id));
		const picks = store.session(sessionId)!.spec.practise!.picks.map((p) => p.questionId);
		assert.deepEqual(picks.slice(0, 3), ["gt-2-g1", "gt-2-g2", "gt-2-g3"]);
		assert.equal(picks.length, 5);
		assert.equal(new Set(picks).size, 5);
		await svc.whenReady(sessionId);
		const v = await svc.view(sessionId);
		assert.deepEqual([v.question?.stem, v.question?.ai, v.question?.slides], ["New one?", true, [1]], "a pack question says it was written by AI, with its slide");
	});
});

