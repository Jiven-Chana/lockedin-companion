#!/usr/bin/env node
/**
 * Builds the two DERIVED prompt overrides from LearnHarness's source
 * fragments plus our patches (plan §6.2, Appendix A.3/A.4):
 *
 *   teacher/05-method.md     = source with one paragraph replaced
 *   shared/40-formatting.md  = source + our "In this app" rules
 *
 * The full-replacement overrides (prober/10-probe-doctrine.md,
 * teacher/10-planning.md) are hand-written in companion/seed/prompts/.
 *
 *   node companion/build-prompts.mjs          regenerate companion/seed/prompts/**
 *   node companion/build-prompts.mjs --check  exit 1 if the committed files are stale
 *
 * --check runs in CI: after anyone edits an engine prompt fragment,
 * it fails until someone regenerates and reviews the overrides. If the
 * paragraph to replace no longer exists upstream, it fails loudly too.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(ROOT, "src", "agent", "prompts");
const PATCHES = path.join(ROOT, "companion", "seed", "prompt-patches");
const OUT = path.join(ROOT, "companion", "seed", "prompts");

const read = (p) => fs.readFileSync(p, "utf-8");

export function buildDerivedPrompts() {
	const method = read(path.join(SOURCE, "teacher", "05-method.md"));
	const find = read(path.join(PATCHES, "teacher", "05-method.find.md")).trim();
	const replacement = read(path.join(PATCHES, "teacher", "05-method.with.md")).trim();
	if (!method.includes(find)) {
		throw new Error(
			"teacher/05-method.md upstream no longer contains the paragraph we replace.\n" +
				"Update companion/seed/prompt-patches/teacher/05-method.find.md (and .with.md) against the new source.",
		);
	}
	const formatting = read(path.join(SOURCE, "shared", "40-formatting.md")).trimEnd();
	const appendix = read(path.join(PATCHES, "shared", "40-formatting.append.md")).trim();
	return {
		"teacher/05-method.md": method.replace(find, replacement),
		"shared/40-formatting.md": `${formatting}\n\n${appendix}\n`,
	};
}

function main() {
	const check = process.argv.includes("--check");
	const built = buildDerivedPrompts();
	let stale = 0;
	for (const [rel, text] of Object.entries(built)) {
		const file = path.join(OUT, rel);
		const current = fs.existsSync(file) ? read(file) : null;
		if (current === text) continue;
		if (check) {
			console.error(`stale: companion/seed/prompts/${rel} (run: npm run companion:prompts)`);
			stale++;
		} else {
			fs.mkdirSync(path.dirname(file), { recursive: true });
			fs.writeFileSync(file, text);
			console.log(`wrote companion/seed/prompts/${rel}`);
		}
	}
	// Every override must target a segment that exists in the source tree
	// (overrides can replace fragments, never add new ones).
	for (const rel of listOverrides(OUT)) {
		if (!fs.existsSync(path.join(SOURCE, rel))) {
			console.error(`override companion/seed/prompts/${rel} has no source segment src/agent/prompts/${rel}`);
			stale++;
		}
	}
	if (stale > 0) process.exit(1);
	if (check) console.log("prompt overrides are up to date");
}

function listOverrides(dir, prefix = "") {
	const out = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) out.push(...listOverrides(path.join(dir, entry.name), rel));
		else if (entry.name.endsWith(".md")) out.push(rel);
	}
	return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
