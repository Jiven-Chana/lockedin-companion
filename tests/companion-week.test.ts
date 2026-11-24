/**
 * The week through CompanionService (v0.1 F-109, F-110, F-111): a routine
 * saved from the chat or the form proposes the week; blocks are ticked,
 * moved or removed in one action; the Sunday check-in proposes a target
 * the student confirms or keeps. Mon 23 Nov 2026, sample timetable.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { ManualClock } from "../src/server/companion/clock.ts";
import { CompanionContent } from "../src/server/companion/content.ts";
import { ScriptedEngine } from "../src/server/companion/engines/scripted.ts";
import { CompanionError } from "../src/server/companion/errors.ts";
import { CompanionService } from "../src/server/companion/service.ts";
import { CompanionStore } from "../src/server/companion/store.ts";

const CONTENT = path.join(import.meta.dirname, "..", "companion", "content");

async function setup(now = new Date(2026, 10, 23, 7)) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "companion-week-"));
	const store = new CompanionStore(dir);
	const content = new CompanionContent(store, CONTENT);
	const clock = new ManualClock(now);
	const scripted = new ScriptedEngine((id) => content.scriptedSet(id));
	let n = 0;
	const svc = new CompanionService({
		store, content, clock,
		clockControl: { set: (t) => clock.set(t), reset: () => clock.set(now) },
		engines: { scripted, learnharness: scripted },
		defaultEngine: "scripted",
		newId: (p) => `${p}${++n}`,
	});
	await svc.onboardFlow({ calendar: { kind: "sample" } });
	return { svc, store, clock, events: () => store.events().map((e) => e.type) };
}

const routine = { energy: ["afternoon"], commitments: [{ label: "Shift", weekdays: [6], start: "10:00", end: "18:00" }], places: ["Library"], weeklyTargetMinutes: 200, preferredBlockMinutes: 50 };

describe("routine → the week's proposals (F-109 → F-110)", () => {
	it("confirming the routine saves it and proposes blocks that meet the target", async () => {
		const { svc, store, events } = await setup();
		const r = svc.saveRoutine({ routine, source: "chat" });
		assert.equal(store.profile()?.plan?.weeklyTargetMinutes, 200);
		assert.equal(r.plan.blocks.filter((b) => b.status === "proposed").length, 4);
		assert.ok(r.plan.blocks.every((b) => b.focus), "each block has something to study");
		assert.ok(!r.plan.blocks.some((b) => b.date === "2026-11-28" && b.start >= "09:50" && b.start < "18:10"), "never in Saturday's shift");
		for (const e of ["setup_chat_confirmed", "plan_proposed"]) assert.ok(events().includes(e as never), e);
	});

	it("the plain form is the same, logged as the fallback", async () => {
		const { svc, events } = await setup();
		svc.saveRoutine({ routine, source: "form" });
		assert.ok(events().includes("setup_chat_fallback_form"));
	});

	it("a routine with problems is refused and nothing is saved", async () => {
		const { svc, store } = await setup();
		assert.throws(() => svc.saveRoutine({ routine: { ...routine, weeklyTargetMinutes: 5 } }), /weekly target/);
		assert.equal(store.profile()?.routine, undefined);
	});

	it("no target, no proposals", async () => {
		const { svc } = await setup();
		assert.throws(() => svc.proposePlan({}), (e: CompanionError) => e.code === "no_target");
	});
});

describe("one action per block (F-110)", () => {
	it("tick, move (keeping its focus), remove; re-planning keeps accepted blocks", async () => {
		const { svc, store, events } = await setup();
		const [a, b, c] = svc.saveRoutine({ routine, source: "form" }).plan.blocks;
		svc.updateBlock(a!.id, { status: "accepted" });
		const moved = svc.updateBlock(b!.id, { date: "2026-11-27", start: "16:00" });
		assert.equal(moved.status, "accepted", "moving a proposal chooses it");
		assert.equal(moved.lectureId, b!.lectureId, "a move keeps its focus");
		svc.updateBlock(c!.id, { status: "removed" });
		for (const e of ["plan_accepted", "plan_moved", "plan_removed"]) assert.ok(events().includes(e as never), e);

		const again = svc.proposePlan({});
		const ids = again.blocks.map((x) => x.id);
		assert.ok(ids.includes(a!.id) && ids.includes(b!.id), "accepted blocks stay");
		assert.ok(!ids.includes(c!.id), "the removed block stays removed");
		assert.equal(again.committedMinutes, 100);
		assert.equal(store.blocks().filter((x) => x.status === "proposed").length, again.blocks.filter((x) => x.status === "proposed").length, "old proposals are replaced, not piled up");
	});

	it("accept the whole week in one go", async () => {
		const { svc } = await setup();
		svc.saveRoutine({ routine, source: "form" });
		const p = svc.acceptBlocks({});
		assert.ok(p.blocks.every((x) => x.status === "accepted"));
		assert.equal(p.committedMinutes, 200);
	});

	it("an accepted block is a commitment: Today's next block points at it", async () => {
		const { svc } = await setup();
		const [first] = svc.saveRoutine({ routine, source: "form" }).plan.blocks;
		svc.updateBlock(first!.id, { status: "accepted" });
		assert.equal(svc.today().nextBlock?.blockId, first!.id);
	});
});

describe("the Sunday check-in (F-111)", () => {
	async function sunday() {
		const s = await setup();
		const blocks = s.svc.saveRoutine({ routine, source: "form" }).plan.blocks;
		s.svc.updateBlock(blocks[0]!.id, { status: "started" });
		s.svc.updateBlock(blocks[1]!.id, { status: "started" });
		s.clock.set(new Date(2026, 10, 29, 19)); // Sunday 19:00
		return s;
	}

	it("shows blocks started and minutes, never what wasn't done", async () => {
		const { svc } = await sunday();
		const c = svc.checkin();
		assert.deepEqual([c.started, c.minutes], [2, 100], "on Sunday, the week ending today");
		assert.equal(c.text, "Last week: 2 blocks started, 1 h 40 min. How did it feel?");
		assert.equal(c.nextWeek, "2026-11-30");
	});

	it("a feeling only proposes; the target changes on the confirm tap", async () => {
		const { svc, store, events } = await sunday();
		const p = svc.answerCheckin({ feeling: "too-much" });
		assert.deepEqual([p.current, p.proposed, p.ask, p.keepLabel], [200, 170, "Try 2 h 50 next week?", "Keep 3 h 20"]);
		assert.equal(store.profile()?.plan?.weeklyTargetMinutes, 200, "not changed yet");
		const done = svc.answerCheckin({ target: 170 }) as { target: number; plan: { week: string } };
		assert.equal(store.profile()?.plan?.weeklyTargetMinutes, 170);
		assert.equal(done.plan.week, "2026-11-30", "next week is proposed");
		assert.ok(events().includes("target_changed"));
	});

	it("keep leaves the target alone", async () => {
		const { svc, store, events } = await sunday();
		svc.answerCheckin({ feeling: "too-little" });
		svc.answerCheckin({ keep: true });
		assert.equal(store.profile()?.plan?.weeklyTargetMinutes, 200);
		assert.ok(events().includes("target_kept"));
	});

	it("nothing in the check-in says missed, overdue or behind", async () => {
		const { svc } = await sunday();
		const json = JSON.stringify([svc.checkin(), svc.answerCheckin({ feeling: "too-much" })]);
		assert.doesNotMatch(json, /\b(missed|overdue|behind|streak)\b/i);
	});
});
