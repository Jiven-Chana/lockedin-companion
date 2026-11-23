/**
 * Motion (v0.1 F-118, V-10): Calm by default, Full and Off; old profiles
 * with reduceMotion migrate; the choice is validated and logged; the
 * timings stay in the ranges the spec sets.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { DEFAULT_APPEARANCE, MOTION, migrateAppearance, readAppearance } from "../src/core/companion/index.ts";
import { ManualClock } from "../src/server/companion/clock.ts";
import { CompanionContent } from "../src/server/companion/content.ts";
import { ScriptedEngine } from "../src/server/companion/engines/scripted.ts";
import { CompanionService } from "../src/server/companion/service.ts";
import { CompanionStore } from "../src/server/companion/store.ts";

const CONTENT = path.join(import.meta.dirname, "..", "companion", "content");

function setup() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "companion-motion-"));
	const store = new CompanionStore(dir);
	const content = new CompanionContent(store, CONTENT);
	const clock = new ManualClock(new Date(2026, 10, 17, 10));
	const scripted = new ScriptedEngine((id) => content.scriptedSet(id));
	const svc = new CompanionService({ store, content, clock, clockControl: { set: (t) => clock.set(t), reset: () => undefined }, engines: { scripted, learnharness: scripted }, defaultEngine: "scripted" });
	return { svc, store, dir };
}

describe("the setting (F-118)", () => {
	it("Calm is the default", () => {
		assert.equal(DEFAULT_APPEARANCE.motion, "calm");
		assert.equal(readAppearance(undefined).motion, "calm");
	});
	it("old profiles migrate: reduceMotion true → Off, false → Calm; a set motion wins", () => {
		assert.equal(migrateAppearance({ reduceMotion: true }).motion, "off");
		assert.equal(migrateAppearance({ reduceMotion: false }).motion, "calm");
		assert.equal(migrateAppearance({ motion: "full", reduceMotion: true } as never).motion, "full");
		assert.ok(!("reduceMotion" in migrateAppearance({ reduceMotion: true, theme: "dark" })));
		assert.equal(migrateAppearance({ motion: "wobbly" } as never).motion, "calm");
	});
	it("a v0.0 profile on disk is read with motion", () => {
		const { svc, store, dir } = setup();
		svc.onboard({});
		const file = fs.readdirSync(dir).find((f) => f.startsWith("profile"))!;
		const raw = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"));
		const { motion: _drop, ...rest } = raw.appearance;
		raw.appearance = { ...rest, reduceMotion: true };
		fs.writeFileSync(path.join(dir, file), JSON.stringify(raw));
		assert.equal(store.profile()?.appearance.motion, "off");
		assert.ok(!("reduceMotion" in store.profile()!.appearance));
	});
	it("only calm, full or off are accepted, and a change is logged as motion_changed", () => {
		const { svc, store } = setup();
		svc.onboard({});
		assert.throws(() => svc.updateProfile({ appearance: { motion: "wobbly" } }), /calm, full or off/);
		assert.throws(() => svc.updateProfile({ appearance: { reduceMotion: true } }), /unknown appearance setting/);
		assert.equal(svc.updateProfile({ appearance: { motion: "full" } }).appearance.motion, "full");
		svc.updateProfile({ appearance: { motion: "full" } });
		const logged = store.events().filter((e) => e.type === "motion_changed");
		assert.equal(logged.length, 1, "setting the same value again isn't a change");
		assert.deepEqual([logged[0]!.data.from, logged[0]!.data.to], ["calm", "full"]);
	});
});

describe("timings (V-10)", () => {
	it("interactions take 150 to 300 ms; the drift is slow", () => {
		for (const ms of [MOTION.shortMs, MOTION.mediumMs, MOTION.ringMs, MOTION.pageMs]) assert.ok(ms >= 150 && ms <= 300, String(ms));
		assert.ok(MOTION.driftSeconds >= 20);
		assert.ok(MOTION.staggerMs <= 100);
	});
});
