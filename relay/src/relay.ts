/**
 * The LockedIn relay (v0.1 F-112, spec §5 and Appendix B). It holds the
 * next week of nudges the laptop prepared, wakes the phone when one is due,
 * and keeps the phone's events in an append-only log the laptop replays.
 * Single writer per kind of data: the laptop writes the schedule, the
 * phone writes events; neither edits the other's (§5.2).
 *
 * It holds lecture names and times, question payloads, phone events, push
 * endpoints and study-block times. Never location, slides, notes or AI
 * keys (§5.3). Tokens are 128-bit random and stored only as hashes.
 */

import type { Db } from "./db.ts";
import { sendPush, type VapidKeys } from "./push.ts";

export interface RelayEnv {
	DB: Db;
	VAPID_PUBLIC_KEY?: string;
	VAPID_PRIVATE_KEY?: string;
	VAPID_SUBJECT?: string;
	/** Static assets: the phone app (web/). */
	ASSETS?: { fetch(req: Request): Promise<Response> };
}

export const LIMITS = {
	nudges: 300,
	payloadChars: 4_000,
	eventsPerPost: 50,
	eventPayloadChars: 2_000,
	blocksChars: 20_000,
	/** New pairs per minute, across the relay (a cheap rate limit with no per-IP state). */
	pairsPerMinute: 30,
	eventsPage: 200,
	/** Acknowledged events are deleted this long after the laptop acknowledged them (§5.3). */
	ackedRetentionDays: 7,
} as const;

/** Event types the phone may append (spec §5.2). */
export const PHONE_EVENT_TYPES = [
	"opened", "answered", "handover", "done_for_now", "snoozed", "dismissed",
	"plan_tick", "plan_move", "plan_remove", "checkin", "target_confirm", "focus_start", "focus_end",
] as const;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const noContent = () => new Response(null, { status: 204 });
const fail = (status: number, error: string) => json({ error }, status);

function token(): string {
	const b = crypto.getRandomValues(new Uint8Array(16));
	return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
async function hash(s: string): Promise<string> {
	const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
	return Array.from(d, (x) => x.toString(16).padStart(2, "0")).join("");
}
const bearer = (req: Request) => /^Bearer ([0-9a-f]{32})$/i.exec(req.headers.get("authorization") ?? "")?.[1] ?? null;

type Who = "laptop" | "phone";

async function authorise(env: RelayEnv, req: Request, pairId: string, allowed: Who[]): Promise<Who | null> {
	const t = bearer(req);
	if (!t) return null;
	const row = await env.DB.prepare("SELECT laptop_hash, phone_hash FROM pairs WHERE id = ?").bind(pairId).first<{ laptop_hash: string; phone_hash: string }>();
	if (!row) return null;
	const h = await hash(t);
	if (allowed.includes("laptop") && h === row.laptop_hash) return "laptop";
	if (allowed.includes("phone") && h === row.phone_hash) return "phone";
	return null;
}

async function readJson(req: Request, maxChars: number): Promise<unknown> {
	const text = await req.text();
	if (text.length > maxChars) throw new Error("too large");
	return text ? JSON.parse(text) : {};
}

interface ScheduledNudgeIn { id: string; fireAt: string; expiresAt: string; snoozeFireAt?: string; [k: string]: unknown }

/** Route one HTTP request. */
export async function handle(req: Request, env: RelayEnv, now = new Date()): Promise<Response> {
	const url = new URL(req.url);
	const path = url.pathname;
	try {
		if (path === "/v1/vapid" && req.method === "GET") return json({ publicKey: env.VAPID_PUBLIC_KEY ?? null });

		if (path === "/v1/pairs" && req.method === "POST") {
			const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM pairs WHERE created_at > ?").bind(new Date(now.getTime() - 60_000).toISOString()).first<{ n: number }>();
			if ((recent?.n ?? 0) >= LIMITS.pairsPerMinute) return fail(429, "too many pairings; try again in a minute");
			const pairId = token();
			const laptopSecret = token();
			const phoneToken = token();
			await env.DB.prepare("INSERT INTO pairs (id, laptop_hash, phone_hash, created_at) VALUES (?, ?, ?, ?)").bind(pairId, await hash(laptopSecret), await hash(phoneToken), now.toISOString()).run();
			return json({ pairId, laptopSecret, phoneToken }, 201);
		}

		const m = /^\/v1\/pairs\/([0-9a-f]{32})(\/.*)?$/.exec(path);
		if (m) {
			const pairId = m[1]!;
			const rest = m[2] ?? "";

			if (rest === "" && req.method === "DELETE") {
				if (!(await authorise(env, req, pairId, ["laptop", "phone"]))) return fail(401, "unauthorised");
				await env.DB.batch(["DELETE FROM nudges WHERE pair_id = ?", "DELETE FROM events WHERE pair_id = ?", "DELETE FROM subscriptions WHERE pair_id = ?", "DELETE FROM pairs WHERE id = ?"].map((s) => env.DB.prepare(s).bind(pairId)));
				return noContent();
			}

			if (rest === "/status" && req.method === "GET") {
				if (!(await authorise(env, req, pairId, ["laptop"]))) return fail(401, "unauthorised");
				const p = await env.DB.prepare("SELECT phone_seen_at, schedule_version FROM pairs WHERE id = ?").bind(pairId).first<{ phone_seen_at: string | null; schedule_version: number }>();
				const subs = await env.DB.prepare("SELECT COUNT(*) AS n FROM subscriptions WHERE pair_id = ?").bind(pairId).first<{ n: number }>();
				return json({ phoneSeenAt: p?.phone_seen_at ?? null, pushReady: (subs?.n ?? 0) > 0, scheduleVersion: p?.schedule_version ?? 0 });
			}

			if (rest === "/schedule" && req.method === "PUT") {
				if (!(await authorise(env, req, pairId, ["laptop"]))) return fail(401, "unauthorised");
				const body = (await readJson(req, LIMITS.nudges * LIMITS.payloadChars + LIMITS.blocksChars)) as { version?: unknown; timeZone?: unknown; nudges?: unknown; blocks?: unknown };
				if (!Number.isInteger(body.version)) return fail(400, "version is required");
				const nudges = Array.isArray(body.nudges) ? (body.nudges as ScheduledNudgeIn[]) : [];
				if (nudges.length > LIMITS.nudges) return fail(400, "too many nudges");
				for (const n of nudges) {
					if (typeof n?.id !== "string" || !n.id || Number.isNaN(Date.parse(n.fireAt)) || Number.isNaN(Date.parse(n.expiresAt))) return fail(400, "each nudge needs id, fireAt and expiresAt");
					if (JSON.stringify(n).length > LIMITS.payloadChars) return fail(400, "a nudge is too large");
				}
				const blocks = JSON.stringify(Array.isArray(body.blocks) ? body.blocks : []);
				if (blocks.length > LIMITS.blocksChars) return fail(400, "too many blocks");
				// Versions only go up (§5.2): a stale or repeated upload changes nothing.
				const cur = await env.DB.prepare("SELECT schedule_version FROM pairs WHERE id = ?").bind(pairId).first<{ schedule_version: number }>();
				if ((body.version as number) <= (cur?.schedule_version ?? 0)) return json({ accepted: false, version: cur?.schedule_version ?? 0 });
				const sent = new Map(
					(await env.DB.prepare("SELECT id, sent_at FROM nudges WHERE pair_id = ? AND sent_at IS NOT NULL").bind(pairId).all<{ id: string; sent_at: string }>()).results.map((r) => [r.id, r.sent_at]),
				);
				const stmts = [
					env.DB.prepare("UPDATE pairs SET schedule_version = ?, time_zone = ?, blocks = ? WHERE id = ?").bind(body.version, typeof body.timeZone === "string" ? body.timeZone : null, blocks, pairId),
					env.DB.prepare("DELETE FROM nudges WHERE pair_id = ? AND sent_at IS NULL").bind(pairId),
					...nudges.map((n) =>
						env.DB.prepare("INSERT OR REPLACE INTO nudges (pair_id, id, fire_at, expires_at, payload, sent_at) VALUES (?, ?, ?, ?, ?, ?)").bind(pairId, n.id, new Date(n.fireAt).toISOString(), new Date(n.expiresAt).toISOString(), JSON.stringify(n), sent.get(n.id) ?? null),
					),
				];
				await env.DB.batch(stmts);
				return json({ accepted: true, version: body.version });
			}

			if (rest === "/schedule" && req.method === "GET") {
				if (!(await authorise(env, req, pairId, ["phone"]))) return fail(401, "unauthorised");
				await env.DB.prepare("UPDATE pairs SET phone_seen_at = ? WHERE id = ?").bind(now.toISOString(), pairId).run();
				const p = await env.DB.prepare("SELECT time_zone, blocks FROM pairs WHERE id = ?").bind(pairId).first<{ time_zone: string | null; blocks: string }>();
				const rows = (await env.DB.prepare("SELECT payload, sent_at FROM nudges WHERE pair_id = ? AND expires_at > ? ORDER BY fire_at").bind(pairId, now.toISOString()).all<{ payload: string; sent_at: string | null }>()).results;
				return json({ now: now.toISOString(), timeZone: p?.time_zone ?? null, blocks: JSON.parse(p?.blocks ?? "[]"), nudges: rows.map((r) => ({ ...JSON.parse(r.payload), sentAt: r.sent_at })) });
			}

			if (rest === "/subscriptions" && req.method === "POST") {
				if (!(await authorise(env, req, pairId, ["phone"]))) return fail(401, "unauthorised");
				const body = (await readJson(req, 4_000)) as { endpoint?: unknown };
				if (typeof body.endpoint !== "string" || !body.endpoint.startsWith("https://")) return fail(400, "a push subscription endpoint is required");
				await env.DB.prepare("INSERT OR REPLACE INTO subscriptions (pair_id, endpoint, created_at) VALUES (?, ?, ?)").bind(pairId, body.endpoint, now.toISOString()).run();
				await env.DB.prepare("UPDATE pairs SET phone_seen_at = ? WHERE id = ?").bind(now.toISOString(), pairId).run();
				return noContent();
			}

			if (rest === "/events" && req.method === "POST") {
				if (!(await authorise(env, req, pairId, ["phone"]))) return fail(401, "unauthorised");
				const body = await readJson(req, LIMITS.eventsPerPost * (LIMITS.eventPayloadChars + 500));
				const list = (Array.isArray(body) ? body : [body]) as { id?: unknown; at?: unknown; type?: unknown; nudgeId?: unknown; payload?: unknown }[];
				if (list.length > LIMITS.eventsPerPost) return fail(400, "too many events");
				const stmts = [];
				for (const e of list) {
					if (typeof e.id !== "string" || !/^[\w-]{8,64}$/.test(e.id)) return fail(400, "each event needs an id");
					if (typeof e.type !== "string" || !(PHONE_EVENT_TYPES as readonly string[]).includes(e.type)) return fail(400, `unknown event type ${String(e.type)}`);
					const payload = JSON.stringify({ ...(e.payload && typeof e.payload === "object" ? e.payload : {}), ...(typeof e.nudgeId === "string" ? { nudgeId: e.nudgeId } : {}) });
					if (payload.length > LIMITS.eventPayloadChars) return fail(400, "event too large");
					const at = typeof e.at === "string" && !Number.isNaN(Date.parse(e.at)) ? new Date(e.at).toISOString() : now.toISOString();
					// Idempotent by id: a retried post from an offline phone changes nothing.
					stmts.push(env.DB.prepare("INSERT OR IGNORE INTO events (pair_id, id, at, type, payload, received_at) VALUES (?, ?, ?, ?, ?, ?)").bind(pairId, e.id, at, e.type, payload, now.toISOString()));
					// "Later" on the phone fires the snooze time the laptop planned and counted (§5.2 item 2).
					if (e.type === "snoozed" && typeof e.nudgeId === "string") {
						const n = await env.DB.prepare("SELECT payload FROM nudges WHERE pair_id = ? AND id = ?").bind(pairId, e.nudgeId).first<{ payload: string }>();
						const p = n ? (JSON.parse(n.payload) as ScheduledNudgeIn) : null;
						if (p?.snoozeFireAt && !Number.isNaN(Date.parse(p.snoozeFireAt))) {
							const fireAt = new Date(p.snoozeFireAt);
							const snoozed = { ...p, id: `${p.id}:snooze`, fireAt: fireAt.toISOString(), expiresAt: new Date(fireAt.getTime() + 2 * 3_600_000).toISOString(), snoozeFireAt: undefined };
							stmts.push(env.DB.prepare("INSERT OR IGNORE INTO nudges (pair_id, id, fire_at, expires_at, payload) VALUES (?, ?, ?, ?, ?)").bind(pairId, snoozed.id, snoozed.fireAt, snoozed.expiresAt, JSON.stringify(snoozed)));
						}
					}
				}
				if (stmts.length) await env.DB.batch(stmts);
				return noContent();
			}

			if (rest === "/events" && req.method === "GET") {
				if (!(await authorise(env, req, pairId, ["laptop"]))) return fail(401, "unauthorised");
				const after = Number(url.searchParams.get("after") ?? 0) || 0;
				const rows = (await env.DB.prepare("SELECT seq, id, at, type, payload FROM events WHERE pair_id = ? AND seq > ? ORDER BY seq LIMIT ?").bind(pairId, after, LIMITS.eventsPage).all<{ seq: number; id: string; at: string; type: string; payload: string }>()).results;
				return json({ events: rows.map((r) => ({ id: r.id, at: r.at, type: r.type, payload: JSON.parse(r.payload) })), cursor: rows.at(-1)?.seq ?? after });
			}

			if (rest === "/events/ack" && req.method === "POST") {
				if (!(await authorise(env, req, pairId, ["laptop"]))) return fail(401, "unauthorised");
				const body = (await readJson(req, 200)) as { cursor?: unknown };
				if (!Number.isInteger(body.cursor)) return fail(400, "cursor is required");
				await env.DB.prepare("UPDATE events SET acked_at = ? WHERE pair_id = ? AND seq <= ? AND acked_at IS NULL").bind(now.toISOString(), pairId, body.cursor).run();
				return noContent();
			}
			return fail(404, "not found");
		}

		// The phone app (/p, /p#<pairId>.<token>) and its files.
		if (env.ASSETS && req.method === "GET") {
			if (path === "/" || path === "/p" || path === "/p/") return env.ASSETS.fetch(new Request(new URL("/index.html", url), req));
			return env.ASSETS.fetch(req);
		}
		return fail(404, "not found");
	} catch (err) {
		if (err instanceof SyntaxError) return fail(400, "invalid JSON");
		if (err instanceof Error && err.message === "too large") return fail(413, "too large");
		console.error("[relay]", err);
		return fail(500, "relay error");
	}
}

/** Every minute (Cron Trigger): wake phones for due nudges, then clean up (§5.3 retention). */
export async function cron(env: RelayEnv, now = new Date(), fetchImpl: typeof fetch = fetch): Promise<{ sent: number; gone: number }> {
	const iso = now.toISOString();
	const due = (await env.DB.prepare("SELECT pair_id, id FROM nudges WHERE sent_at IS NULL AND fire_at <= ? AND expires_at > ?").bind(iso, iso).all<{ pair_id: string; id: string }>()).results;
	let sent = 0;
	let gone = 0;
	const keys: VapidKeys | null = env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY ? { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT ?? "mailto:lockedin@example.invalid" } : null;
	for (const pairId of new Set(due.map((d) => d.pair_id))) {
		const subs = (await env.DB.prepare("SELECT endpoint FROM subscriptions WHERE pair_id = ?").bind(pairId).all<{ endpoint: string }>()).results;
		// One wake per pair per minute, however many are due: the phone shows every due nudge it fetches.
		if (keys)
			for (const s of subs) {
				const r = await sendPush(s.endpoint, keys, fetchImpl);
				if (r === "sent") sent++;
				if (r === "gone") {
					gone++;
					await env.DB.prepare("DELETE FROM subscriptions WHERE pair_id = ? AND endpoint = ?").bind(pairId, s.endpoint).run();
				}
			}
		await env.DB.prepare("UPDATE nudges SET sent_at = ? WHERE pair_id = ? AND sent_at IS NULL AND fire_at <= ?").bind(iso, pairId, iso).run();
	}
	await env.DB.prepare("DELETE FROM nudges WHERE expires_at <= ?").bind(iso).run();
	await env.DB.prepare("DELETE FROM events WHERE acked_at IS NOT NULL AND acked_at <= ?").bind(new Date(now.getTime() - LIMITS.ackedRetentionDays * 86_400_000).toISOString()).run();
	return { sent, gone };
}
