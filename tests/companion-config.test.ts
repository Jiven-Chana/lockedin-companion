/**
 * v1.0 wiring that lives outside the service: the plain address opens
 * LockedIn (C-2, V-27), and the demo clock only moves time for a
 * facilitator (P-4).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import nextConfig from "../next.config.ts";
import { demoClockOffsetMs } from "../src/server/companion/default.ts";

describe("the plain address opens LockedIn (C-2)", () => {
	it("/ redirects to /app, temporarily, and nothing else is redirected", async () => {
		const redirects = await nextConfig.redirects!();
		assert.deepEqual(redirects, [{ source: "/", destination: "/app", permanent: false }]);
	});
});

describe("the demo clock is the facilitator's (P-4)", () => {
	const hour = 3_600_000;
	const cases: Array<[string, number | undefined, Record<string, string | undefined>, number]> = [
		["a leftover offset is ignored in a real run", 5 * hour, {}, 0],
		["COMPANION_DEMO=0 is a real run", 5 * hour, { COMPANION_DEMO: "0" }, 0],
		["the facilitator's offset applies in demo mode", 5 * hour, { COMPANION_DEMO: "1" }, 5 * hour],
		["no offset stored", undefined, { COMPANION_DEMO: "1" }, 0],
	];
	for (const [name, stored, env, expected] of cases) it(name, () => assert.equal(demoClockOffsetMs(stored, env), expected));
});
