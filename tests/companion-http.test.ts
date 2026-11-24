/**
 * Route error mapping. Next gives each route its own module instances while
 * the service is shared through globalThis, so a service error can fail
 * `instanceof` in another route (found live in stage 2: a rejected API key
 * came back as a 500).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CompanionError, EngineError } from "../src/server/companion/errors.ts";
import { companionErrorResponse } from "../src/server/companion/http.ts";

class ForeignCompanionError extends Error {
	readonly code = "key_rejected";
	readonly status = 400;
	constructor() {
		super("OpenAI didn't accept that key.");
		this.name = "CompanionError";
	}
}

describe("route error mapping", () => {
	const cases: Array<[string, unknown, number, string]> = [
		["this module's CompanionError", new CompanionError("bad_request", 400, "nope"), 400, "bad_request"],
		["an EngineError", new EngineError("timeout", "slow", 504), 504, "timeout"],
		["a CompanionError from another route's module copy", new ForeignCompanionError(), 400, "key_rejected"],
		["anything else is a 500", new Error("boom"), 500, "internal"],
	];
	for (const [name, err, status, code] of cases)
		it(name, async () => {
			const res = companionErrorResponse(err);
			assert.equal(res.status, status);
			assert.equal(((await res.json()) as { code: string }).code, code);
		});
});
