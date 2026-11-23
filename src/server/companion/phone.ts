/**
 * The laptop's link to the phone (v0.1 F-112, spec §5): pair through the
 * relay, upload the week's nudges and blocks (on change, at least every
 * 30 minutes), pull the phone's events (every 60 s) and replay each exactly
 * once. The laptop only makes outbound HTTPS calls (§5.3). If the relay is
 * down, the laptop keeps working on its own (§5.2 item 6).
 */

import QRCode from "qrcode";
import { HANDOFF_COPY, PLAN_COPY } from "../../core/companion/policy.ts";
import { applyPlanEdits, eventsToReplay, nextVersion, scheduleFingerprint, type PhoneEvent, type PlanEdit, type RelaySchedule } from "../../core/companion/sync.ts";
import { FEELINGS, proposeTarget } from "../../core/companion/checkin.ts";
import type { ScheduledNudge } from "../../core/companion/nudges.ts";
import type { CompanionEventType, StudyBlock } from "../../core/companion/types.ts";
import { CompanionError } from "./errors.ts";
import type { CompanionService } from "./service.ts";
import type { CompanionStore } from "./store.ts";

export const PHONE_RULES = { uploadEveryMs: 30 * 60_000, pullEveryMs: 60_000, timeoutMs: 10_000, replayedMemory: 1_000 } as const;

export interface Pairing {
	pairId: string;
	laptopSecret: string;
	phoneToken: string;
}

/** The relay's HTTP API (Appendix B), laptop side. */
export class RelayClient {
	constructor(
		readonly baseUrl: string,
		private readonly fetchImpl: typeof fetch = fetch,
	) {}

	private async call<T>(method: string, path: string, secret?: string, body?: unknown): Promise<T> {
		const res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
			method,
			headers: { "content-type": "application/json", ...(secret ? { authorization: `Bearer ${secret}` } : {}) },
			...(body !== undefined ? { body: JSON.stringify(body) } : {}),
			signal: AbortSignal.timeout(PHONE_RULES.timeoutMs),
		});
		if (res.status === 204) return undefined as T;
		const data = (await res.json().catch(() => ({}))) as T & { error?: string };
		if (!res.ok) throw new CompanionError(res.status === 401 ? "relay_unpaired" : "relay_error", res.status === 401 ? 409 : 502, (data as { error?: string }).error ?? `relay ${res.status}`);
		return data;
	}
	pair = () => this.call<Pairing>("POST", "/v1/pairs");
	unpair = (p: Pairing) => this.call<void>("DELETE", `/v1/pairs/${p.pairId}`, p.laptopSecret);
	status = (p: Pairing) => this.call<{ phoneSeenAt: string | null; pushReady: boolean; scheduleVersion: number }>("GET", `/v1/pairs/${p.pairId}/status`, p.laptopSecret);
	putSchedule = (p: Pairing, s: RelaySchedule) => this.call<{ accepted: boolean; version: number }>("PUT", `/v1/pairs/${p.pairId}/schedule`, p.laptopSecret, s);
	events = (p: Pairing, after: number) => this.call<{ events: PhoneEvent[]; cursor: number }>("GET", `/v1/pairs/${p.pairId}/events?after=${after}`, p.laptopSecret);
	ack = (p: Pairing, cursor: number) => this.call<void>("POST", `/v1/pairs/${p.pairId}/events/ack`, p.laptopSecret, { cursor });
}

export class PhoneLink {
	private syncing: Promise<unknown> | null = null;

	constructor(
		private readonly svc: CompanionService,
		private readonly store: CompanionStore,
		private readonly relay: RelayClient,
	) {}

	private pairing(): Pairing | null {
		const r = this.store.runtime();
		return r.pairId && r.laptopSecret && r.phoneToken ? { pairId: r.pairId, laptopSecret: r.laptopSecret, phoneToken: r.phoneToken } : null;
	}

	paired(): boolean {
		return this.pairing() !== null;
	}

	private phoneUrl(p: Pairing) {
		return `${this.relay.baseUrl.replace(/\/$/, "")}/p#${p.pairId}.${p.phoneToken}`;
	}

	/** Pair (or show the existing pairing again): the link and its QR code (J9). */
	async pair() {
		let p = this.pairing();
		if (!p) {
			p = await this.relay.pair();
			this.store.saveRuntime({ pairId: p.pairId, laptopSecret: p.laptopSecret, phoneToken: p.phoneToken, eventCursor: 0, scheduleVersion: 0, scheduleFingerprint: undefined, scheduleUploadedAt: undefined, replayedPhoneEvents: [] });
			this.svc.log("phone_paired", { relay: new URL(this.relay.baseUrl).host });
			await this.sync({ force: true }).catch(() => undefined);
		}
		const url = this.phoneUrl(p);
		return { url, qrSvg: await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" }), ...(await this.status()) };
	}

	async status() {
		const p = this.pairing();
		if (!p) return { paired: false as const, relay: this.relay.baseUrl, holds: HANDOFF_COPY.relayHolds };
		const r = this.store.runtime();
		try {
			const s = await this.relay.status(p);
			return { paired: true as const, relay: this.relay.baseUrl, phoneSeenAt: s.phoneSeenAt, pushReady: s.pushReady, uploadedAt: r.scheduleUploadedAt ?? null, holds: HANDOFF_COPY.relayHolds, reachable: true };
		} catch (err) {
			if (err instanceof CompanionError && err.code === "relay_unpaired") {
				this.forget("the relay no longer knows this pair");
				return { paired: false as const, relay: this.relay.baseUrl, holds: HANDOFF_COPY.relayHolds };
			}
			return { paired: true as const, relay: this.relay.baseUrl, phoneSeenAt: null, pushReady: false, uploadedAt: r.scheduleUploadedAt ?? null, holds: HANDOFF_COPY.relayHolds, reachable: false };
		}
	}

	/** Unpair: delete everything for this pair on the relay, then forget it here. Also part of "Delete all my data". */
	async unpair() {
		const p = this.pairing();
		if (p) await this.relay.unpair(p).catch((err) => this.svc.log("relay_error", { where: "unpair", message: err instanceof Error ? err.message : String(err) }));
		this.forget("unpaired");
		return { paired: false };
	}

	private forget(reason: string) {
		this.store.saveRuntime({ pairId: undefined, laptopSecret: undefined, phoneToken: undefined, eventCursor: undefined, scheduleVersion: undefined, scheduleFingerprint: undefined, scheduleUploadedAt: undefined, replayedPhoneEvents: undefined });
		this.svc.log("phone_unpaired", { reason });
	}

	/** Called from the tick: upload when due, pull every minute. Never throws; never blocks the tick. */
	tick() {
		if (!this.pairing() || this.syncing) return;
		this.syncing = this.sync().catch(() => undefined).finally(() => (this.syncing = null));
	}

	/** Upload the week if it changed (or 30 minutes passed), then pull and replay the phone's events. */
	async sync(opts: { force?: boolean } = {}) {
		const p = this.pairing();
		if (!p) return { uploaded: false, replayed: 0 };
		let uploaded = false;
		let replayed = 0;
		try {
			uploaded = await this.upload(p, opts.force ?? false);
			const r = this.store.runtime();
			if (opts.force || !r.eventsPulledAt || Date.now() - Date.parse(r.eventsPulledAt) >= PHONE_RULES.pullEveryMs) replayed = await this.pull(p);
		} catch (err) {
			if (err instanceof CompanionError && err.code === "relay_unpaired") this.forget("the relay no longer knows this pair");
			else this.svc.log("relay_error", { where: "sync", message: err instanceof Error ? err.message : String(err) });
		}
		return { uploaded, replayed };
	}

	/** What the phone gets: the week's nudges (with the hand-off count and the check-in's answers worked out here) and blocks. */
	buildSchedule(): Omit<RelaySchedule, "version"> {
		const { nudges } = this.svc.schedule();
		const checkin = this.checkinPreview();
		const plan = this.svc.plan();
		const next = this.svc.plan(nextWeekOf(plan.week));
		return {
			timeZone: this.svc.timeZone(),
			nudges: nudges.map((n: ScheduledNudge) => ({
				...n,
				...(n.kind === "N-1" ? { more: HANDOFF_COPY.more() } : {}),
				...(n.kind === "N-5" && checkin ? { checkin } : {}),
			})),
			blocks: [...plan.blocks, ...next.blocks].map((b) => ({ id: b.id, date: b.date, start: b.start, minutes: b.minutes, status: b.status, focus: b.focus })),
		};
	}

	/** The check-in, answered on the phone: the proposed target for each feeling, so the phone needs no laptop at tap time. */
	private checkinPreview() {
		try {
			const c = this.svc.checkin({ quiet: true });
			if (!c.target) return null;
			const options = Object.fromEntries(FEELINGS.map((f) => [f, proposeTarget(c.target!, f, c.roomMinutes)]));
			return { text: c.text, current: c.target, options, ask: Object.fromEntries(FEELINGS.map((f) => [f, options[f] === c.target ? null : PLAN_COPY.targetProposal(options[f]!)])), keepLabel: PLAN_COPY.keepTarget(c.target) };
		} catch {
			return null;
		}
	}

	private async upload(p: Pairing, force: boolean): Promise<boolean> {
		const body = this.buildSchedule();
		const fp = scheduleFingerprint(body);
		const r = this.store.runtime();
		const stale = !r.scheduleUploadedAt || Date.now() - Date.parse(r.scheduleUploadedAt) >= PHONE_RULES.uploadEveryMs;
		if (!force && !stale && fp === r.scheduleFingerprint) return false;
		const version = nextVersion(r.scheduleVersion ?? 0, Date.now());
		const res = await this.relay.putSchedule(p, { version, ...body });
		this.store.saveRuntime({ scheduleVersion: Math.max(version, res.version), scheduleFingerprint: fp, scheduleUploadedAt: new Date().toISOString() });
		this.svc.log("schedule_uploaded", { version, nudges: body.nudges.length, blocks: body.blocks.length, accepted: res.accepted });
		return true;
	}

	private async pull(p: Pairing): Promise<number> {
		const r = this.store.runtime();
		const { events, cursor } = await this.relay.events(p, r.eventCursor ?? 0);
		const n = this.replay(events);
		if (cursor > (r.eventCursor ?? 0)) await this.relay.ack(p, cursor);
		this.store.saveRuntime({ eventCursor: cursor, eventsPulledAt: new Date().toISOString() });
		if (n) await this.upload(p, true).catch(() => undefined); // the cap and next nudges changed (§5.2)
		return n;
	}

	/**
	 * Replay phone events exactly once each, in order (§5.2 item 3): every one
	 * is logged under its own type with source "phone", then applied.
	 */
	replay(events: readonly PhoneEvent[]): number {
		const r = this.store.runtime();
		const replayed = new Set(r.replayedPhoneEvents ?? []);
		const todo = eventsToReplay(events, replayed);
		const planEdits: PlanEdit[] = [];
		for (const e of todo) {
			this.svc.log(e.type as CompanionEventType, { ...e.payload, source: "phone", phoneEventId: e.id, phoneAt: e.at });
			try {
				this.apply(e, planEdits);
			} catch (err) {
				this.svc.log("relay_error", { where: "replay", type: e.type, phoneEventId: e.id, message: err instanceof Error ? err.message : String(err) });
			}
			replayed.add(e.id);
		}
		if (planEdits.length) this.applyPlan(planEdits);
		this.store.saveRuntime({ replayedPhoneEvents: [...replayed].slice(-PHONE_RULES.replayedMemory) });
		return todo.length;
	}

	private apply(e: PhoneEvent, planEdits: PlanEdit[]) {
		const nudgeKey = typeof e.payload.nudgeId === "string" ? e.payload.nudgeId.replace(/:snooze$/, "") : undefined;
		const outcome = e.type === "dismissed" || e.type === "done_for_now" ? "dismissed" : e.type === "snoozed" ? "snoozed" : e.type === "opened" || e.type === "answered" || e.type === "handover" ? "opened" : null;
		if (nudgeKey && outcome) this.svc.phoneHandledNudge(nudgeKey, outcome, e.at);
		const p = e.payload as Record<string, unknown>;
		switch (e.type) {
			case "answered":
				if (typeof p.lectureId === "string" && typeof p.questionId === "string") this.svc.phoneAnswer({ lectureId: p.lectureId, questionId: p.questionId, choice: Number(p.choice), correct: p.correct === true, at: e.at });
				break;
			case "handover":
				if (typeof p.lectureId === "string") this.svc.startHandoff({ lectureId: p.lectureId, ...(typeof p.questionId === "string" ? { questionId: p.questionId, choice: Number(p.choice), correct: p.correct === true } : {}), at: e.at, phoneEventId: e.id });
				break;
			case "plan_tick":
			case "plan_remove":
			case "plan_move":
				if (typeof p.blockId === "string")
					planEdits.push({ blockId: p.blockId, at: e.at, change: e.type === "plan_tick" ? { status: "accepted" } : e.type === "plan_remove" ? { status: "removed" } : { ...(typeof p.date === "string" ? { date: p.date } : {}), ...(typeof p.start === "string" ? { start: p.start } : {}) } });
				break;
			case "checkin":
				if (typeof p.feeling === "string") this.svc.answerCheckin({ feeling: p.feeling });
				break;
			case "target_confirm":
				this.svc.answerCheckin(p.keep === true ? { keep: true } : { target: Number(p.target) });
				break;
		}
	}

	/** Phone plan edits: last write wins per block; edits to blocks the laptop removed are ignored and logged (§5.2 item 4). */
	private applyPlan(edits: PlanEdit[]) {
		const blocks = this.store.blocks();
		const laptopEdits = new Map<string, string>();
		for (const ev of this.store.events()) {
			if ((ev.type === "plan_accepted" || ev.type === "plan_moved" || ev.type === "plan_removed") && ev.data.source !== "phone" && typeof ev.data.blockId === "string") laptopEdits.set(ev.data.blockId, ev.wall);
		}
		const r = applyPlanEdits(blocks, edits, (id) => laptopEdits.get(id));
		this.store.saveBlocks(r.blocks as StudyBlock[]);
		for (const i of r.ignored) this.svc.log("relay_error", { where: "plan edit", blockId: i.blockId, reason: i.reason });
	}
}

function nextWeekOf(week: string): string {
	const d = new Date(`${week}T12:00:00`);
	d.setDate(d.getDate() + 7);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
