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
	/** One notification, with its question and the rest of its round (v2.1; 4,000 before). The laptop is told this limit when it uploads. */
	payloadChars: 12_000,
	eventsPerPost: 50,
	eventPayloadChars: 2_000,
	/** The week: the blocks with what the phone shows for each, the lectures between them and the free times (v2.1; 20,000 before). */
	blocksChars: 60_000,
	/** New pairs per minute, across the relay (a cheap rate limit with no per-IP state). */
	pairsPerMinute: 30,
	eventsPage: 200,
	/** Acknowledged events are deleted this long after the laptop acknowledged them (§5.3). */
	ackedRetentionDays: 7,
	/** A pairing code lasts this long (v1.0.3). */
	codeMinutes: 10,
	/** Wrong codes per minute, across the relay, before every claim waits. With a handful of live codes among a million, guessing is not worth it. */
	claimFailuresPerMinute: 20,
} as const;

/** Event types the phone may append (spec §5.2). */
export const PHONE_EVENT_TYPES = [
	"opened", "answered", "handover", "done_for_now", "snoozed", "dismissed",
	"plan_tick", "plan_move", "plan_remove", "checkin", "target_confirm", "focus_start", "focus_end",
	// v2.1 part C: a block added on the phone, and the nudges-per-day setting.
	"plan_add", "prefs",
] as const;

/** What the relay tells the laptop it accepts, with every answer to an upload. */
const limits = () => ({ nudgeChars: LIMITS.payloadChars, blocksChars: LIMITS.blocksChars });

/** What a pair's `blocks` column holds: the blocks, and since v2.1 the rest of the week beside them. */
interface Plan {
	blocks: Record<string, unknown>[];
	week?: Record<string, unknown>;
}
function readPlan(text: string | null | undefined): Plan {
	let v: unknown;
	try {
		v = JSON.parse(text || "[]");
	} catch {
		v = [];
	}
	if (Array.isArray(v)) return { blocks: v as Record<string, unknown>[] };
	const o = (v ?? {}) as { blocks?: unknown; week?: unknown };
	return { blocks: Array.isArray(o.blocks) ? (o.blocks as Record<string, unknown>[]) : [], ...(o.week && typeof o.week === "object" ? { week: o.week as Record<string, unknown> } : {}) };
}
const writePlan = (p: Plan) => JSON.stringify(p.week ? p : p.blocks);
/** A notification that must not fire while its block is removed: its real time stays in its payload, for "Undo". */
const PARKED = "9999-12-31T00:00:00.000Z";

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

		// The phone types the 6-digit code shown on the laptop (v1.0.3). The code names a pair; claiming it
		// gives this phone a token of its own and retires the pair's previous phone token: a pair has one phone.
		if (path === "/v1/claim" && req.method === "POST") {
			const body = (await readJson(req, 200)) as { code?: unknown };
			const code = typeof body.code === "string" ? body.code.replace(/\s+/g, "") : typeof body.code === "number" ? String(body.code) : "";
			if (!/^\d{6}$/.test(code)) return fail(400, "the code is 6 digits");
			const iso = now.toISOString();
			const failures = await env.DB.prepare("SELECT COUNT(*) AS n FROM claim_failures WHERE at > ?").bind(new Date(now.getTime() - 60_000).toISOString()).first<{ n: number }>();
			if ((failures?.n ?? 0) >= LIMITS.claimFailuresPerMinute) return fail(429, "too_many_tries");
			const row = await env.DB.prepare("SELECT pair_id, expires_at FROM pair_codes WHERE code = ?").bind(code).first<{ pair_id: string; expires_at: string }>();
			if (!row || row.expires_at <= iso) {
				await env.DB.prepare("INSERT INTO claim_failures (at) VALUES (?)").bind(iso).run();
				if (row) await env.DB.prepare("DELETE FROM pair_codes WHERE code = ?").bind(code).run();
				return row ? fail(410, "expired_code") : fail(404, "wrong_code");
			}
			const phoneToken = token();
			await env.DB.batch([
				env.DB.prepare("UPDATE pairs SET phone_hash = ?, phone_seen_at = ? WHERE id = ?").bind(await hash(phoneToken), iso, row.pair_id),
				env.DB.prepare("DELETE FROM pair_codes WHERE pair_id = ?").bind(row.pair_id),
				// The previous phone's notifications stop with its token.
				env.DB.prepare("DELETE FROM subscriptions WHERE pair_id = ?").bind(row.pair_id),
			]);
			return json({ pairId: row.pair_id, token: phoneToken });
		}

		const m = /^\/v1\/pairs\/([0-9a-f]{32})(\/.*)?$/.exec(path);
		if (m) {
			const pairId = m[1]!;
			const rest = m[2] ?? "";

			// The code the laptop shows for this pair: the current one while it lasts, a fresh one after.
			if (rest === "/code" && req.method === "POST") {
				if (!(await authorise(env, req, pairId, ["laptop"]))) return fail(401, "unauthorised");
				const iso = now.toISOString();
				const current = await env.DB.prepare("SELECT code, expires_at FROM pair_codes WHERE pair_id = ? AND expires_at > ?").bind(pairId, iso).first<{ code: string; expires_at: string }>();
				if (current) return json({ code: current.code, expiresAt: current.expires_at });
				await env.DB.prepare("DELETE FROM pair_codes WHERE pair_id = ? OR expires_at <= ?").bind(pairId, iso).run();
				const expiresAt = new Date(now.getTime() + LIMITS.codeMinutes * 60_000).toISOString();
				for (let attempt = 0; attempt < 8; attempt++) {
					const code = String(crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000).padStart(6, "0");
					const taken = await env.DB.prepare("SELECT 1 AS x FROM pair_codes WHERE code = ?").bind(code).first<{ x: number }>();
					if (taken) continue;
					await env.DB.prepare("INSERT INTO pair_codes (code, pair_id, expires_at) VALUES (?, ?, ?)").bind(code, pairId, expiresAt).run();
					return json({ code, expiresAt });
				}
				return fail(503, "no code free; try again");
			}

			if (rest === "" && req.method === "DELETE") {
				if (!(await authorise(env, req, pairId, ["laptop", "phone"]))) return fail(401, "unauthorised");
				await env.DB.batch(["DELETE FROM nudges WHERE pair_id = ?", "DELETE FROM events WHERE pair_id = ?", "DELETE FROM subscriptions WHERE pair_id = ?", "DELETE FROM pair_codes WHERE pair_id = ?", "DELETE FROM pairs WHERE id = ?"].map((s) => env.DB.prepare(s).bind(pairId)));
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
				const body = (await readJson(req, LIMITS.nudges * LIMITS.payloadChars + LIMITS.blocksChars)) as { version?: unknown; timeZone?: unknown; nudges?: unknown; blocks?: unknown; week?: unknown };
				if (!Number.isInteger(body.version)) return fail(400, "version is required");
				const nudges = Array.isArray(body.nudges) ? (body.nudges as ScheduledNudgeIn[]) : [];
				if (nudges.length > LIMITS.nudges) return fail(400, "too many nudges");
				for (const n of nudges) {
					if (typeof n?.id !== "string" || !n.id || Number.isNaN(Date.parse(n.fireAt)) || Number.isNaN(Date.parse(n.expiresAt))) return fail(400, "each nudge needs id, fireAt and expiresAt");
					if (JSON.stringify(n).length > LIMITS.payloadChars) return fail(400, "a nudge is too large");
				}
				const blocks = writePlan({ blocks: Array.isArray(body.blocks) ? (body.blocks as Record<string, unknown>[]) : [], ...(body.week && typeof body.week === "object" ? { week: body.week as Record<string, unknown> } : {}) });
				if (blocks.length > LIMITS.blocksChars) return fail(400, "too many blocks");
				// Versions only go up (§5.2): a stale or repeated upload changes nothing.
				const cur = await env.DB.prepare("SELECT schedule_version FROM pairs WHERE id = ?").bind(pairId).first<{ schedule_version: number }>();
				if ((body.version as number) <= (cur?.schedule_version ?? 0)) return json({ accepted: false, version: cur?.schedule_version ?? 0, limits: limits() });
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
				return json({ accepted: true, version: body.version, limits: limits() });
			}

			if (rest === "/schedule" && req.method === "GET") {
				if (!(await authorise(env, req, pairId, ["phone"]))) return fail(401, "unauthorised");
				await env.DB.prepare("UPDATE pairs SET phone_seen_at = ? WHERE id = ?").bind(now.toISOString(), pairId).run();
				const p = await env.DB.prepare("SELECT time_zone, blocks FROM pairs WHERE id = ?").bind(pairId).first<{ time_zone: string | null; blocks: string }>();
				const rows = (await env.DB.prepare("SELECT payload, sent_at FROM nudges WHERE pair_id = ? AND expires_at > ? ORDER BY fire_at").bind(pairId, now.toISOString()).all<{ payload: string; sent_at: string | null }>()).results;
				const plan = readPlan(p?.blocks);
				return json({ now: now.toISOString(), timeZone: p?.time_zone ?? null, blocks: plan.blocks, ...(plan.week ? { week: plan.week } : {}), nudges: rows.map((r) => ({ ...JSON.parse(r.payload), sentAt: r.sent_at })) });
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
				// The week as the phone changes it (v2.1): read once, changed in memory, written once.
				let week: WeekEdits | null = null;
				for (const e of list) {
					if (typeof e.id !== "string" || !/^[\w-]{8,64}$/.test(e.id)) return fail(400, "each event needs an id");
					if (typeof e.type !== "string" || !(PHONE_EVENT_TYPES as readonly string[]).includes(e.type)) return fail(400, `unknown event type ${String(e.type)}`);
					const payload = JSON.stringify({ ...(e.payload && typeof e.payload === "object" ? e.payload : {}), ...(typeof e.nudgeId === "string" ? { nudgeId: e.nudgeId } : {}) });
					if (payload.length > LIMITS.eventPayloadChars) return fail(400, "event too large");
					const at = typeof e.at === "string" && !Number.isNaN(Date.parse(e.at)) ? new Date(e.at).toISOString() : now.toISOString();
					// Idempotent by id: a retried post from an offline phone changes nothing.
					stmts.push(env.DB.prepare("INSERT OR IGNORE INTO events (pair_id, id, at, type, payload, received_at) VALUES (?, ?, ?, ?, ?, ?)").bind(pairId, e.id, at, e.type, payload, now.toISOString()));
					// The week changed on the phone (v2.1 parts B and C): it holds here at once, laptop open or not.
					if (WEEK_EVENTS.includes(e.type)) {
						week ??= await loadWeek(env, pairId);
						editWeek(week, env, pairId, e.type, (e.payload && typeof e.payload === "object" ? e.payload : {}) as Record<string, unknown>, now);
					}
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
				if (week?.dirty) stmts.push(env.DB.prepare("UPDATE pairs SET blocks = ? WHERE id = ?").bind(writePlan(week.plan), pairId));
				if (week) stmts.push(...week.stmts);
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
			// Cloudflare's asset server serves index.html at "/" (and redirects "/index.html" there).
			if (path === "/p" || path === "/p/") return env.ASSETS.fetch(new Request(new URL("/", url), req));
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
const WEEK_EVENTS: readonly string[] = ["plan_move", "plan_remove", "plan_tick", "plan_add", "prefs"];
type BlockNudge = ScheduledNudgeIn & { blockId?: string };
interface WeekEdits {
	plan: Plan;
	nudges: { id: string; n: BlockNudge; sent: boolean }[];
	stmts: ReturnType<Db["prepare"]>[];
	dirty: boolean;
}

async function loadWeek(env: RelayEnv, pairId: string): Promise<WeekEdits> {
	const pair = await env.DB.prepare("SELECT blocks FROM pairs WHERE id = ?").bind(pairId).first<{ blocks: string }>();
	const rows = (await env.DB.prepare("SELECT id, payload, sent_at FROM nudges WHERE pair_id = ?").bind(pairId).all<{ id: string; payload: string; sent_at: string | null }>()).results;
	return { plan: readPlan(pair?.blocks), nudges: rows.map((r) => ({ id: r.id, n: JSON.parse(r.payload) as BlockNudge, sent: r.sent_at !== null })), stmts: [], dirty: false };
}

const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isTime = (v: unknown): v is string => typeof v === "string" && /^\d{2}:\d{2}$/.test(v);
const isMoment = (v: unknown): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v));

/**
 * One change to the week made on the phone, applied to what the relay holds
 * so it is true at once: "LockedIn will nudge you then, and not before"
 * (lo-fi task 2) must not wait for the laptop to open. The laptop's next
 * upload replaces all of it with its own plan, which by then has the same
 * change in it. Anything malformed changes nothing.
 */
function editWeek(w: WeekEdits, env: RelayEnv, pairId: string, type: string, p: Record<string, unknown>, now: Date) {
	if (type === "prefs") {
		// Nudges per day: 0 stops every notification here and now (see cron).
		if (p.nudgesPerDay === 0 || p.nudgesPerDay === 1 || p.nudgesPerDay === 2) {
			w.plan.week = { ...(w.plan.week ?? {}), nudgesPerDay: p.nudgesPerDay };
			w.dirty = true;
		}
		return;
	}
	const blockId = p.blockId;
	if (typeof blockId !== "string") return;
	const block = w.plan.blocks.find((b) => b.id === blockId);
	const mine = w.nudges.filter((r) => r.n.blockId === blockId);
	const setFire = (id: string, fireAt: string) => w.stmts.push(env.DB.prepare("UPDATE nudges SET fire_at = ? WHERE pair_id = ? AND id = ? AND sent_at IS NULL").bind(fireAt, pairId, id));
	const update = (change: Record<string, unknown>) => {
		w.plan.blocks = w.plan.blocks.map((b) => (b.id === blockId ? { ...b, ...change } : b));
		w.dirty = true;
	};
	const takeFree = (date: string, start: string) => {
		const free = w.plan.week?.free;
		if (Array.isArray(free)) w.plan.week = { ...w.plan.week, free: free.filter((f) => !(f && (f as { date?: unknown }).date === date && (f as { start?: unknown }).start === start)) };
	};

	if (type === "plan_add") {
		// "Add a block": a new block, with a notification of its own until the laptop plans it properly.
		const { date, start, fireAt, title } = p;
		if (block || !/^[\w-]{6,40}$/.test(blockId) || !isDate(date) || !isTime(start) || !isMoment(fireAt)) return;
		const minutes = typeof p.minutes === "number" && Number.isInteger(p.minutes) && p.minutes >= 10 && p.minutes <= 180 ? p.minutes : 50;
		w.plan.blocks = [...w.plan.blocks, { id: blockId, date, start, minutes, status: "accepted", focus: null, moved: true }];
		takeFree(date, start);
		w.dirty = true;
		const at = new Date(fireAt);
		if (at > now) {
			const n = { id: `block:${blockId}:${date}`, kind: "block", blockId, title: typeof title === "string" ? title.slice(0, 120) : "LockedIn", body: `${minutes} minutes, at your own pace.`, opens: "session", fireAt: at.toISOString(), snoozeFireAt: at.toISOString(), expiresAt: new Date(at.getTime() + 2 * 3_600_000).toISOString() };
			w.stmts.push(env.DB.prepare("INSERT OR IGNORE INTO nudges (pair_id, id, fire_at, expires_at, payload) VALUES (?, ?, ?, ?, ?)").bind(pairId, n.id, n.fireAt, n.expiresAt, JSON.stringify(n)));
			w.nudges.push({ id: n.id, n: n as BlockNudge, sent: false });
		}
		return;
	}
	if (!block) return;

	if (type === "plan_remove") {
		update({ status: "removed" });
		for (const r of mine) if (!r.sent) setFire(r.id, PARKED);
	} else if (type === "plan_tick") {
		// "Looks good" keeps a suggestion; with `restore` it is "Undo" after "Remove".
		update({ status: "accepted" });
		if (p.restore === true) for (const r of mine) if (!r.sent) setFire(r.id, new Date(r.n.fireAt).toISOString());
	} else if (type === "plan_move") {
		const { date, start, fireAt, title } = p;
		if (!isDate(date) || !isTime(start) || !isMoment(fireAt)) return;
		const at = new Date(fireAt);
		update({ date, start, moved: true });
		takeFree(date, start);
		const retimed = (n: BlockNudge, id: string): BlockNudge => ({ ...n, id, fireAt: at.toISOString(), expiresAt: new Date(at.getTime() + 2 * 3_600_000).toISOString(), ...(typeof title === "string" ? { title: title.slice(0, 120) } : {}) });
		const waiting = mine.filter((r) => !r.sent);
		for (const r of waiting) {
			r.n = retimed(r.n, r.id);
			w.stmts.push(env.DB.prepare("UPDATE nudges SET fire_at = ?, expires_at = ?, payload = ? WHERE pair_id = ? AND id = ?").bind(r.n.fireAt, r.n.expiresAt, JSON.stringify(r.n), pairId, r.id));
		}
		// Its notification already came (the student is looking at it): it is announced once more at the new time.
		if (waiting.length === 0 && mine.length > 0 && at > now) {
			const first = mine[0]!;
			const n = retimed(first.n, `${first.id.replace(/:moved$/, "")}:moved`);
			w.stmts.push(env.DB.prepare("INSERT OR IGNORE INTO nudges (pair_id, id, fire_at, expires_at, payload) VALUES (?, ?, ?, ?, ?)").bind(pairId, n.id, n.fireAt, n.expiresAt, JSON.stringify(n)));
			w.nudges.push({ id: n.id, n, sent: false });
		}
	}
}

export async function cron(env: RelayEnv, now = new Date(), fetchImpl: typeof fetch = fetch): Promise<{ sent: number; gone: number }> {
	const iso = now.toISOString();
	const due = (await env.DB.prepare("SELECT pair_id, id FROM nudges WHERE sent_at IS NULL AND fire_at <= ? AND expires_at > ?").bind(iso, iso).all<{ pair_id: string; id: string }>()).results;
	let sent = 0;
	let gone = 0;
	const keys: VapidKeys | null = env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY ? { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT ?? "mailto:lockedin@example.invalid" } : null;
	for (const pairId of new Set(due.map((d) => d.pair_id))) {
		// Nudges per day set to 0 (v2.1 part C): nothing is sent. What is due stays unsent and simply runs out.
		const pair = await env.DB.prepare("SELECT blocks FROM pairs WHERE id = ?").bind(pairId).first<{ blocks: string }>();
		if (readPlan(pair?.blocks).week?.nudgesPerDay === 0) continue;
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
	await env.DB.prepare("DELETE FROM pair_codes WHERE expires_at <= ?").bind(iso).run();
	await env.DB.prepare("DELETE FROM claim_failures WHERE at <= ?").bind(new Date(now.getTime() - 3_600_000).toISOString()).run();
	await env.DB.prepare("DELETE FROM events WHERE acked_at IS NOT NULL AND acked_at <= ?").bind(new Date(now.getTime() - LIMITS.ackedRetentionDays * 86_400_000).toISOString()).run();
	return { sent, gone };
}
