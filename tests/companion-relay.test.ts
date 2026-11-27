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
		assert.deepEqual((await call("PUT", `/v1/pairs/${pairId}/schedule`, laptopSecret, { version: 2, timeZone: "Europe/London", nudges: [nudge("a", 10)], blocks: [{ date: "2026-11-24", start: "14:00" }] })).body, { accepted: true, version: 2, limits: { nudgeChars: LIMITS.payloadChars, blocksChars: LIMITS.blocksChars } });
		assert.deepEqual((await call("PUT", `/v1/pairs/${pairId}/schedule`, laptopSecret, { version: 2, nudges: [nudge("b", 10)] })).body, { accepted: false, version: 2, limits: { nudgeChars: LIMITS.payloadChars, blocksChars: LIMITS.blocksChars } });
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
		assert.equal((await call("PUT", `/v1/pairs/${pairId}/schedule`, laptopSecret, { version: 1, nudges: [nudge("x", 1, { body: "y".repeat(13_000) })] })).status, 400);
		// A question with the rest of its round fits (v2.1): the limit is 12,000 characters, and the laptop is told so.
		assert.equal(LIMITS.payloadChars, 12_000);
		assert.equal((await call("PUT", `/v1/pairs/${pairId}/schedule`, laptopSecret, { version: 1, nudges: [nudge("x", 1, { round: "y".repeat(10_000) })] })).status, 200);
	});
});

describe("a block moved on the phone (v2.1 part B: \"LockedIn will notify you then, and not before\")", () => {
	const block = { id: "blk1", date: "2026-11-24", start: "14:00", minutes: 50, status: "accepted" };
	const blockNudge = (fireMin: number) => nudge("block:blk1:2026-11-24", fireMin, { kind: "block", blockId: "blk1", title: "Tue 14:00 · your study block" });
	const move = (fireAt: string, id = "evt-move-0001") => [{ id, type: "plan_move", payload: { blockId: "blk1", date: "2026-11-25", start: "10:00", fireAt, title: "Wed 10:00 · your study block" } }];
	const rows = async (s: Awaited<ReturnType<typeof setup>>) => (await s.env.DB.prepare("SELECT id, fire_at, sent_at, payload FROM nudges WHERE pair_id = ? ORDER BY fire_at").bind(s.pairId).all<{ id: string; fire_at: string; sent_at: string | null; payload: string }>()).results;

	it("with the laptop closed, the notification moves to the new time and the week shows it there", async () => {
		const s = await setup();
		await s.call("PUT", `/v1/pairs/${s.pairId}/schedule`, s.laptopSecret, { version: 1, nudges: [blockNudge(30), nudge("other", 40)], blocks: [block, { id: "blk2", date: "2026-11-26", start: "09:00" }] });
		const fireAt = at(24 * 60).toISOString();
		assert.equal((await s.call("POST", `/v1/pairs/${s.pairId}/events`, s.phoneToken, move(fireAt))).status, 204);
		const moved = (await rows(s)).find((r) => r.id === "block:blk1:2026-11-24")!;
		assert.equal(moved.fire_at, fireAt);
		assert.equal(JSON.parse(moved.payload).title, "Wed 10:00 · your study block");
		assert.equal((await rows(s)).find((r) => r.id === "other")!.fire_at, at(40).toISOString(), "other notifications are untouched");
		// Nothing is sent at the old time; it is sent at the new one.
		assert.equal((await cron(s.env, at(31), async () => new Response(null, { status: 201 }))).sent, 0);
		const view = (await s.call("GET", `/v1/pairs/${s.pairId}/schedule`, s.phoneToken)).body;
		assert.deepEqual(view.blocks.map((b: { id: string; date: string; start: string; moved?: boolean }) => [b.id, b.date, b.start, b.moved ?? false]), [["blk1", "2026-11-25", "10:00", true], ["blk2", "2026-11-26", "09:00", false]]);
	});

	it("a block whose notification already came is announced again at the new time, once", async () => {
		const s = await setup();
		await s.call("PUT", `/v1/pairs/${s.pairId}/schedule`, s.laptopSecret, { version: 1, nudges: [blockNudge(1)], blocks: [block] });
		await cron(s.env, at(2), async () => new Response(null, { status: 201 }));
		const fireAt = at(24 * 60).toISOString();
		await s.call("POST", `/v1/pairs/${s.pairId}/events`, s.phoneToken, move(fireAt), at(3));
		await s.call("POST", `/v1/pairs/${s.pairId}/events`, s.phoneToken, move(fireAt), at(4));
		const all = await rows(s);
		assert.equal(all.length, 2);
		const again = all.find((r) => r.sent_at === null)!;
		assert.equal(again.fire_at, fireAt);
		assert.equal(JSON.parse(again.payload).blockId, "blk1");
	});

	it("a move with no usable time, or for a block the relay doesn't hold, changes nothing", async () => {
		const s = await setup();
		await s.call("PUT", `/v1/pairs/${s.pairId}/schedule`, s.laptopSecret, { version: 1, nudges: [blockNudge(30)], blocks: [block] });
		const before = JSON.stringify(await rows(s));
		for (const payload of [{ blockId: "blk1", date: "2026-11-25", start: "10:00", fireAt: "soon" }, { blockId: "nope", date: "2026-11-25", start: "10:00", fireAt: at(600).toISOString() }, { blockId: "blk1", date: "25 Nov", start: "10am", fireAt: at(600).toISOString() }]) {
			assert.equal((await s.call("POST", `/v1/pairs/${s.pairId}/events`, s.phoneToken, [{ id: crypto.randomUUID(), type: "plan_move", payload }])).status, 204);
		}
		assert.equal(JSON.stringify(await rows(s)), before);
		assert.equal((await s.call("GET", `/v1/pairs/${s.pairId}/schedule`, s.phoneToken)).body.blocks[0].start, "14:00");
	});
});

describe("the week changed on the phone (v2.1 part C): it holds with the laptop closed", () => {
	const blocks = [{ id: "blk1", date: "2026-11-24", start: "14:00", minutes: 50, status: "accepted" }, { id: "blk2", date: "2026-11-26", start: "09:00", minutes: 50, status: "proposed" }];
	const week = { lectures: [{ date: "2026-11-24", start: "11:00", title: "HCI" }], free: [{ date: "2026-11-25", start: "10:00" }], nudgesPerDay: 1, blockMinutes: 50 };
	const blockNudge = (id: string, fireMin: number) => nudge(`block:${id}:x`, fireMin, { kind: "block", blockId: id });
	async function withWeek() {
		const s = await setup();
		await s.call("PUT", `/v1/pairs/${s.pairId}/schedule`, s.laptopSecret, { version: 1, nudges: [blockNudge("blk1", 30), blockNudge("blk2", 60), nudge("q", 20)], blocks, week });
		const send = (type: string, payload: Record<string, unknown>, now = T0) => s.call("POST", `/v1/pairs/${s.pairId}/events`, s.phoneToken, [{ id: crypto.randomUUID(), type, payload }], now);
		const view = async () => (await s.call("GET", `/v1/pairs/${s.pairId}/schedule`, s.phoneToken)).body as { blocks: { id: string; date: string; start: string; status: string; moved?: boolean }[]; week?: typeof week };
		const due = async (min: number) => (await cron(s.env, at(min), async () => new Response(null, { status: 201 }))).sent;
		const sub = () => s.call("POST", `/v1/pairs/${s.pairId}/subscriptions`, s.phoneToken, { endpoint: "https://push.example/abc" });
		return { ...s, send, view, due, sub };
	}
	const vapid = async () => { const k = await generateVapidKeys("mailto:test@example.invalid"); return { VAPID_PUBLIC_KEY: k.publicKey, VAPID_PRIVATE_KEY: k.privateKey }; };

	it("the week travels with the blocks, and a schedule without one is read as before", async () => {
		const s = await withWeek();
		assert.deepEqual((await s.view()).week, week);
		assert.equal((await s.view()).blocks.length, 2);
		const old = await setup();
		await old.call("PUT", `/v1/pairs/${old.pairId}/schedule`, old.laptopSecret, { version: 1, nudges: [], blocks });
		const v = (await old.call("GET", `/v1/pairs/${old.pairId}/schedule`, old.phoneToken)).body;
		assert.equal(v.blocks.length, 2);
		assert.equal(v.week, undefined);
	});

	it("\"Remove\" takes the block and its notification away; \"Undo\" brings both back", async () => {
		const s = await withWeek();
		Object.assign(s.env, await vapid());
		await s.sub();
		await s.send("plan_remove", { blockId: "blk1" });
		assert.equal((await s.view()).blocks.find((b) => b.id === "blk1")?.status, "removed");
		assert.equal(await s.due(21), 1, "the lecture question is sent as usual");
		assert.equal(await s.due(31), 0, "a removed block does not buzz");
		await s.send("plan_tick", { blockId: "blk1", restore: true }, at(32));
		assert.equal((await s.view()).blocks.find((b) => b.id === "blk1")?.status, "accepted");
		assert.equal(await s.due(33), 1, "its notification is back, at its own time");
	});

	it("\"Looks good\" keeps a suggested block; \"Add a block\" puts a new one in the week with its own notification", async () => {
		const s = await withWeek();
		await s.send("plan_tick", { blockId: "blk2" });
		assert.equal((await s.view()).blocks.find((b) => b.id === "blk2")?.status, "accepted");
		const fireAt = at(24 * 60).toISOString();
		await s.send("plan_add", { blockId: "phone-abc12345", date: "2026-11-25", start: "10:00", minutes: 50, fireAt, title: "Wed 10:00 · your study block" });
		await s.send("plan_add", { blockId: "phone-abc12345", date: "2026-11-25", start: "10:00", minutes: 50, fireAt, title: "Wed 10:00 · your study block" });
		const v = await s.view();
		assert.deepEqual(v.blocks.filter((b) => b.id === "phone-abc12345").map((b) => [b.date, b.start, b.status, b.moved]), [["2026-11-25", "10:00", "accepted", true]]);
		assert.deepEqual(v.week?.free, [], "the time it took is no longer offered");
		const row = await s.env.DB.prepare("SELECT fire_at, payload FROM nudges WHERE pair_id = ? AND id = ?").bind(s.pairId, "block:phone-abc12345:2026-11-25").first<{ fire_at: string; payload: string }>();
		assert.equal(row?.fire_at, fireAt);
		assert.deepEqual([JSON.parse(row!.payload).kind, JSON.parse(row!.payload).blockId, JSON.parse(row!.payload).title], ["block", "phone-abc12345", "Wed 10:00 · your study block"]);
		// Nonsense is refused quietly.
		await s.send("plan_add", { blockId: "x", date: "tomorrow", start: "10:00", fireAt });
		assert.equal((await s.view()).blocks.length, 3);
	});

	it("nudges set to 0 on the phone stop every notification at once; back to 1, they come again", async () => {
		const s = await withWeek();
		Object.assign(s.env, await vapid());
		await s.sub();
		await s.send("prefs", { nudgesPerDay: 0 });
		assert.equal((await s.view()).week?.nudgesPerDay, 0);
		assert.equal(await s.due(21), 0);
		assert.equal(await s.due(31), 0);
		await s.send("prefs", { nudgesPerDay: 1 }, at(32));
		assert.equal(await s.due(33), 1, "what was due and has not run out is sent");
		await s.send("prefs", { nudgesPerDay: 7 });
		assert.equal((await s.view()).week?.nudgesPerDay, 1, "only 0, 1 or 2");
	});

	it("the laptop is told how much the week may hold", async () => {
		const s = await setup();
		const r = await s.call("PUT", `/v1/pairs/${s.pairId}/schedule`, s.laptopSecret, { version: 1, nudges: [], blocks });
		assert.deepEqual(r.body.limits, { nudgeChars: LIMITS.payloadChars, blocksChars: LIMITS.blocksChars });
		assert.equal(LIMITS.blocksChars, 200_000);
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
