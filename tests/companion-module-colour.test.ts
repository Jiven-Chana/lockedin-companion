/**
 * A module's colour, picked in Me (v3.0): "Make it yours" is choosing each
 * module's colour. Only a module colour can be picked: never mint or lilac,
 * which mean right and to revisit.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { MODULE_COLOUR_CHOICES, MODULE_COLOUR_ORDER, moduleLook } from "../src/core/companion/index.ts";
import { ManualClock } from "../src/server/companion/clock.ts";
import { CompanionContent } from "../src/server/companion/content.ts";
import { ScriptedEngine } from "../src/server/companion/engines/scripted.ts";
import { CompanionError } from "../src/server/companion/errors.ts";
import { CompanionService } from "../src/server/companion/service.ts";
import { CompanionStore } from "../src/server/companion/store.ts";

async function setup() {
	const store = new CompanionStore(fs.mkdtempSync(path.join(os.tmpdir(), "companion-colour-")));
	const content = new CompanionContent(store, path.join(import.meta.dirname, "..", "companion", "content"));
	const clock = new ManualClock(new Date(2026, 10, 23, 7));
	const scripted = new ScriptedEngine((id) => content.scriptedSet(id));
	const svc = new CompanionService({ store, content, clock, clockControl: { set: (t) => clock.set(t), reset: () => undefined }, engines: { scripted, learnharness: scripted }, defaultEngine: "scripted", newId: (p) => `${p}x` });
	await svc.onboardFlow({ calendar: { kind: "sample" } });
	const codes = svc.profile()!.modules.map((m) => m.code);
	assert.ok(codes.length >= 2);
	return { svc, store, codes };
}

describe("a module's colour", () => {
	it("starts as its place in the student's list", async () => {
		const { svc, codes } = await setup();
		assert.deepEqual(codes.map((c) => moduleLook(c, svc.profile()!.modules).colour), codes.map((_, i) => MODULE_COLOUR_ORDER[i % MODULE_COLOUR_ORDER.length]));
	});

	it("can be picked, is kept, and is logged; picking nothing gives it its place back", async () => {
		const { svc, store, codes } = await setup();
		const code = codes[1]!;
		assert.equal(svc.setModuleColour(code, { colour: "sunflower" }).colour, "sunflower");
		assert.equal(moduleLook(code, svc.profile()!.modules).colour, "sunflower");
		const e = store.events().find((x) => x.type === "module_colour_changed")!;
		assert.deepEqual([e.data.module, e.data.to], [code, "sunflower"]);
		assert.equal(svc.setModuleColour(code, { colour: null }).colour, MODULE_COLOUR_ORDER[1]);
		assert.equal(svc.profile()!.modules.find((m) => m.code === code)!.colour, undefined);
	});

	const refused: unknown[] = ["mint", "lilac", "crimson", "#FF0000", 7, undefined];
	for (const colour of refused) {
		it(`"${String(colour)}" cannot be picked`, async () => {
			const { svc, codes } = await setup();
			assert.throws(() => svc.setModuleColour(codes[0]!, { colour }), (e: unknown) => e instanceof CompanionError && e.status === 400);
		});
	}

	it("every colour on offer can be picked; a module that does not exist cannot be coloured", async () => {
		const { svc, codes } = await setup();
		for (const colour of MODULE_COLOUR_CHOICES) assert.equal(svc.setModuleColour(codes[0]!, { colour }).colour, colour);
		assert.throws(() => svc.setModuleColour("NOPE", { colour: "rose" }), (e: unknown) => e instanceof CompanionError && e.status === 404);
	});
});
