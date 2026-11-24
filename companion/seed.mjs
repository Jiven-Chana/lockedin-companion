#!/usr/bin/env node
/**
 * Seed a LearnHarness data directory for the companion (plan Appendix C.3).
 *
 *   npm run companion:seed                       # ./data
 *   LH_DATA_DIR=$PWD/runs/P03 npm run companion:seed
 *   npm run companion:seed -- --force            # also overwrite existing materials
 *
 * 1. settings.json: merged INTO the existing file, so model choices made in
 *    Settings survive. Placeholder model ids ("<…>") are never written;
 *    COMPANION_MODEL_STRONG/CHEAP/VISION="provider/id" fill the slots.
 * 2. Prompt overrides: companion/seed/prompts/** → <data>/prompts/**.
 * 3. Demo content: companion/content/<lecture>/** → <data>/companion/materials/<lecture>/**
 *    (existing files kept unless --force, so uploaded slides survive a re-seed).
 * 4. Prints where things went and which engine is active.
 *
 * The server calls seedDataDir() itself on first run (v0.1 F-102): when any
 * prompt override switched on in the seed is missing from <data>/prompts,
 * it seeds before the companion starts, so a fresh data directory needs no
 * manual step. Run this script to re-seed after pulling prompt changes.
 *
 * Lectures are NOT written here: onboarding materialises the sample timetable
 * relative to the (demo) clock, so the week is always "this week".
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isPlaceholder = (v) => typeof v === "string" && v.trim().startsWith("<");

/**
 * Deep merge: `base` (existing) wins for model slots that are already set; seed wins elsewhere.
 * @param {unknown} existing
 * @param {any} seed
 * @param {Record<string, string | undefined>} [env]
 */
export function mergeSettings(existing, seed, env = process.env) {
	const out = structuredClone(isObject(existing) ? existing : {});
	const merge = (target, src) => {
		for (const [k, v] of Object.entries(src)) {
			if (isObject(v)) {
				target[k] = isObject(target[k]) ? target[k] : {};
				merge(target[k], v);
			} else target[k] = v;
		}
	};
	const { models: seedModels = {}, ...rest } = seed;
	merge(out, rest);
	out.models = isObject(out.models) ? out.models : {};
	for (const slot of ["strong", "cheap", "vision"]) {
		const fromEnv = env[`COMPANION_MODEL_${slot.toUpperCase()}`];
		const seeded = seedModels[slot];
		if (fromEnv) {
			const i = fromEnv.indexOf("/");
			if (i <= 0) throw new Error(`COMPANION_MODEL_${slot.toUpperCase()} must be "provider/model-id"`);
			out.models[slot] = { ...(seeded?.thinkingLevel ? { thinkingLevel: seeded.thinkingLevel } : {}), ...out.models[slot], model: { provider: fromEnv.slice(0, i), id: fromEnv.slice(i + 1) } };
		} else if (!out.models[slot]?.model && seeded && !isPlaceholder(seeded.model?.id)) {
			out.models[slot] = seeded;
		} else if (out.models[slot]?.model && seeded?.thinkingLevel && out.models[slot].thinkingLevel === undefined && slot === "strong") {
			out.models[slot].thinkingLevel = seeded.thinkingLevel;
		}
	}
	if (Object.keys(out.models).length === 0) delete out.models;
	return out;
}

function copyTree(from, to, { overwrite }) {
	let copied = 0;
	let kept = 0;
	for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
		const src = path.join(from, entry.name);
		const dst = path.join(to, entry.name);
		if (entry.isDirectory()) {
			const r = copyTree(src, dst, { overwrite });
			copied += r.copied;
			kept += r.kept;
		} else {
			if (!overwrite && fs.existsSync(dst)) {
				kept++;
				continue;
			}
			fs.mkdirSync(to, { recursive: true });
			fs.copyFileSync(src, dst);
			copied++;
		}
	}
	return { copied, kept };
}

const seedPaths = (root) => {
	const seed = path.join(/* turbopackIgnore: true */ root, "companion", "seed");
	return { seed, content: path.join(/* turbopackIgnore: true */ root, "companion", "content") };
};

const readSeedSettings = (root) => JSON.parse(fs.readFileSync(path.join(/* turbopackIgnore: true */ seedPaths(root).seed, "settings.json"), "utf-8"));

/**
 * The prompt overrides the seed switches on, as paths under prompts/.
 * @param {string} root
 * @returns {string[]}
 */
export function seededPromptPaths(root) {
	return Object.entries(readSeedSettings(root).agent?.prompts ?? {})
		.filter(([, on]) => on === true)
		.map(([rel]) => rel);
}

/**
 * First run: true when any override the seed switches on is missing from <data>/prompts.
 * @param {{ root: string, dataDir: string }} opts
 */
export function needsSeed({ root, dataDir }) {
	return seededPromptPaths(root).some((rel) => !fs.existsSync(path.join(/* turbopackIgnore: true */ dataDir, "prompts", rel)));
}

/**
 * Seed one data directory. Returns what it did; prints nothing.
 * `force` also overwrites existing materials (uploaded slides are kept otherwise).
 * @param {{ root: string, dataDir: string, force?: boolean, env?: Record<string, string | undefined> }} opts
 */
export function seedDataDir({ root, dataDir, force = false, env = process.env }) {
	const { seed: SEED, content: CONTENT } = seedPaths(root);
	fs.mkdirSync(dataDir, { recursive: true });

	// 1. settings.json
	const settingsFile = path.join(/* turbopackIgnore: true */ dataDir, "settings.json");
	const existing = fs.existsSync(settingsFile) ? JSON.parse(fs.readFileSync(settingsFile, "utf-8")) : {};
	const merged = mergeSettings(existing, readSeedSettings(root), env);
	fs.writeFileSync(settingsFile, `${JSON.stringify(merged, null, "\t")}\n`);
	const missingModels = ["strong", "cheap", "vision"].filter((s) => !merged.models?.[s]?.model);

	// 2. prompt overrides
	const prompts = copyTree(path.join(/* turbopackIgnore: true */ SEED, "prompts"), path.join(/* turbopackIgnore: true */ dataDir, "prompts"), { overwrite: true });

	// 3. demo content
	const materialsDir = path.join(/* turbopackIgnore: true */ dataDir, "companion", "materials");
	let lectures = 0;
	let materials = { copied: 0, kept: 0 };
	for (const entry of fs.readdirSync(CONTENT, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		lectures++;
		const r = copyTree(path.join(/* turbopackIgnore: true */ CONTENT, entry.name), path.join(/* turbopackIgnore: true */ materialsDir, entry.name), { overwrite: force });
		materials = { copied: materials.copied + r.copied, kept: materials.kept + r.kept };
	}
	return { dataDir, prompts: prompts.copied, lectures, materials, missingModels };
}

async function main() {
	const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
	const dataDir = process.env.LH_DATA_DIR ? path.resolve(process.env.LH_DATA_DIR) : path.join(root, "data");
	const force = process.argv.includes("--force");

	// Derived overrides are rebuilt from the current engine source first; warn if the committed ones drifted.
	const { buildDerivedPrompts } = await import("./build-prompts.mjs");
	for (const [rel, text] of Object.entries(buildDerivedPrompts())) {
		const committed = path.join(root, "companion", "seed", "prompts", rel);
		if (!fs.existsSync(committed) || fs.readFileSync(committed, "utf-8") !== text) {
			console.warn(`! companion/seed/prompts/${rel} is stale against the source; run npm run companion:prompts and review.`);
		}
	}

	const r = seedDataDir({ root, dataDir, force });
	const engine = process.env.COMPANION_ENGINE || "scripted (COMPANION_ENGINE unset)";
	console.log(`Seeded ${r.dataDir}`);
	console.log(`  settings.json      merged (graph off, background tools off, file access restricted, 4 prompt overrides on)`);
	console.log(`  prompts/           ${r.prompts} override file(s)`);
	console.log(`  companion/materials ${r.lectures} lecture(s): ${r.materials.copied} copied, ${r.materials.kept} kept${r.materials.kept ? " (use --force to overwrite)" : ""}`);
	console.log(`  engine             ${engine}`);
	if (r.missingModels.length > 0) {
		console.log(`\n! Model slots not set: ${r.missingModels.join(", ")}. The learnharness engine needs them.`);
		console.log("  Configure once in LearnHarness Settings (npm run dev → http://localhost:3000), or set");
		console.log("  COMPANION_MODEL_STRONG/CHEAP/VISION=\"provider/model-id\" and re-run this script.");
	}
	console.log("\nNext: npm run dev → http://localhost:3000/api/companion/health");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
