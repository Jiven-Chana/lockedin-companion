/**
 * The first run (v2.0 step 7; V-45, V-63 to V-66) through CompanionService:
 * five steps that can each be left for later, a timetable or modules typed
 * by hand, slides saved straight away, the week from one energy question
 * and one total, and where setup ends. Fake PDF converter, no AI.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { SlidePage } from "../src/core/companion/index.ts";
import { SETUP_COPY, SETUP_RULES } from "../src/core/companion/index.ts";
import { ManualClock } from "../src/server/companion/clock.ts";
import { CompanionContent } from "../src/server/companion/content.ts";
import { ScriptedEngine } from "../src/server/companion/engines/scripted.ts";
import { CompanionError } from "../src/server/companion/errors.ts";
import { CompanionService } from "../src/server/companion/service.ts";
import { CompanionStore } from "../src/server/companion/store.ts";

const CONTENT = path.join(import.meta.dirname, "..", "companion", "content");
const NOW = new Date(2026, 10, 23, 7); // Mon 23 Nov 2026, 07:00
const LINK = "https://calendar.example.ac.uk/feeds/user_9f8e7d6c5b4a39281706f5e4d3c2b1a0.ics";
const ICS = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:a", "SUMMARY:GT: Lecture", "DTSTART:20261124T100000", "DTEND:20261124T110000", "END:VEVENT", "END:VCALENDAR"].join("\r\n");

const FILL = " It explains the idea step by step, with a worked example and a short check.".repeat(12);
/** A fake PDF: the bytes are the page titles joined by "|". "TINY" is a page with too little on it to study. */
const pdf = (...titles: string[]) => new Uint8Array([0x25, 0x50, 0x44, 0x46, ...new TextEncoder().encode(titles.join("|"))]);
const pdfToPages = async (data: Uint8Array): Promise<SlidePage[]> => {
	const titles = new TextDecoder().decode(data.slice(4)).split("|");
	data.fill(0);
	return titles.map((t, i) => ({ number: i + 1, kind: "text" as const, markdown: t === "TINY" ? "# Tiny" : `# ${t}\nBody of ${t}.${FILL}` }));
};

function make() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "companion-setup-"));
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
		convertPdf: pdfToPages,
		fetchCalendar: async () => ICS,
		newId: (p) => `${p}${++n}`,
	});
	return { svc, store, clock, events: () => store.events().map((e) => e.type) };
}
const none = { calendar: { kind: "none" as const }, modules: [] };
const gt = { calendar: { kind: "none" as const }, modules: [{ name: "Game Theory", code: "GT" }] };

describe("setup: where it is, and coming back to it", () => {
	it("starts on sign-in, moves to the timetable once the AI is connected, and has no profile yet", () => {
		const { svc } = make();
		assert.deepEqual(svc.setup(), { started: false, done: false, step: 1, phone: { available: false, paired: false }, calendar: false, modules: [], week: null, end: null });
		(svc as unknown as { aiReady: boolean }).aiReady = true;
		assert.equal(svc.setup().step, 2);
		assert.equal(svc.today().onboarded, false);
	});

	it("the timetable step makes the profile, even with no modules (\"Later\"), and setup is not over", async () => {
		const { svc, store } = make();
		const s = await svc.setupTimetable({ ...none, timeZone: "Europe/London" });
		assert.equal(s.step, 3);
		assert.equal(s.started, true);
		assert.deepEqual(s.modules, []);
		assert.equal(store.profile()?.timeZone, "Europe/London");
		assert.equal(store.profile()?.timetableSource, "none");
		assert.equal(svc.today().onboarded, false);
	});

	it("reopens on the step the student reached", async () => {
		const { svc } = make();
		await svc.setupTimetable(none);
		for (const step of [4, 5, 3]) assert.equal(svc.setupStep({ step }).step, step);
		for (const bad of [0, 1, 6, 2.5, "4", undefined]) assert.throws(() => svc.setupStep({ step: bad }), (e: CompanionError) => e.status === 400, String(bad));
	});

	it("a student set up before v2.0, or by a facilitator scenario, never sees setup", async () => {
		const { svc } = make();
		await svc.onboardFlow({ calendar: { kind: "none" }, modules: [{ name: "Game Theory" }] });
		assert.equal(svc.today().onboarded, true);
		assert.equal(svc.setup().done, true);
	});

	it("finishing marks it done, once, and says so in the log", async () => {
		const { svc, events } = make();
		await svc.setupTimetable(gt);
		const r = svc.setupDone();
		assert.equal(r.done, true);
		assert.equal(svc.today().onboarded, true);
		svc.setupDone();
		assert.equal(events().filter((t) => t === "onboarding_done").length, 1);
	});
});

describe("setup: the timetable and modules", () => {
	it("a link is read and kept, and its ticked modules are saved", async () => {
		const { svc, store } = make();
		const s = await svc.setupTimetable({ calendar: { kind: "link", url: LINK }, modules: [{ name: "Game Theory", code: "GT" }] });
		assert.equal(s.calendar, true);
		assert.deepEqual(s.modules.map((m) => [m.code, m.name]), [["GT", "Game Theory"]]);
		assert.equal(store.runtime().calendarUrl, LINK);
		assert.equal(store.lectures().filter((l) => l.module === "GT" && l.start).length, 1);
	});

	it("going back and forward adds what is new and keeps what was there", async () => {
		const { svc } = make();
		await svc.setupTimetable(gt);
		const s = await svc.setupTimetable({ calendar: { kind: "none" }, modules: [{ name: "Game Theory", code: "GT" }, { name: "Neural Computation" }] });
		assert.deepEqual(s.modules.map((m) => m.code), ["GT", "NC"]);
	});

	it("+ Add a module: a name is enough, the code is made from it and never repeats (V-64)", async () => {
		const { svc, events } = make();
		await svc.setupTimetable(none);
		const cases: { name: unknown; code?: string; error?: boolean }[] = [
			{ name: "Game Theory", code: "GT" },
			{ name: "  Graph Traversal ", code: "GT2" },
			{ name: "HCI", code: "HCI" },
			{ name: "Game Theory", error: true },
			{ name: "game theory", error: true },
			{ name: "   ", error: true },
			{ name: "x".repeat(81), error: true },
			{ name: 7, error: true },
		];
		for (const c of cases) {
			if (c.error) assert.throws(() => svc.addModule({ name: c.name }), (e: CompanionError) => e.status === 400, String(c.name));
			else assert.equal(svc.addModule({ name: c.name }).code, c.code, String(c.name));
		}
		assert.deepEqual(svc.setup().modules.map((m) => m.name), ["Game Theory", "Graph Traversal", "HCI"]);
		assert.equal(events().filter((t) => t === "module_added").length, 3);
	});

	it("at most 20 modules", async () => {
		const { svc } = make();
		await svc.setupTimetable(none);
		for (let i = 0; i < 20; i++) svc.addModule({ name: `Module number ${i}` });
		assert.throws(() => svc.addModule({ name: "One more" }), (e: CompanionError) => e.status === 400);
	});
});

describe("setup: slides are saved straight away (V-66)", () => {
	it("every unit worth studying is kept; one line per module says how many", async () => {
		const { svc, events } = make();
		await svc.setupTimetable(gt);
		const r = await svc.quickMaterials("GT", [
			{ name: "GT_Week2_nash.pdf", bytes: pdf("Nash equilibrium", "Best responses") },
			{ name: "GT_Week3_mixed.pdf", bytes: pdf("Mixed strategies") },
			{ name: "GT_Week4_tiny.pdf", bytes: pdf("TINY") },
		]);
		assert.deepEqual(r.units.map((u) => [u.title, u.week]), [["Nash equilibrium", 2], ["Mixed strategies", 3]]);
		assert.equal(r.skipped, 1);
		const line = svc.setup().modules[0]!;
		assert.equal(line.units, 2);
		assert.equal(SETUP_COPY.slides.found(line.units), "2 chapters found");
		assert.ok(events().includes("materials_saved"));
	});

	it("nothing worth studying in the files says so and saves nothing", async () => {
		const { svc } = make();
		await svc.setupTimetable(gt);
		await assert.rejects(svc.quickMaterials("GT", [{ name: "tiny.pdf", bytes: pdf("TINY") }]), (e: CompanionError) => e.status === 400);
		assert.equal(svc.setup().modules[0]!.units, 0);
	});

	it("\"Change\": a unit can be renamed, given its week, or removed", async () => {
		const { svc } = make();
		await svc.setupTimetable(gt);
		const { units } = await svc.quickMaterials("GT", [{ name: "GT_Week2_nash.pdf", bytes: pdf("Nash equilibrium") }, { name: "GT_Week3_mixed.pdf", bytes: pdf("Mixed strategies") }]);
		assert.equal(svc.renameUnit(units[0]!.id, { title: "  Nash, properly " }).title, "Nash, properly");
		for (const bad of ["", "   ", "x".repeat(121), 5]) assert.throws(() => svc.renameUnit(units[0]!.id, { title: bad }), (e: CompanionError) => e.status === 400, String(bad));
		svc.removeMaterials(units[1]!.id);
		assert.deepEqual(svc.setup().modules[0]!.list.map((u) => u.title), ["Nash, properly"]);
	});
});

describe("setup: your week (V-45, V-63)", () => {
	it("starts at five hours; energy and the total change the blocks, and each block says why it is there", async () => {
		const { svc, store } = make();
		await svc.setupTimetable(gt);
		const first = svc.setupWeek({});
		assert.equal(first.target, SETUP_RULES.defaultTargetMinutes);
		assert.equal(first.target, 300);
		assert.equal(first.blocks.length, 6);
		assert.ok(first.blocks.every((b) => b.why === "a free gap in your day"));

		const afternoon = svc.setupWeek({ energy: ["afternoon"] });
		assert.ok(afternoon.blocks.every((b) => b.start >= "12:00" && b.start < "17:00" && b.why === "because you have energy in the afternoon"), JSON.stringify(afternoon.blocks));
		assert.deepEqual(store.profile()?.routine?.energy, ["afternoon"]);
		// The earlier suggestions are replaced, not added to.
		assert.equal(store.blocks().filter((b) => b.status === "proposed").length, 6);

		const less = svc.setupWeek({ energy: ["afternoon"], weeklyTargetMinutes: 270 });
		assert.equal(less.target, 270);
		assert.equal(less.blocks.length, 6); // 270 minutes needs six 50-minute blocks
		assert.equal(svc.setupWeek({ weeklyTargetMinutes: 100 }).blocks.length, 2);
		assert.equal(store.profile()?.plan?.weeklyTargetMinutes, 100);
		// Energy stays as it was when only the total is sent.
		assert.deepEqual(store.profile()?.routine?.energy, ["afternoon"]);
	});

	it("rejects an energy time or a total that isn't one", async () => {
		const { svc } = make();
		await svc.setupTimetable(gt);
		for (const bad of [{ energy: ["night"] }, { energy: "morning" }, { weeklyTargetMinutes: 10 }, { weeklyTargetMinutes: 45.5 }, { weeklyTargetMinutes: 41 * 60 }]) {
			assert.throws(() => svc.setupWeek(bad), (e: CompanionError) => e.status === 400, JSON.stringify(bad));
		}
	});

	it("a commitment the student already gave is kept", async () => {
		const { svc, store } = make();
		await svc.setupTimetable(gt);
		svc.saveRoutine({ routine: { energy: [], commitments: [{ label: "Shift", weekdays: [1], start: "12:00", end: "20:00" }], places: [], weeklyTargetMinutes: 120 } });
		svc.setupWeek({ energy: ["evening"] });
		assert.equal(store.profile()?.routine?.commitments.length, 1);
		assert.equal(store.profile()?.plan?.weeklyTargetMinutes, 120);
	});

	it("with no room left this week, next week is planned", async () => {
		const { svc, clock } = make();
		await svc.setupTimetable(gt);
		clock.set(new Date(2026, 10, 29, 21, 30)); // Sunday night
		const w = svc.setupWeek({});
		assert.equal(w.week, "2026-11-30");
		assert.ok(w.blocks.length > 0 && w.blocks.every((b) => b.date >= "2026-11-30"));
	});

	it("\"Looks good\" keeps the suggested blocks; setup shows the week again after a reload", async () => {
		const { svc, store } = make();
		await svc.setupTimetable(gt);
		const w = svc.setupWeek({ energy: ["morning"], weeklyTargetMinutes: 100 });
		assert.deepEqual(svc.setup().week?.blocks.map((b) => b.id), w.blocks.map((b) => b.id));
		svc.acceptBlocks({ week: w.week });
		assert.equal(store.blocks().filter((b) => b.status === "accepted").length, 2);
	});

	it("a module with slides is what the blocks study", async () => {
		const { svc } = make();
		await svc.setupTimetable(gt);
		await svc.quickMaterials("GT", [{ name: "GT_Week2_nash.pdf", bytes: pdf("Nash equilibrium") }]);
		const w = svc.setupWeek({ weeklyTargetMinutes: 50 });
		assert.deepEqual(w.blocks.map((b) => [b.module, b.title]), [["GT", "Nash equilibrium"]]);
	});
});

describe("setup: where it ends", () => {
	it("with slides: Learn, on the first unit in keep-up order", async () => {
		const { svc } = make();
		await svc.setupTimetable({ calendar: { kind: "none" }, modules: [{ name: "Game Theory", code: "GT" }, { name: "Neural Computation", code: "NC" }] });
		await svc.quickMaterials("NC", [{ name: "NC_Week1_intro.pdf", bytes: pdf("Perceptrons") }]);
		await svc.quickMaterials("GT", [{ name: "GT_Week2_nash.pdf", bytes: pdf("Nash equilibrium") }, { name: "GT_Week1_intro.pdf", bytes: pdf("Games in normal form") }]);
		const end = svc.setup().end;
		assert.deepEqual(end && { module: end.module, title: end.title }, { module: "GT", title: "Games in normal form" });
		assert.equal(SETUP_COPY.end.learn(end!.title), "Learn: Games in normal form");
		assert.deepEqual(svc.setupDone().end, end);
	});

	it("with no slides: nothing to learn yet, so the screen offers \"Add your slides\" (V-65)", async () => {
		const { svc } = make();
		await svc.setupTimetable(gt);
		assert.equal(svc.setup().end, null);
		assert.equal(SETUP_COPY.end.addSlides, "Add your slides");
	});
});

describe("a module's share of the week (V-63)", () => {
	it("Less, Normal or More, one tap; the planner gives that module more or fewer turns", async () => {
		const { svc, store, events } = make();
		await svc.setupTimetable({ calendar: { kind: "none" }, modules: [{ name: "Game Theory", code: "GT" }, { name: "Neural Computation", code: "NC" }] });
		await svc.quickMaterials("GT", [1, 2, 3].map((w) => ({ name: `GT_Week${w}.pdf`, bytes: pdf(`GT idea ${w}`) })));
		await svc.quickMaterials("NC", [1, 2, 3].map((w) => ({ name: `NC_Week${w}.pdf`, bytes: pdf(`NC idea ${w}`) })));
		const studied = () => svc.setupWeek({ weeklyTargetMinutes: 150 }).blocks.map((b) => b.module);

		assert.deepEqual(studied(), ["GT", "NC", "GT"]);
		assert.equal(svc.setModuleShare("NC", { share: "more" }).share, "more");
		assert.deepEqual(studied(), ["GT", "NC", "NC"]);
		svc.setModuleShare("NC", { share: "normal" });
		assert.equal(store.profile()?.modules.find((m) => m.code === "NC")?.share, undefined);
		svc.setModuleShare("GT", { share: "less" });
		assert.deepEqual(studied(), ["NC", "GT", "NC"]);
		for (const bad of ["lots", "", 2, undefined]) assert.throws(() => svc.setModuleShare("GT", { share: bad }), (e: CompanionError) => e.status === 400, String(bad));
		assert.throws(() => svc.setModuleShare("XX", { share: "more" }), (e: CompanionError) => e.status === 404);
		assert.equal(events().filter((t) => t === "module_share_changed").length, 3);
	});

	it("the course list carries each module's share for the Library", async () => {
		const { svc } = make();
		await svc.setupTimetable(gt);
		svc.setModuleShare("GT", { share: "more" });
		assert.equal(svc.course()[0]!.share, "more");
	});
});
