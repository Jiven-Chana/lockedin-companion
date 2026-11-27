/**
 * The laptop's link to the phone (v0.1 F-112, spec §5): pair through the
 * relay, upload the week's nudges and blocks (on change, at least every
 * 30 minutes), pull the phone's events (every 60 s) and replay each exactly
 * once. The laptop only makes outbound HTTPS calls (§5.3). If the relay is
 * down, the laptop keeps working on its own (§5.2 item 6).
 */

import QRCode from "qrcode";
import { HANDOFF_COPY, NUDGE_TEXT, PHONE_RULES, PHONE_TEST_COPY, PLAN_COPY } from "../../core/companion/policy.ts";
import { fitBlocks, fitNudge, fitPractise, type RoundRef } from "../../core/companion/phone-round.ts";
import { applyPlanEdits, eventsToReplay, nextVersion, scheduleFingerprint, type PhoneEvent, type PlanEdit, type RelaySchedule } from "../../core/companion/sync.ts";
import { FEELINGS, proposeTarget } from "../../core/companion/checkin.ts";
import type { ScheduledNudge } from "../../core/companion/nudges.ts";
import { addDays, dateKey } from "../../core/companion/time.ts";
import type { CompanionEventType, StudyBlock } from "../../core/companion/types.ts";
import { CompanionError } from "./errors.ts";
import type { CompanionService } from "./service.ts";
import type { CompanionStore } from "./store.ts";

export { PHONE_RULES } from "../../core/companion/policy.ts";

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
	putSchedule = (p: Pairing, s: RelaySchedule) => this.call<{ accepted: boolean; version: number; limits?: { nudgeChars?: number; blocksChars?: number } }>("PUT", `/v1/pairs/${p.pairId}/schedule`, p.laptopSecret, s);
	events = (p: Pairing, after: number) => this.call<{ events: PhoneEvent[]; cursor: number }>("GET", `/v1/pairs/${p.pairId}/events?after=${after}`, p.laptopSecret);
	ack = (p: Pairing, cursor: number) => this.call<void>("POST", `/v1/pairs/${p.pairId}/events/ack`, p.laptopSecret, { cursor });
	/** The 6-digit code a phone types to pair (v1.0.3): the current one while it lasts, a fresh one after. */
	code = (p: Pairing) => this.call<{ code: string; expiresAt: string }>("POST", `/v1/pairs/${p.pairId}/code`, p.laptopSecret);
}

/** What a phone event says about a round, cleaned: only well-formed { lectureId, questionId } entries. */
function roundRefs(raw: unknown[]): RoundRef[] {
	return raw.flatMap((r) => {
		const x = r as { lectureId?: unknown; questionId?: unknown } | null;
		return x && typeof x.lectureId === "string" && typeof x.questionId === "string" ? [{ lectureId: x.lectureId, questionId: x.questionId }] : [];
	});
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
		// The code an iPhone's Home Screen app asks for (it can't see a pairing the browser saved). Null when the relay can't be reached.
		const code = await this.relay.code(p).catch(() => null);
		// The phone app's address without the pairing: short enough to type when the camera won't scan.
		const address = `${new URL(this.relay.baseUrl).host}/p`;
		return { url, qrSvg: await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" }), code: code?.code ?? null, codeExpiresAt: code?.expiresAt ?? null, address, ...(await this.status()) };
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

	/**
	 * Facilitator (T4 in a lab): the relay sends on real time, but a demo plans
	 * on the demo clock, so this puts the next lecture question on the phone
	 * now. It has its own id (the relay sends each id once) and stays in every
	 * upload until it expires, so the next tick can't wipe it before the
	 * relay's minute job sends it.
	 */
	async sendNow() {
		const p = this.pairing();
		if (!p) throw new CompanionError("phone_not_paired", 409, "Pair a phone first (Me → Phone).");
		const { nudges } = this.svc.schedule();
		const n1 = nudges.find((n) => n.kind === "N-1" && n.question) ?? nudges.find((n) => n.kind === "N-1");
		if (!n1) throw new CompanionError("nothing_to_send", 409, "No lecture question to send: load Tayo, or add slides, first.");
		const now = Date.now();
		const nudge = {
			...n1,
			id: `${n1.id}:now-${now}`,
			fireAt: new Date(now).toISOString(),
			snoozeFireAt: new Date(now + PHONE_RULES.sendNowSnoozeMs).toISOString(),
			expiresAt: new Date(now + PHONE_RULES.sendNowExpiresMs).toISOString(),
			more: HANDOFF_COPY.more(),
		};
		this.store.saveRuntime({ phoneNowNudge: nudge });
		await this.upload(p, true);
		this.svc.log("phone_send_now", { nudgeId: nudge.id, lectureId: n1.lectureId ?? null, withQuestion: !!n1.question });
		return { nudgeId: nudge.id, title: n1.title, body: n1.body, arrivesWithinSeconds: 60 };
	}

	/**
	 * "Send a test question to my phone" (v1.0.4): one real question from the
	 * student's own study packs, on the relay now, so they can see the phone
	 * works without waiting for a lecture to end. It hands off like any
	 * question, and its id starts "test:", so it never counts as the day's nudge.
	 */
	async sendTest() {
		const p = this.pairing();
		if (!p) throw new CompanionError("phone_not_paired", 409, "Pair a phone first (Me → Phone).");
		const question = this.svc.testQuestion();
		if (!question) throw new CompanionError("nothing_to_send", 409, PHONE_TEST_COPY.nothing);
		const now = Date.now();
		const nudge = {
			id: `test:${now}`,
			kind: "N-1" as const,
			title: PHONE_TEST_COPY.title,
			body: question.stem,
			lectureId: question.lectureId,
			opens: "question" as const,
			question,
			fireAt: new Date(now).toISOString(),
			snoozeFireAt: new Date(now + PHONE_RULES.sendNowSnoozeMs).toISOString(),
			expiresAt: new Date(now + PHONE_RULES.sendNowExpiresMs).toISOString(),
			more: HANDOFF_COPY.more(),
		};
		const r = this.store.runtime();
		this.store.saveRuntime({ phoneNowNudge: nudge, phoneTestQuestions: [...(r.phoneTestQuestions ?? []), question.id].slice(-50) });
		await this.upload(p, true);
		this.svc.log("phone_test_sent", { nudgeId: nudge.id, lectureId: question.lectureId, questionId: question.id });
		return { nudgeId: nudge.id, title: nudge.title, body: nudge.body, arrivesWithinSeconds: 60 };
	}

	/** What the phone gets: the week's nudges (with the hand-off count and the check-in's answers worked out here) and blocks. */
	buildSchedule(): Omit<RelaySchedule, "version"> {
		const { nudges } = this.svc.schedule();
		const now = this.store.runtime().phoneNowNudge;
		const extra = now && Date.parse(now.expiresAt) > Date.now() ? [now as unknown as RelaySchedule["nudges"][number]] : [];
		const checkin = this.checkinPreview();
		const plan = this.svc.plan();
		const next = this.svc.plan(nextWeekOf(plan.week));
		const all = nudges.map((n: ScheduledNudge) => ({
			...n,
			...(n.kind === "N-1" ? { more: HANDOFF_COPY.more() } : {}),
			...(n.kind === "N-5" && checkin ? { checkin } : {}),
		})).concat(extra);
		// The rest of each question's round travels with it (v2.1, V-46). What was saved on the phone follows the own
		// question of the next notification to be sent, and only that one.
		const maxChars = this.store.runtime().relayNudgeChars ?? PHONE_RULES.nudgeCharsBefore21;
		const leadId = all.filter((n) => n.question).sort((a, b) => a.fireAt.localeCompare(b.fireAt))[0]?.id;
		const blockOf = (n: { id: string; kind: string }) => (n.kind === "block" ? (/(?:^|:)block:([^:]+):/.exec(n.id)?.[1] ?? null) : null);
		const byId = new Map(this.svc.blocks().map((b) => [b.id, b]));
		const withRounds = all.map((n) => {
			// A block's notification, in the lo-fi's words (v2.1 part B): its day and time, the unit and the first step.
			const block = byId.get(blockOf(n) ?? "");
			if (block) {
				const lines = this.svc.phoneBlock(block);
				const day = new Date(`${block.date}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short" });
				return { ...n, blockId: block.id, title: NUDGE_TEXT.blockTitle(day, block.start), body: NUDGE_TEXT.blockBody(lines.unit, lines.slide || lines.firstStep ? PLAN_COPY.firstStep(lines.slide) : null, block.minutes) };
			}
			if (!n.question) return n;
			const round = this.svc.phoneRound(n.question, n.id === leadId);
			const fitted = fitNudge({ ...n, round, more: round.length }, maxChars);
			return { ...fitted, more: fitted.round.length };
		});
		const newRelay = this.store.runtime().relayNudgeChars !== undefined;
		const week = newRelay ? this.svc.phoneWeek() : null;
		// A block that is near carries its questions for "On the move" (v2.2 part C): today's, and tomorrow's.
		const nearUntil = dateKey(addDays(this.svc.now(), PHONE_RULES.blockRoundDaysAhead));
		const today = dateKey(this.svc.now());
		// A relay from before v2.1 has a smaller limit on blocks: it gets them as they always were.
		const blocks: RelaySchedule["blocks"] = [...plan.blocks, ...next.blocks].map((b) => {
			const base = { id: b.id, date: b.date, start: b.start, minutes: b.minutes, status: b.status, focus: b.focus };
			const stored = byId.get(b.id);
			if (!stored || !newRelay) return base;
			const { unit: _unit, slide: _slide, ...lines } = this.svc.phoneBlock(stored);
			const round = stored.status !== "removed" && b.date >= today && b.date <= nearUntil ? this.svc.phoneBlockRound(stored) : [];
			return { ...base, ...lines, ...(round.length > 0 ? { round } : {}) };
		});
		const maxWeek = this.store.runtime().relayBlocksChars ?? PHONE_RULES.blocksChars;
		const fitted = fitBlocks(blocks, week ? JSON.stringify(week).length + PHONE_RULES.blocksSlackChars : 0, maxWeek);
		// "Practise" on the phone's home screen (v2.3 part B): a pool per module, in whatever room the blocks and the week leave.
		const practise = newRelay ? fitPractise(this.svc.phonePractise(), JSON.stringify(fitted).length + (week ? JSON.stringify(week).length : 0) + PHONE_RULES.blocksSlackChars, maxWeek) : [];
		return {
			timeZone: this.svc.timeZone(),
			// The week beside the blocks (v2.1 part C), for a relay that knows what to do with it.
			...(week ? { week } : {}),
			...(practise.length > 0 ? { practise } : {}),
			nudges: withRounds,
			blocks: fitted,
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
		const relayNudgeChars = res.limits?.nudgeChars;
		const relayBlocksChars = res.limits?.blocksChars;
		this.store.saveRuntime({ scheduleVersion: Math.max(version, res.version), scheduleFingerprint: fp, scheduleUploadedAt: new Date().toISOString(), ...(typeof relayNudgeChars === "number" ? { relayNudgeChars } : {}), ...(typeof relayBlocksChars === "number" ? { relayBlocksChars } : {}) });
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
				if (typeof p.lectureId === "string" && typeof p.questionId === "string") {
					this.svc.phoneAnswer({ lectureId: p.lectureId, questionId: p.questionId, choice: Number(p.choice), correct: p.correct === true, at: e.at });
					// Answered on the phone ("Carry on", "Keep going here"): no longer waiting.
					this.svc.phoneSaved({ remove: [p.questionId] });
				}
				break;
			case "done_for_now":
				// "Done for now" and "Save the rest for later" (v2.1, V-46): the rest of the round waits.
				if (Array.isArray(p.saved)) this.svc.phoneSaved({ add: roundRefs(p.saved) });
				break;
			case "handover":
				// "Open on my laptop" from a block (v2.1 part B).
				if (typeof p.blockId === "string") this.svc.openBlockFromPhone(p.blockId, e.id);
				else if (typeof p.lectureId === "string") {
					const answers = Array.isArray(p.answers)
						? (p.answers as Record<string, unknown>[]).filter((a) => a && typeof a.questionId === "string").map((a) => ({ questionId: a.questionId as string, choice: Number(a.choice), correct: a.correct === true }))
						: [];
					this.svc.startHandoff({
						lectureId: p.lectureId,
						...(typeof p.questionId === "string" ? { questionId: p.questionId, choice: Number(p.choice), correct: p.correct === true } : {}),
						...(Array.isArray(p.round) ? { round: roundRefs(p.round), answers } : {}),
						at: e.at,
						phoneEventId: e.id,
					});
				}
				break;
			case "plan_add":
				// "Add a block" on the phone (v2.1 part C).
				this.svc.addBlockFromPhone({ blockId: p.blockId, date: p.date, start: p.start, minutes: p.minutes });
				break;
			case "prefs":
				// "Nudges per day" set on the phone (v2.1 part C; lo-fi Settings).
				if (p.nudgesPerDay === 0 || p.nudgesPerDay === 1 || p.nudgesPerDay === 2) this.svc.updateProfile({ prefs: { nudgesPerDay: p.nudgesPerDay } });
				break;
			case "focus_start":
				// "Take the first step" on the phone (v2.1 part B) starts the block.
				if (typeof p.blockId === "string") this.svc.phoneStartedBlock(p.blockId);
				break;
			case "plan_tick":
			case "plan_remove":
			case "plan_move":
				if (typeof p.blockId === "string")
					planEdits.push({ blockId: p.blockId, at: e.at, change: e.type === "plan_tick" ? { status: "accepted" } : e.type === "plan_remove" ? { status: "removed" } : { ...(typeof p.date === "string" ? { date: p.date } : {}), ...(typeof p.start === "string" ? { start: p.start } : {}) }, ...(e.type === "plan_tick" && p.restore === true ? { restore: true } : {}) });
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
