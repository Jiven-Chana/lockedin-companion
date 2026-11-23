/**
 * First-run seeding (v0.1 F-102): a fresh data directory is seeded when the
 * companion starts, so `npm run companion:seed` is no longer a manual step.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { needsSeed, seedDataDir, seededPromptPaths } from "../companion/seed.mjs";
import { ensureSeeded } from "../src/server/companion/default.ts";

const ROOT = path.join(import.meta.dirname, "..");
const dirs: string[] = [];
const fresh = () => {
	const d = fs.mkdtempSync(path.join(os.tmpdir(), "lockedin-seed-"));
	dirs.push(d);
	return d;
};
const readJson = (p: string) => JSON.parse(fs.readFileSync(p, "utf-8"));
const quiet = { COMPANION_MODEL_STRONG: undefined } as Record<string, string | undefined>;

afterEach(() => {
	for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("first-run seed", () => {
	it("knows the four overrides the seed switches on", () => {
		assert.deepEqual(seededPromptPaths(ROOT).sort(), [
			"prober/10-probe-doctrine.md",
			"shared/40-formatting.md",
			"teacher/05-method.md",
			"teacher/10-planning.md",
		]);
	});

	const states: Array<[string, (dataDir: string) => void, boolean]> = [
		["an empty directory needs seeding", () => {}, true],
		["a seeded directory does not", (d) => seedDataDir({ root: ROOT, dataDir: d, env: quiet }), false],
		[
			"a directory missing one override needs seeding again",
			(d) => {
				seedDataDir({ root: ROOT, dataDir: d, env: quiet });
				fs.rmSync(path.join(d, "prompts", "teacher", "05-method.md"));
			},
			true,
		],
	];
	for (const [name, setup, expected] of states)
		it(name, () => {
			const d = fresh();
			setup(d);
			assert.equal(needsSeed({ root: ROOT, dataDir: d }), expected);
		});

	it("writes the switches and never a placeholder model id", () => {
		const d = fresh();
		const r = seedDataDir({ root: ROOT, dataDir: d, env: quiet });
		const settings = readJson(path.join(d, "settings.json"));
		assert.equal(settings.graph.enabled, false);
		assert.equal(settings.agent.fileAccess.restricted, true);
		assert.equal(Object.keys(settings.agent.prompts).length, 4);
		assert.equal(settings.models, undefined, "placeholder slots are not written");
		assert.deepEqual(r.missingModels, ["strong", "cheap", "vision"]);
		assert.ok(r.lectures > 0 && fs.existsSync(path.join(d, "companion", "materials", "hci-w3-personas", "slides.md")));
	});

	it("keeps model slots and uploaded slides on a re-seed", () => {
		const d = fresh();
		seedDataDir({ root: ROOT, dataDir: d, env: quiet });
		const settingsFile = path.join(d, "settings.json");
		const chosen = { model: { provider: "openai", id: "chosen-in-settings" } };
		fs.writeFileSync(settingsFile, JSON.stringify({ ...readJson(settingsFile), models: { strong: chosen } }));
		const slides = path.join(d, "companion", "materials", "hci-w3-personas", "slides.md");
		fs.writeFileSync(slides, "# my own upload\n");

		seedDataDir({ root: ROOT, dataDir: d, env: quiet });
		assert.deepEqual(readJson(settingsFile).models.strong.model, chosen.model);
		assert.equal(fs.readFileSync(slides, "utf-8"), "# my own upload\n");
	});

	it("the server seeds once, then leaves the directory alone", () => {
		const d = fresh();
		const first = ensureSeeded({ root: ROOT, dataDir: d, env: quiet });
		assert.equal(first?.prompts, 4);
		assert.equal(ensureSeeded({ root: ROOT, dataDir: d, env: quiet }), null);
	});
});
