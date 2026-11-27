/**
 * "Re-plan the rest of my week" (v2.2 part B): kept blocks whose time has
 * passed without being started are moved to free times in the days left.
 * The week is Mon 23 to Sun 29 Nov 2026; "now" is Wed 25 Nov 12:00 unless a
 * case says otherwise. Nothing is ever called missed (R-6).
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
import { DEFAULT_PREFS, openBlocks, PLAN_COPY, PLAN_RULES, replanWeek, type Lecture, type StudyBlock } from "../src/core/companion/index.ts";

const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m);
const day = (d: number) => `2026-11-${String(d).padStart(2, "0")}`;
const block = (d: number, start: string, status: StudyBlock["status"] = "accepted", minutes = 50): StudyBlock => ({ id: `${day(d)}-${start}`, date: day(d), start, minutes, status, source: "student" });
const lecture = (id: string, d: number, h: number, hours = 2): Lecture => ({ id, module: "HCI", title: id, week: 8, order: 1, start: at(d, h).toISOString(), end: at(d, h + hours).toISOString(), kind: "lecture", hasMaterials: false } as Lecture);
const NOW = at(25, 12);
const input = (blocks: StudyBlock[], over: Partial<Parameters<typeof replanWeek>[0]> = {}) => ({ now: NOW, lectures: [], quietHours: DEFAULT_PREFS.quietHours, blocks, ...over });
const when = (m: { date: string; start: string }) => new Date(`${m.date}T${m.start}:00`);

describe("which blocks are still open", () => {
	const cases: { name: string; b: StudyBlock; open: boolean }[] = [
		{ name: "kept, on Monday, never started", b: block(23, "14:00"), open: true },
		{ name: "kept, earlier today, already over", b: block(25, "11:00"), open: true },
		{ name: "kept, today, still running", b: block(25, "11:30"), open: false },
		{ name: "kept, tomorrow", b: block(26, "14:00"), open: false },
		{ name: "started on Monday", b: block(23, "14:00", "started"), open: false },
		{ name: "only suggested, never kept", b: block(23, "14:00", "proposed"), open: false },
		{ name: "removed", b: block(23, "14:00", "removed"), open: false },
		{ name: "kept, last week", b: block(20, "14:00"), open: false },
	];
	for (const c of cases) it(c.name, () => assert.equal(openBlocks([c.b], NOW).length === 1, c.open));

	it("lists them in the order they were planned", () => {
		assert.deepEqual(openBlocks([block(24, "10:00"), block(23, "16:00"), block(23, "09:00")], NOW).map((b) => b.id), [`${day(23)}-09:00`, `${day(23)}-16:00`, `${day(24)}-10:00`]);
	});
});

describe("re-planning the rest of the week", () => {
	it("moves nothing when nothing is open", () => {
		assert.deepEqual(replanWeek(input([block(26, "14:00"), block(23, "14:00", "started")])), { moves: [], nextWeek: 0, left: [] });
	});

	it("moves each open block to a free time from now to Sunday, on different days", () => {
		const r = replanWeek(input([block(23, "14:00"), block(24, "14:00")]));
		assert.equal(r.moves.length, 2);
		assert.equal(r.nextWeek, 0);
		assert.deepEqual(r.left, []);
		for (const m of r.moves) assert.ok(when(m) > NOW && m.date <= day(29), `${m.date} ${m.start}`);
		assert.notEqual(r.moves[0]!.date, r.moves[1]!.date);
	});

	it("keeps clear of lectures, commitments, quiet hours and the blocks already there", () => {
		const lectures = [lecture("a", 25, 13, 5), lecture("b", 26, 9, 8)];
		const routine = { energy: [], commitments: [{ label: "Shift", weekdays: [5, 6, 7], start: "09:00", end: "17:00" }] };
		const kept = [block(27, "18:00"), block(28, "18:00")];
		const r = replanWeek(input([block(23, "14:00"), block(24, "14:00"), block(24, "16:00"), ...kept], { lectures, routine }));
		assert.equal(r.moves.length + r.left.length, 3);
		const busy = [
			...lectures.map((l) => ({ start: new Date(l.start!), end: new Date(l.end!) })),
			...[27, 28, 29].map((d) => ({ start: at(d, 9), end: at(d, 17) })),
			...kept.map((b) => ({ start: when(b), end: new Date(when(b).getTime() + 50 * 60_000) })),
		];
		const spans = r.moves.map((m) => ({ start: when(m), end: new Date(when(m).getTime() + 50 * 60_000) }));
		for (const s of spans) {
			for (const b of busy) assert.ok(!(s.start < b.end && b.start < s.end), `${s.start.toISOString()} overlaps`);
			assert.ok(s.start.getHours() >= 8 && s.end <= new Date(new Date(s.start).setHours(22, 0, 0, 0)), "inside the waking day");
		}
		for (let i = 0; i < spans.length; i++) for (let j = i + 1; j < spans.length; j++) assert.ok(!(spans[i]!.start < spans[j]!.end && spans[j]!.start < spans[i]!.end), "moved blocks don't overlap each other");
	});

	it("prefers the time of day the student has energy", () => {
		const r = replanWeek(input([block(23, "09:00")], { routine: { energy: ["evening"], commitments: [] } }));
		const h = when(r.moves[0]!).getHours();
		assert.ok(h >= 17 && h < 22, `${r.moves[0]!.start}`);
	});

	it(`never makes a day hold more than ${PLAN_RULES.maxBlocksPerDay} blocks`, () => {
		// Wednesday to Saturday are full; only Sunday has room.
		const full = [25, 26, 27, 28].flatMap((d) => [block(d, "15:00"), block(d, "17:00")]);
		const r = replanWeek(input([block(23, "14:00"), ...full]));
		assert.deepEqual(r.moves.map((m) => m.date), [day(29)]);
	});

	it("uses next week when this one has no room left, and says how many went there", () => {
		const r = replanWeek(input([block(23, "14:00"), block(24, "14:00")], { now: at(29, 21, 30) }));
		assert.equal(r.moves.length, 2);
		assert.equal(r.nextWeek, 2);
		for (const m of r.moves) assert.ok(m.date >= "2026-11-30" && m.date <= "2026-12-06", m.date);
	});

	it("keeps each block's own length", () => {
		const long = block(23, "14:00", "accepted", 90);
		// Thursday has one 60-minute gap and one 2-hour gap; only the second fits 90 minutes.
		const lectures = [lecture("am", 25, 12, 10), lecture("x", 26, 8, 2), lecture("y", 26, 11, 5), lecture("z", 26, 18, 4), lecture("f", 27, 8, 14), lecture("s", 28, 8, 14), lecture("u", 29, 8, 14)];
		const r = replanWeek(input([long], { lectures }));
		assert.deepEqual(r.moves, [{ id: long.id, date: day(26), start: "16:15" }]);
	});

	it("leaves a block where it is when there is no free time this week or next", () => {
		const lectures = Array.from({ length: 12 }, (_, i) => lecture(`l${i}`, 25 + i, 8, 14));
		const b = block(23, "14:00");
		assert.deepEqual(replanWeek(input([b], { lectures })), { moves: [], nextWeek: 0, left: [b.id] });
	});
});

describe("the wording", () => {
	it("never says missed, overdue or behind", () => {
		const all = [PLAN_COPY.replan.button, PLAN_COPY.replan.notStarted, PLAN_COPY.replan.moved, PLAN_COPY.replan.undo, PLAN_COPY.replan.noRoom, PLAN_COPY.replan.done(2, 0), PLAN_COPY.replan.done(1, 1), PLAN_COPY.replan.done(3, 2), PLAN_COPY.dragHint].join(" ");
		assert.doesNotMatch(all, /missed|overdue|behind/i);
	});
	const cases: [number, number, string][] = [
		[1, 0, "Moved 1 block to a free time."],
		[2, 0, "Moved 2 blocks to free times."],
		[2, 1, "Moved 2 blocks to free times, 1 of them next week."],
		[1, 1, "Moved 1 block to a free time next week."],
	];
	for (const [n, next, want] of cases) it(`${n} moved, ${next} next week`, () => assert.equal(PLAN_COPY.replan.done(n, next), want));
});

// ─── through the service: the button on Week ────────────────────────────────

const CONTENT = path.join(import.meta.dirname, "..", "companion", "content");
const routine = { energy: ["afternoon"], commitments: [], places: ["Library"], weeklyTargetMinutes: 200, preferredBlockMinutes: 50 };

/** A student whose week was planned and kept on Monday morning. */
async function setup() {
	const monday = at(23, 7);
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "companion-replan-"));
	const store = new CompanionStore(dir);
	const content = new CompanionContent(store, CONTENT);
	const clock = new ManualClock(monday);
	const scripted = new ScriptedEngine((id) => content.scriptedSet(id));
	let n = 0;
	const svc = new CompanionService({
		store, content, clock,
		clockControl: { set: (t) => clock.set(t), reset: () => clock.set(monday) },
		engines: { scripted, learnharness: scripted },
		defaultEngine: "scripted",
		newId: (p) => `${p}${++n}`,
	});
	await svc.onboardFlow({ calendar: { kind: "sample" } });
	const week = svc.saveRoutine({ routine, source: "form" }).plan.week;
	svc.acceptBlocks({ week });
	const kept = svc.plan().blocks.map((b) => ({ id: b.id, date: b.date, start: b.start, placed: b.placed }));
	assert.ok(kept.length >= 3, "the week has blocks to work with");
	return { svc, store, clock, kept, events: () => store.events().map((e) => e.type) };
}

describe("re-planning through the service", () => {
	it("offers nothing while no kept block has passed", async () => {
		const { svc } = await setup();
		assert.deepEqual(svc.plan().replan, { open: 0, moved: 0, canUndo: false });
		assert.ok(svc.plan().blocks.every((b) => !b.notStarted && !b.moved));
	});

	it("moves the open blocks, marks them, and one Undo puts them all back", async () => {
		const { svc, clock, kept, events } = await setup();
		// Late on the day of the second kept block: the first two have passed, unstarted.
		const now = new Date(`${kept[1]!.date}T21:00:00`);
		clock.set(now);
		const before = svc.plan();
		const open = before.blocks.filter((b) => b.notStarted).map((b) => b.id);
		assert.ok(open.length >= 2);
		assert.equal(before.replan.open, open.length);

		const after = svc.replanWeek();
		const nextWeek = open.length - after.blocks.filter((b) => open.includes(b.id)).length;
		assert.equal(after.message, PLAN_COPY.replan.done(open.length, nextWeek));
		assert.deepEqual(after.replan, { open: 0, moved: open.length, canUndo: true });
		for (const id of open) {
			const b = svc.plan().blocks.find((x) => x.id === id) ?? svc.plan("2026-11-30").blocks.find((x) => x.id === id);
			assert.ok(b, id);
			assert.ok(new Date(`${b.date}T${b.start}:00`) > now, `${b.date} ${b.start} is ahead`);
			assert.equal(b.moved, true);
			assert.equal(b.notStarted, false);
			assert.equal(b.status, "accepted");
			assert.equal(b.why, null, "a block LockedIn moved no longer claims its old reason");
		}
		assert.ok(events().includes("plan_replanned" as never));

		const back = svc.undoReplan();
		assert.equal(back.message, PLAN_COPY.replan.undone);
		assert.deepEqual(back.replan, { open: open.length, moved: 0, canUndo: false });
		for (const k of kept) {
			const b = back.blocks.find((x) => x.id === k.id)!;
			assert.deepEqual({ date: b.date, start: b.start, placed: b.placed }, { date: k.date, start: k.start, placed: k.placed });
		}
		assert.ok(events().includes("plan_replan_undone" as never));
	});

	it("Undo is gone once a moved block is changed by hand, and once the day ends", async () => {
		for (const how of ["moved by hand", "the next day"] as const) {
			const { svc, clock, kept } = await setup();
			clock.set(new Date(`${kept[1]!.date}T21:00:00`));
			const moved = svc.replanWeek().blocks.filter((b) => b.moved);
			if (how === "moved by hand") svc.updateBlock(moved[0]?.id ?? kept[0]!.id, { status: "removed" });
			else clock.set(new Date(new Date(`${kept[1]!.date}T08:30:00`).getTime() + 86_400_000));
			assert.equal(svc.plan().replan.canUndo, false, how);
			assert.ok(svc.plan().blocks.every((b) => !b.moved), how);
			assert.throws(() => svc.undoReplan(), (e: unknown) => e instanceof CompanionError && e.status === 409, how);
		}
	});

	it("says so when there is nothing to move", async () => {
		const { svc } = await setup();
		assert.equal(svc.replanWeek().message, null);
		assert.equal(svc.plan().replan.canUndo, false);
	});
});
