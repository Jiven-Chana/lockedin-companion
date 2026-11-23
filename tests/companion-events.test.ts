/**
 * Instrumentation for the test (v0.1 F-121): every event the spec names
 * for a phase-A feature is a known event type and is actually logged
 * somewhere; every event the browser sends is accepted by the server;
 * and the CSV export carries any type.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { CLIENT_EVENT_TYPES, COMPANION_EVENT_TYPES, eventsToCsv } from "../src/core/companion/index.ts";

const ROOT = path.join(import.meta.dirname, "..");
const SPEC = fs.readFileSync(path.join(ROOT, "docs/companion/v0.1-spec.md"), "utf-8");
/** Phase B features (spec §9): their events come with them. */
const PHASE_B = new Set(["F-113", "F-115", "F-117"]);

function specEvents(): Map<string, string> {
	const out = new Map<string, string>();
	let feature = "";
	for (const line of SPEC.split("\n")) {
		const f = /^### (F-\d+)/.exec(line);
		if (f) feature = f[1]!;
		if (feature && /^- \*\*Events:\*\*/.test(line)) for (const m of line.matchAll(/`([a-z_0-9]+)`/g)) out.set(m[1]!, feature);
	}
	return out;
}

function sources(dirs: string[]): string {
	const files: string[] = [];
	const walk = (d: string) => {
		for (const e of fs.readdirSync(d, { withFileTypes: true })) {
			const p = path.join(d, e.name);
			if (e.isDirectory()) walk(p);
			else if (/\.(ts|tsx|js)$/.test(e.name)) files.push(p);
		}
	};
	for (const d of dirs) walk(path.join(ROOT, d));
	return files.filter((f) => !f.endsWith(path.join("companion", "types.ts"))).map((f) => fs.readFileSync(f, "utf-8")).join("\n");
}

describe("every event the spec names is logged (F-121)", () => {
	const events = specEvents();
	const code = sources(["src/server/companion", "src/core/companion", "components/lockedin", "relay/src", "relay/web"]);

	it("the spec names events (the parser found them)", () => {
		assert.ok(events.size > 30, String(events.size));
	});

	for (const [type, feature] of events) {
		if (PHASE_B.has(feature)) continue;
		it(`${type} (${feature}) is a known type and is logged`, () => {
			assert.ok((COMPANION_EVENT_TYPES as readonly string[]).includes(type), "missing from COMPANION_EVENT_TYPES");
			assert.ok(code.includes(`"${type}"`), "never logged by any companion code");
		});
	}
});

describe("browser events are accepted by the server", () => {
	it("every lockedIn.event(...) type is in CLIENT_EVENT_TYPES", () => {
		const ui = sources(["components/lockedin"]);
		const sent = new Set([...ui.matchAll(/lockedIn\.event\("([a-z_]+)"/g)].map((m) => m[1]!));
		assert.ok(sent.size >= 4);
		for (const t of sent) assert.ok((CLIENT_EVENT_TYPES as readonly string[]).includes(t), t);
	});
	it("client types are a subset of all types", () => {
		for (const t of CLIENT_EVENT_TYPES) assert.ok(COMPANION_EVENT_TYPES.includes(t), t);
	});
});

describe("the CSV export", () => {
	it("carries the new types, the phone source and awkward text", () => {
		const csv = eventsToCsv([
			{ t: "2026-11-26T10:00:00Z", wall: "2026-11-26T10:00:01Z", participant: "P07", type: "handover", data: { source: "phone", note: 'a "quoted", line\nbreak' } },
			{ t: "2026-11-26T10:01:00Z", wall: "2026-11-26T10:01:01Z", type: "motion_changed", data: { from: "calm", to: "full" } },
		]);
		const lines = csv.trimEnd().split("\n");
		assert.equal(lines[0], "t,wall,participant,type,data");
		assert.match(csv, /,P07,handover,"\{""source"":""phone""/);
		assert.match(csv, /,,motion_changed,/);
	});
});
