/**
 * Progress and the Week timetable through CompanionService (v1.1, V-34 to
 * V-37): the score from real history, what each module contributed, what
 * needs attention with its one action, milestones that are kept, and study
 * blocks that carry a module and can't be dropped on a lecture.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { PLACEMENT_COPY, placementProblem, PROGRESS_COPY, SCORE_RULES, type Lecture, type StudyBlock } from "../src/core/companion/index.ts";
import { ManualClock } from "../src/server/companion/clock.ts";
import { CompanionContent } from "../src/server/companion/content.ts";
import { ScriptedEngine } from "../src/server/companion/engines/scripted.ts";
import { CompanionError } from "../src/server/companion/errors.ts";
import { CompanionService } from "../src/server/companion/service.ts";
import { CompanionStore } from "../src/server/companion/store.ts";

const CONTENT = path.join(import.meta.dirname, "..", "companion", "content");
const day = (d: number, h = 12, m = 0) => new Date(2026, 10, d, h, m); // November 2026; the 23rd is a Monday

async function setup(now = day(26, 9)) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "companion-progress-"));
	const store = new CompanionStore(dir);
	const content = new CompanionContent(store, CONTENT);
	const clock = new ManualClock(now);
	let n = 0;
	const svc = new CompanionService({
		store, content, clock,
		clockControl: { set: (t) => clock.set(t), reset: () => clock.set(now) },
		engines: { scripted: new ScriptedEngine((id) => content.scriptedSet(id)), learnharness: new ScriptedEngine((id) => content.scriptedSet(id)) },
		defaultEngine: "scripted",
		generate: (async () => { throw new Error("not called"); }) as never,
		newId: (p) => `${p}${++n}`,
	});
	await svc.onboardFlow({ calendar: { kind: "none" }, modules: [{ code: "NC", name: "Neural Computation" }, { code: "GT", name: "Game Theory" }, { code: "HCI", name: "Human Computer Interaction" }] });
	/** A unit with a study pack: a map of its ideas and a question bank. */
	const addUnit = (id: string, module: string, title: string, nodes: string[]) => {
		store.saveLectures([...store.allLectures(), { id, module, title, week: 0, order: store.allLectures().length + 1, kind: "lecture", hasMaterials: true, source: { file: "notes.pdf", pages: [1, 4] } }]);
		fs.mkdirSync(store.materialsDir(id), { recursive: true });
		fs.writeFileSync(path.join(store.materialsDir(id), "slides.md"), `# ${title}\n\n## Slide 1 — ${title}\n\nText.\n`);
		fs.writeFileSync(path.join(store.materialsDir(id), "map.mmd"), ["graph TD", ...nodes.map((x) => `  ${x}["${x.replace(/-/g, " ")} · S1"]`), ""].join("\n"));
		fs.writeFileSync(path.join(store.materialsDir(id), "bank.json"), JSON.stringify(nodes.map((x, i) => ({ id: `${id}-q${i + 1}`, stem: `${x}?`, options: ["Right", "Wrong A", "Wrong B"], correct: 0, explanation: "Because (Slide 1).", slides: [1], node: x, difficulty: i === 0 ? 3 : 1 }))));
	};
	addUnit("nc-gans", "NC", "GANs", ["generator", "discriminator"]);
	addUnit("gt-nash", "GT", "Nash equilibrium", ["best-response"]);
	/** A session answer, logged at the clock's time. */
	const answer = (at: Date, lectureId: string, questionId: string, over: Record<string, unknown> = {}) => {
		clock.set(at);
		svc.log("answer", { sessionId: `s-${at.getTime()}`, lectureId, questionId, graded: true, correct: true, dontKnow: false, msOnQuestion: 60_000, ...over });
		clock.set(now);
	};
	const types = () => store.events().map((e) => e.type);
	return { svc, store, clock, answer, addUnit, types };
}

describe("the learning score, from real history", () => {
	it("a new student starts at zero, with a steady-pace line to what the course is worth", async () => {
		const { svc } = await setup();
		const p = svc.progress();
		assert.deepEqual([p.score.now, p.score.weekChange, p.score.ideasSecured, p.score.ideasTotal], [0, 0, 0, 3]);
		assert.equal(p.score.term.target, 3 * (SCORE_RULES.rightAnswer[2]! + SCORE_RULES.ideaSecured));
		assert.deepEqual([p.score.series.week.length, p.score.series.month.length], [7, 30]);
		assert.ok(p.score.series.term.length >= 12, "no timetable: a 12-week term");
	});

	it("answers earn by the bank question's difficulty and idea; the chart's points say what happened", async () => {
		const { svc, answer } = await setup();
		answer(day(23, 10), "nc-gans", "nc-gans-q1"); // difficulty 3, generator
		answer(day(24, 10), "nc-gans", "nc-gans-q2", { correct: false }); // discriminator, wrong
		answer(day(25, 10), "nc-gans", "nc-gans-q2"); // …and back
		const p = svc.progress();
		assert.equal(p.score.now, 20 + 20 + 0 + (10 + 25));
		assert.equal(p.score.weekChange, 75, "all of it this week");
		assert.deepEqual([p.score.ideasSecured, p.score.fading], [2, 0]);
		const [mon, tue, wed, thu] = p.score.series.week;
		assert.deepEqual([mon!.score, tue!.score, wed!.score, thu!.score], [40, 40, 75, 75]);
		assert.deepEqual(wed!.detail.cameBack.map((k) => p.ideas[k]), [{ title: "discriminator", unit: "GANs", module: "NC" }]);
		assert.deepEqual(mon!.detail.secured.map((k) => p.ideas[k]!.title), ["generator"]);
		assert.ok(mon!.milestones.includes("first-idea") && wed!.milestones.includes("came-back"), "milestones sit on the day they were earned");
	});

	it("where it came from: points and time per module, with the empty ones still listed", async () => {
		const { svc, answer } = await setup();
		answer(day(23, 10), "nc-gans", "nc-gans-q1");
		answer(day(25, 10), "gt-nash", "gt-nash-q1");
		const p = svc.progress();
		assert.deepEqual(p.modules.map((m) => [m.code, m.hasMaterial, m.shares.week.points, m.shares.week.minutes]), [["NC", true, 40, 1], ["GT", true, 40, 1], ["HCI", false, 0, 0]]);
		assert.equal(p.modules[2]!.lastActivity, null);
	});
});

describe("needs attention: each gap with one thing to do", () => {
	it("names the module with nothing, with a session on its next unit; and the module with no material", async () => {
		const { svc, answer } = await setup();
		answer(day(25, 10), "nc-gans", "nc-gans-q1");
		const lines = svc.progress().attention;
		assert.deepEqual(lines.map((l) => [l.kind, l.text]), [["module", PROGRESS_COPY.nothingOn("Game Theory", null)], ["material", PROGRESS_COPY.noMaterial(["Human Computer Interaction"])]]);
		assert.deepEqual(lines[0]!.action, { label: "5 questions on Nash equilibrium", session: { kind: "post-lecture", lectureId: "gt-nash" } });
		assert.deepEqual(lines[1]!.action, { label: PROGRESS_COPY.addMaterial, href: "/app/library" });
		// The action is a real session.
		const { sessionId } = svc.createSession(svc.parseSpec(lines[0]!.action.session));
		await svc.whenReady(sessionId);
		assert.equal((await svc.view(sessionId)).status, "question");
	});

	it("ideas left for three weeks are fading: the score dips a little, and the line offers to get them back", async () => {
		const { svc, answer } = await setup(day(26, 9));
		answer(day(2, 10), "nc-gans", "nc-gans-q2");
		answer(day(25, 10), "gt-nash", "gt-nash-q1");
		const p = svc.progress();
		assert.equal(p.score.fading, 1);
		assert.equal(p.score.now, (10 + 20) + (20 + 20) - SCORE_RULES.fadePoints, "an easy question and a hard one, each securing its idea, less the one fading");
		const fading = p.attention.find((l) => l.kind === "fading")!;
		assert.equal(fading.text, "1 idea fading in Neural Computation");
		assert.deepEqual(fading.action, { label: "Get it back", session: { kind: "post-lecture", lectureId: "nc-gans", nodes: ["discriminator"] } });
	});

	it("never says behind, late, overdue or missed", async () => {
		const { svc, answer } = await setup();
		answer(day(2, 10), "nc-gans", "nc-gans-q2");
		const text = JSON.stringify([svc.progress().attention, PROGRESS_COPY.steadyPaceHelp, PROGRESS_COPY.nothingNeeds]);
		assert.doesNotMatch(text, /behind|overdue|missed|late\b|should have|failing/i);
	});
});

describe("milestones are kept", () => {
	it("earned once, logged once, and still there when what earned them is gone", async () => {
		const { svc, store, answer, types } = await setup();
		answer(day(25, 10), "nc-gans", "nc-gans-q1");
		const first = svc.progress().milestones.find((m) => m.id === "first-idea")!;
		assert.equal(new Date(first.earnedAt!).getTime(), day(25, 10).getTime());
		svc.progress();
		assert.equal(types().filter((t) => t === "milestone_earned").length, 1);
		// The facilitator archives the log between participants; a student's history could also be trimmed.
		fs.rmSync(path.join(store.dir, "events.jsonl"));
		const after = svc.progress();
		assert.equal(after.score.now, 0, "the score is the history");
		assert.equal(after.milestones.find((m) => m.id === "first-idea")!.earnedAt, first.earnedAt, "the milestone is kept");
		assert.equal(after.milestones.length, 15);
		assert.equal(after.milestones.filter((m) => m.earnedAt).length, 1);
	});
});

describe("study blocks carry a module, and can't be dropped on a lecture (V-37)", () => {
	const GT_LECTURE: Lecture = { id: "gt-thu", module: "GT", title: "Lecture", week: 5, order: 9, start: day(26, 10).toISOString(), end: day(26, 11).toISOString(), kind: "lecture", hasMaterials: false };

	async function withBlock() {
		const s = await setup(day(23, 9));
		s.store.saveLectures([...s.store.allLectures(), GT_LECTURE]);
		const b: StudyBlock = { id: "blk1", date: "2026-11-26", start: "14:00", minutes: 50, status: "accepted", source: "planner", lectureId: "nc-gans", module: "NC" };
		const other: StudyBlock = { id: "blk2", date: "2026-11-26", start: "16:00", minutes: 50, status: "proposed", source: "planner" };
		s.store.saveBlocks([b, other]);
		return s;
	}

	it("the planner gives each block the module of the unit it picked", async () => {
		const { svc } = await setup(day(23, 9));
		svc.updatePlanSettings({ weeklyTargetMinutes: 200 });
		const plan = svc.proposePlan({});
		assert.ok(plan.blocks.length > 0);
		for (const b of plan.blocks) assert.equal(b.module, b.focus?.module ?? null);
		const modules = new Set(plan.blocks.map((b) => b.module));
		assert.ok(modules.has("GT") && modules.has("NC"), "modules take turns");
		assert.ok(plan.blocks.filter((b) => b.module === null).every((b) => !b.lectureId), "a block with no unit left to give it is free study");
	});

	it("changing a block's module makes it study that module's next unit; null is free study", async () => {
		const { svc, types } = await withBlock();
		const gt = svc.updateBlock("blk1", { module: "GT" });
		assert.deepEqual([gt.module, gt.lectureId, gt.firstTaskQuestionId], ["GT", "gt-nash", "gt-nash-q1"]);
		const hci = svc.updateBlock("blk1", { module: "HCI" });
		assert.deepEqual([hci.module, hci.lectureId], ["HCI", undefined], "a module with no material yet: the block is still that module's");
		const free = svc.updateBlock("blk1", { module: null });
		assert.deepEqual([free.module, free.lectureId], [undefined, undefined]);
		assert.equal(types().filter((t) => t === "plan_module_set").length, 3);
		assert.throws(() => svc.updateBlock("blk1", { module: "XX" }), (e: CompanionError) => e.status === 400);
		assert.equal(svc.plan("2026-11-23").blocks.find((b) => b.id === "blk1")!.module, null);
	});

	it("the plan carries what the timetable needs: quiet hours, and the modules a block can be given", async () => {
		const { svc } = await withBlock();
		const plan = svc.plan("2026-11-23");
		assert.deepEqual(Object.keys(plan.quietHours).sort(), ["from", "to"]);
		assert.match(plan.quietHours.from, /^\d\d:\d\d$/);
		const byCode = Object.fromEntries(plan.modules.map((m) => [m.code, m.hasMaterial]));
		assert.deepEqual([byCode.GT, byCode.HCI], [true, false], "a module says whether it has material yet");
		assert.ok(plan.modules.every((m) => m.name.length > 0));
	});

	const drops: Array<[string, Partial<StudyBlock>, string | null]> = [
		["a free time the same day", { start: "12:00" }, null],
		["starting the minute the lecture ends", { start: "11:00" }, null],
		["another day", { date: "2026-11-27", start: "09:00" }, null],
		["on top of the lecture", { start: "10:15" }, PLACEMENT_COPY.lecture],
		["running into the lecture", { start: "09:30" }, PLACEMENT_COPY.lecture],
		["on top of another block, even a suggested one", { start: "16:30" }, PLACEMENT_COPY.block],
		["in quiet hours", { start: "06:00" }, PLACEMENT_COPY.quiet],
		["running past the end of the waking day", { start: "21:30" }, PLACEMENT_COPY.quiet],
	];
	for (const [name, to, problem] of drops) {
		it(`dropped ${name}: ${problem ? "refused, and the block stays put" : "moved"}`, async () => {
			const { svc, store } = await withBlock();
			if (problem) {
				assert.throws(() => svc.updateBlock("blk1", to), (e: CompanionError) => e.status === 409 && e.code === "block_overlaps" && e.message === problem);
				assert.deepEqual([store.blocks()[0]!.date, store.blocks()[0]!.start], ["2026-11-26", "14:00"]);
			} else {
				const moved = svc.updateBlock("blk1", to);
				assert.deepEqual([moved.date, moved.start], [to.date ?? "2026-11-26", to.start]);
			}
		});
	}

	it("a routine commitment is as fixed as a lecture, and a removed block is no obstacle", () => {
		const base = { block: { id: "b", date: "2026-11-26", start: "18:00", minutes: 50 }, lectures: [], blocks: [] as StudyBlock[], quietHours: { from: "22:00", to: "08:00" } };
		assert.equal(placementProblem({ ...base, commitments: [{ label: "Work", weekdays: [4], start: "17:00", end: "21:00" }] }), "commitment");
		assert.equal(placementProblem({ ...base, commitments: [{ label: "Work", weekdays: [3], start: "17:00", end: "21:00" }] }), null, "another weekday");
		assert.equal(placementProblem({ ...base, commitments: [], blocks: [{ id: "x", date: "2026-11-26", start: "18:00", minutes: 50, status: "removed", source: "planner" }] }), null);
		assert.equal(placementProblem({ ...base, commitments: [], block: { ...base.block, start: "23:30" }, quietHours: { from: "02:00", to: "06:00" } }), "past-midnight");
	});
});
