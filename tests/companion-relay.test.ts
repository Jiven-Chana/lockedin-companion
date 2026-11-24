/**
 * The phone relay (v0.1 F-112, spec §5, Appendix B) against real SQLite
 * (node:sqlite behind the same small D1 interface the Worker uses): auth
 * scopes, schedule versions only go up, events are idempotent and ordered,
 * snooze, the cron fires once and expires, delete removes everything, and
 * the VAPID signature verifies.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import type { Db, Stmt } from "../relay/src/db.ts";
import { fromB64url, generateVapidKeys, vapidJwt } from "../relay/src/push.ts";
import { cron, handle, LIMITS, type RelayEnv } from "../relay/src/relay.ts";

function sqliteDb(): Db {
	const db = new DatabaseSync(":memory:");
	db.exec(fs.readFileSync(path.join(import.meta.dirname, "..", "relay", "schema.sql"), "utf-8"));
	const stmt = (sql: string, values: unknown[] = []): Stmt => ({
		bind: (...v) => stmt(sql, v),
		first: async <T,>() => (db.prepare(sql).get(...(values as never[])) as T | undefined) ?? null,
		all: async <T,>() => ({ results: db.prepare(sql).all(...(values as never[])) as T[] }),
		run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...(values as never[])).changes) } }),
	});
	return { prepare: (sql) => stmt(sql), batch: async (stmts) => Promise.all(stmts.map((s) => s.run())) };
}

const T0 = new Date("2026-11-24T12:00:00.000Z");
const at = (min: number) => new Date(T0.getTime() + min * 60_000);
const BASE = "https://relay.test";

async function setup(env: Partial<RelayEnv> = {}) {
	const e: RelayEnv = { DB: sqliteDb(), ...env };
	const call = async (method: string, p: string, tokenValue?: string, body?: unknown, now = T0) => {
		const res = await handle(new Request(BASE + p, { method, headers: { ...(tokenValue ? { authorization: `Bearer ${tokenValue}` } : {}), "content-type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }), e, now);
		const text = await res.text();
		return { status: res.status, body: text ? JSON.parse(text) : null };
	};
	const pair = (await call("POST", "/v1/pairs")).body as { pairId: string; laptopSecret: string; phoneToken: string };
	return { env: e, call, ...pair };
}

const nudge = (id: string, fireMin: number, extra: Record<string, unknown> = {}) => ({
	id, fireAt: at(fireMin).toISOString(), expiresAt: at(fireMin + 120).toISOString(), snoozeFireAt: at(fireMin + 90).toISOString(), kind: "N-1", title: "HCI just finished. One question:", body: "Which is the main purpose of a persona?", ...extra,
});

describe("pairing and scopes (§5.3)", () => {
	it("a pair has three 128-bit tokens; the laptop and phone each reach only their side", async () => {
		const { call, pairId, laptopSecret, phoneToken } = await setup();
		for (const t of [pairId, laptopSecret, phoneToken]) assert.match(t, /^[0-9a-f]{32}$/);
		assert.equal((await call("PUT", `/v1/pairs/${pairId}/schedule`, phoneToken, { version: 1, nudges: [] })).status, 401, "the phone can't write the schedule");
		assert.equal((await call("GET", `/v1/pairs/${pairId}/events`, phoneToken)).status, 401, "the phone can't read the event log");
		assert.equal((await call("GET", `/v1/pairs/${pairId}/schedule`, laptopSecret)).status, 401, "the laptop doesn't read display payloads");
		assert.equal((await call("POST", `/v1/pairs/${pairId}/events`, laptopSecret, [])).status, 401, "the laptop never writes events");
		assert.equal((await call("GET", `/v1/pairs/${pairId}/schedule`)).status, 401, "no token, nothing");
		assert.equal((await call("GET", `/v1/pairs/${"0".repeat(32)}/schedule`, phoneToken)).status, 401, "a token for another pair");
	});
});

describe("pairing with a 6-digit code (v1.0.3)", () => {
	const getCode = async (s: Awaited<ReturnType<typeof setup>>, now = T0) => (await s.call("POST", `/v1/pairs/${s.pairId}/code`, s.laptopSecret, undefined, now)).body as { code: string; expiresAt: string };

	it("the laptop gets a code for its pair, good for ten minutes, and the same one while it lasts", async () => {
		const s = await setup();
		const first = await getCode(s);
		assert.match(first.code, /^\d{6}$/);
		assert.equal(first.expiresAt, at(LIMITS.codeMinutes).toISOString());
		assert.deepEqual(await getCode(s, at(3)), first, "asking again while it lasts doesn't change what is on screen");
		const later = await getCode(s, at(LIMITS.codeMinutes + 1));
		assert.notEqual(later.expiresAt, first.expiresAt, "an expired code is replaced");
		assert.equal((await s.call("POST", `/v1/pairs/${s.pairId}/code`, s.phoneToken)).status, 401, "only the laptop can ask for a code");
	});

	it("a phone that types the code is paired: it gets the pair and a token of its own", async () => {
		const s = await setup();
		const { code } = await getCode(s);
		const claimed = await s.call("POST", "/v1/claim", undefined, { code });
		assert.equal(claimed.status, 200);
		assert.equal(claimed.body.pairId, s.pairId);
		assert.match(claimed.body.token, /^[0-9a-f]{32}$/);
		assert.equal((await s.call("GET", `/v1/pairs/${s.pairId}/schedule`, claimed.body.token)).status, 200, "the new token works");
		assert.equal((await s.call("GET", `/v1/pairs/${s.pairId}/schedule`, s.phoneToken)).status, 401, "a pair has one phone: the QR code's token stops working");
		assert.ok((await s.call("GET", `/v1/pairs/${s.pairId}/status`, s.laptopSecret)).body.phoneSeenAt, "and the laptop sees the phone arrive");
	});

	it("a code works once, however it is typed", async () => {
		const s = await setup();
		const { code } = await getCode(s);
		assert.equal((await s.call("POST", "/v1/claim", undefined, { code: ` ${code.slice(0, 3)} ${code.slice(3)} ` })).status, 200, "spaces don't matter");
		const again = await s.call("POST", "/v1/claim", undefined, { code });
		assert.deepEqual([again.status, again.body.error], [404, "wrong_code"]);
	});

	it("a wrong or expired code is refused, and says which", async () => {
		const s = await setup();
		const { code } = await getCode(s);
		const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, "0");
		assert.deepEqual((await s.call("POST", "/v1/claim", undefined, { code: wrong })).body, { error: "wrong_code" });
		for (const bad of ["", "12345", "abcdef", "1234567", null, 123456]) assert.equal((await s.call("POST", "/v1/claim", undefined, { code: bad })).status, bad === 123456 ? 404 : 400, String(bad));
		const late = await s.call("POST", "/v1/claim", undefined, { code }, at(LIMITS.codeMinutes + 1));
		assert.deepEqual([late.status, late.body.error], [410, "expired_code"]);
		assert.equal((await s.call("GET", `/v1/pairs/${s.pairId}/schedule`, s.phoneToken)).status, 200, "a refused code changes nothing");
	});

	it("guessing is cut off: after too many wrong codes in a minute, every claim waits", async () => {
		const s = await setup();
		const { code } = await getCode(s);
		const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, "0");
		for (let i = 0; i < LIMITS.claimFailuresPerMinute; i++) assert.equal((await s.call("POST", "/v1/claim", undefined, { code: wrong })).status, 404);
		assert.equal((await s.call("POST", "/v1/claim", undefined, { code: wrong })).status, 429);
		assert.equal((await s.call("POST", "/v1/claim", undefined, { code })).status, 429, "even the right code waits, so a guesser learns nothing");
		assert.equal((await s.call("POST", "/v1/claim", undefined, { code }, at(2))).status, 200, "a minute later it works");
	});

	it("unpairing and the every-minute job clear codes away", async () => {
		const s = await setup();
		const { code } = await getCode(s);
		await s.call("DELETE", `/v1/pairs/${s.pairId}`, s.laptopSecret);
		assert.equal((await s.call("POST", "/v1/claim", undefined, { code })).status, 404);
		const t = await setup();
		await getCode(t);
		await cron(t.env, at(LIMITS.codeMinutes + 1));
		assert.equal((await t.env.DB.prepare("SELECT COUNT(*) AS n FROM pair_codes").first<{ n: number }>())?.n, 0);
	});
});

describe("the schedule (§5.2: the laptop writes, versions only go up)", () => {
	it("a higher version replaces the queue; the same or a lower one is ignored", async () => {
		const { call, pairId, laptopSecret, phoneToken } = await setup();
		assert.deepEqual((await call("PUT", `/v1/pairs/${pairId}/schedule`, laptopSecret, { version: 2, timeZone: "Europe/London", nudges: [nudge("a", 10)], blocks: [{ date: "2026-11-24", start: "14:00" }] })).body, { accepted: true, version: 2 });
		assert.deepEqual((await call("PUT", `/v1/pairs/${pairId}/schedule`, laptopSecret, { version: 2, nudges: [nudge("b", 10)] })).body, { accepted: false, version: 2 });
		assert.equal((await call("PUT", `/v1/pairs/${pairId}/schedule`, laptopSecret, { version: 1, nudges: [] })).body.accepted, false);
		const view = (await call("GET", `/v1/pairs/${pairId}/schedule`, phoneToken)).body;
		assert.deepEqual(view.nudges.map((n: { id: string }) => n.id), ["a"]);
		assert.equal(view.timeZone, "Europe/London");
		assert.equal(view.blocks.length, 1);
		await call("PUT", `/v1/pairs/${pairId}/schedule`, laptopSecret, { version: 3, nudges: [nudge("c", 20)] });
		assert.deepEqual((await call("GET", `/v1/pairs/${pairId}/schedule`, phoneToken)).body.nudges.map((n: { id: string }) => n.id), ["c"]);
	});

	it("refuses a nudge without times, or too large", async () => {
		const { call, pairId, laptopSecret } = await setup();
		assert.equal((await call("PUT", `/v1/pairs/${pairId}/schedule`, laptopSecret, { version: 1, nudges: [{ id: "x" }] })).status, 400);
		assert.equal((await call("PUT", `/v1/pairs/${pairId}/schedule`, laptopSecret, { version: 1, nudges: [nudge("x", 1, { body: "y".repeat(5000) })] })).status, 400);
	});
});

describe("events (§5.2: the phone writes, the laptop replays)", () => {
	it("idempotent by id, in order, with a cursor; acknowledged events are kept 7 days", async () => {
		const { env, call, pairId, laptopSecret, phoneToken } = await setup();
		const e1 = { id: "e-11111111", at: at(1).toISOString(), type: "answered", nudgeId: "a", payload: { choice: 1, correct: true } };
		const e2 = { id: "e-22222222", at: at(2).toISOString(), type: "handover", nudgeId: "a", payload: {} };
		assert.equal((await call("POST", `/v1/pairs/${pairId}/events`, phoneToken, [e1, e2])).status, 204);
		assert.equal((await call("POST", `/v1/pairs/${pairId}/events`, phoneToken, [e1])).status, 204, "a retry from an offline phone");
		const page = (await call("GET", `/v1/pairs/${pairId}/events?after=0`, laptopSecret)).body;
		assert.deepEqual(page.events.map((e: { type: string }) => e.type), ["answered", "handover"]);
		assert.deepEqual(page.events[0].payload, { choice: 1, correct: true, nudgeId: "a" });
		assert.deepEqual((await call("GET", `/v1/pairs/${pairId}/events?after=${page.cursor}`, laptopSecret)).body.events, []);
		await call("POST", `/v1/pairs/${pairId}/events/ack`, laptopSecret, { cursor: page.cursor });
		await cron(env, at(60 * 24 * 6));
		assert.equal((await call("GET", `/v1/pairs/${pairId}/events?after=0`, laptopSecret)).body.events.length, 2, "kept for 7 days");
		await cron(env, at(60 * 24 * 8));
		assert.equal((await call("GET", `/v1/pairs/${pairId}/events?after=0`, laptopSecret)).body.events.length, 0, "then deleted");
	});

	it("refuses unknown types and ids without enough randomness", async () => {
		const { call, pairId, phoneToken } = await setup();
		assert.equal((await call("POST", `/v1/pairs/${pairId}/events`, phoneToken, [{ id: "e-12345678", type: "delete_everything" }])).status, 400);
		assert.equal((await call("POST", `/v1/pairs/${pairId}/events`, phoneToken, [{ id: "x", type: "answered" }])).status, 400);
	});

	it('"Later" on the phone queues the snooze time the laptop planned', async () => {
		const { call, pairId, laptopSecret, phoneToken } = await setup();
		await call("PUT", `/v1/pairs/${pairId}/schedule`, laptopSecret, { version: 1, nudges: [nudge("a", 0)] });
		await call("POST", `/v1/pairs/${pairId}/events`, phoneToken, [{ id: "e-33333333", type: "snoozed", nudgeId: "a" }]);
		const ids = (await call("GET", `/v1/pairs/${pairId}/schedule`, phoneToken)).body.nudges.map((n: { id: string; fireAt: string }) => `${n.id}@${n.fireAt}`);
		assert.deepEqual(ids, [`a@${at(0).toISOString()}`, `a:snooze@${at(90).toISOString()}`]);
	});
});

describe("the cron (every minute)", () => {
	it("wakes each subscribed phone once per due nudge, never twice, and drops expired ones", async () => {
		const pushes: string[] = [];
		const keys = await generateVapidKeys("mailto:test@example.invalid");
		const { env, call, pairId, laptopSecret, phoneToken } = await setup({ VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey });
		await call("POST", `/v1/pairs/${pairId}/subscriptions`, phoneToken, { endpoint: "https://push.example/sub/1" });
		await call("PUT", `/v1/pairs/${pairId}/schedule`, laptopSecret, { version: 1, nudges: [nudge("a", 5), nudge("b", 30)] });
		const fake: typeof fetch = async (input) => {
			pushes.push(String(input));
			return new Response(null, { status: 201 });
		};
		assert.deepEqual(await cron(env, at(4), fake), { sent: 0, gone: 0 });
		assert.deepEqual(await cron(env, at(5), fake), { sent: 1, gone: 0 });
		assert.deepEqual(await cron(env, at(6), fake), { sent: 0, gone: 0 }, "never twice");
		const view = (await call("GET", `/v1/pairs/${pairId}/schedule`, phoneToken, undefined, at(6))).body;
		assert.ok(view.nudges.find((n: { id: string; sentAt: string | null }) => n.id === "a")?.sentAt, "the phone sees it as sent");
		await call("PUT", `/v1/pairs/${pairId}/schedule`, laptopSecret, { version: 2, nudges: [nudge("a", 5), nudge("b", 30)] });
		assert.deepEqual(await cron(env, at(7), fake), { sent: 0, gone: 0 }, "a re-upload doesn't re-send a sent nudge");
		await cron(env, at(200), fake);
		assert.equal((await call("GET", `/v1/pairs/${pairId}/schedule`, phoneToken, undefined, at(200))).body.nudges.length, 0, "expired nudges are gone");
		assert.equal(pushes.length, 1);
	});

	it("an expired subscription (410) is deleted", async () => {
		const keys = await generateVapidKeys("mailto:test@example.invalid");
		const { env, call, pairId, laptopSecret, phoneToken } = await setup({ VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey });
		await call("POST", `/v1/pairs/${pairId}/subscriptions`, phoneToken, { endpoint: "https://push.example/sub/old" });
		await call("PUT", `/v1/pairs/${pairId}/schedule`, laptopSecret, { version: 1, nudges: [nudge("a", 0)] });
		assert.deepEqual(await cron(env, at(1), async () => new Response(null, { status: 410 })), { sent: 0, gone: 1 });
		assert.equal((await call("GET", `/v1/pairs/${pairId}/status`, laptopSecret)).body.pushReady, false);
	});
});

describe("delete (unpair, and 'Delete all my data')", () => {
	it("either side deletes everything for the pair at once", async () => {
		const { call, pairId, laptopSecret, phoneToken } = await setup();
		await call("PUT", `/v1/pairs/${pairId}/schedule`, laptopSecret, { version: 1, nudges: [nudge("a", 5)] });
		await call("POST", `/v1/pairs/${pairId}/events`, phoneToken, [{ id: "e-44444444", type: "opened" }]);
		assert.equal((await call("DELETE", `/v1/pairs/${pairId}`, phoneToken)).status, 204);
		assert.equal((await call("GET", `/v1/pairs/${pairId}/events`, laptopSecret)).status, 401, "the pair is gone");
	});
});

describe("VAPID (RFC 8292)", () => {
	it("the JWT is ES256-signed by the key pair and names the push service", async () => {
		const keys = await generateVapidKeys("mailto:test@example.invalid");
		const jwt = await vapidJwt("https://push.example", keys, 1_000_000);
		const [h, c, s] = jwt.split(".");
		assert.deepEqual(JSON.parse(Buffer.from(h!, "base64url").toString()), { typ: "JWT", alg: "ES256" });
		assert.deepEqual(JSON.parse(Buffer.from(c!, "base64url").toString()), { aud: "https://push.example", exp: 1_000_000 + 43_200, sub: "mailto:test@example.invalid" });
		const pub = await crypto.subtle.importKey("raw", fromB64url(keys.publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
		assert.ok(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, Buffer.from(s!, "base64url"), new TextEncoder().encode(`${h}.${c}`)));
	});
});
