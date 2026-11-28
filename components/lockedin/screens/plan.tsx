"use client";

/**
 * The week (v0.1 F-110, F-111, J5′): lectures, commitments and study blocks
 * for Mon–Sun. On a wide screen it is a timetable whose study blocks can be
 * dragged (v1.1, V-37); on a narrow one, a list per day.
 * Proposals are ticked, moved or removed in one action each.
 * The weekly target lives here, with "Plan my week" and the setup chat.
 * On Sunday (or from the N-5 nudge) the check-in comes first. Nothing is
 * ever called missed (R-6).
 */

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { PLACEMENT_COPY, PLAN_COPY } from "@/src/core";
import { ApiError, lockedIn, type CheckinData, type PlanData } from "../api";
import { fmtTime, useData } from "../hooks";
import { Icon } from "../icons";
import { Tint, useLockedIn } from "../root";
import { PageHead } from "../shell";
import { WeekGrid } from "../week-grid";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const TARGETS = [60, 120, 180, 240, 300, 360, 480, 600];
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDaysIso = (date: string, n: number) => {
	const d = new Date(`${date}T12:00:00`);
	d.setDate(d.getDate() + n);
	return iso(d);
};

function BlockCard({ b, order, modules = [], onDone }: { b: PlanData["blocks"][number]; order: number; modules?: PlanData["modules"]; onDone: () => void }) {
	const [moving, setMoving] = useState(false);
	const [date, setDate] = useState(b.date);
	const [start, setStart] = useState(b.start);
	const [err, setErr] = useState<string | null>(null);
	const router = useRouter();
	const act = async (patch: Parameters<typeof lockedIn.updateBlock>[1]) => {
		try {
			await lockedIn.updateBlock(b.id, patch);
			setMoving(false);
			onDone();
		} catch (e) {
			setErr(e instanceof ApiError ? e.message : "Couldn't do that");
		}
	};
	const proposed = b.status === "proposed";
	const startNow = async (study?: "learn" | "practise") => {
		try {
			const { sessionId } = await lockedIn.startBlock(b.id, study);
			if (sessionId) router.push(`/app/session/${sessionId}`);
			else onDone();
		} catch (e) {
			setErr(e instanceof ApiError ? e.message : "Couldn't start that block");
		}
	};
	return (
		<Tint module={b.module}>
			<div className="li-block" data-status={b.status} style={{ "--i": order } as React.CSSProperties}>
				<span className="li-small"><b>{b.start}</b> · {b.minutes} min{b.status === "started" ? " · started ✓" : b.notStarted ? ` · ${PLAN_COPY.replan.notStarted}` : ""}{b.moved ? <> <span className="li-chip">{PLAN_COPY.replan.moved}</span></> : null}</span>
				<span className="li-small">{b.focus ? `${b.focus.module}: ${b.focus.title}` : b.module ? b.module : PLACEMENT_COPY.freeStudy}{b.reason === "gap" ? " · catch-up" : ""}</span>
				{b.firstStep ? <span className="li-small">{b.firstStep}</span> : null}
				{/* The block's module (V-37): changing it makes the block study that module's next unit. */}
				{modules.length && b.status !== "started" ? (
					<label className="li-row li-small" style={{ gap: 6 }}>
						Module
						<select className="li-input" style={{ width: "auto", minHeight: 30, padding: "2px 8px" }} value={b.module ?? ""} onChange={(e) => act({ module: e.target.value || null })}>
							<option value="">{PLACEMENT_COPY.freeStudy}</option>
							{modules.map((m) => <option key={m.code} value={m.code}>{m.name}{m.hasMaterial ? "" : " (no material yet)"}</option>)}
						</select>
					</label>
				) : null}
				{moving ? (
					<span className="li-row" style={{ gap: 6, flexWrap: "wrap" }}>
						<input className="li-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Day" style={{ width: "auto" }} />
						<input className="li-input" type="time" value={start} onChange={(e) => setStart(e.target.value)} aria-label="Start" style={{ width: "auto" }} />
						<button type="button" className="li-btn primary" onClick={() => act({ date, start })}>Move</button>
						<button type="button" className="li-btn" onClick={() => setMoving(false)}>Cancel</button>
					</span>
				) : b.status !== "started" ? (
					<span className="li-row" style={{ gap: 6 }}>
						{/* A block is started on its own day (V-44). */}
						{/* The block suggests one mode and offers the other (step 5; AFF-N: the mode is your choice each visit). */}
						{b.canStart ? <button type="button" className="li-btn primary" onClick={() => void startNow(b.mode?.study)} aria-label={`Start ${b.start} block: ${b.mode?.label ?? PLAN_COPY.start}`}>{b.mode?.label ?? PLAN_COPY.start}</button> : null}
						{b.canStart && b.mode?.other ? <button type="button" className="li-btn" onClick={() => void startNow(b.mode!.other!.study)}>{b.mode.other.label}</button> : null}
						{proposed && !b.canStart ? <button type="button" className="li-btn primary" onClick={() => act({ status: "accepted" })} aria-label={`Keep ${b.start} block`}>✓ Keep</button> : null}
						<button type="button" className="li-btn" onClick={() => setMoving(true)}>Move</button>
						<button type="button" className="li-btn ghost" onClick={() => act({ status: "removed" })} aria-label={`Remove ${b.start} block`}>✕</button>
					</span>
				) : null}
				{err ? <span className="li-small" role="alert">{err}</span> : null}
			</div>
		</Tint>
	);
}

function CheckIn({ onDone }: { onDone: (week: string) => void }) {
	const data = useData(() => lockedIn.checkin().catch(() => null as CheckinData | null));
	const [proposal, setProposal] = useState<{ proposed: number; current: number; ask: string | null; keepLabel: string } | null>(null);
	const [busy, setBusy] = useState(false);
	const c = data.data;
	if (!c) return null;
	if (!c.target) return <div className="li-card">Set a weekly target below first, then the check-in can suggest changes to it.</div>;
	const feel = async (feeling: string) => {
		setBusy(true);
		const r = await lockedIn.answerCheckin({ feeling });
		setProposal({ proposed: r.proposed!, current: r.current!, ask: r.ask ?? null, keepLabel: r.keepLabel ?? "Keep" });
		setBusy(false);
	};
	const finish = async (body: { target: number } | { keep: true }) => {
		setBusy(true);
		await lockedIn.answerCheckin(body);
		onDone(c.nextWeek);
	};
	return (
		<section className="li-card li-stack" style={{ gap: 12 }} aria-labelledby="checkin-h">
			<h2 id="checkin-h" className="li-h2">Your week</h2>
			<p style={{ margin: 0 }}>{c.text}</p>
			{!proposal ? (
				<div className="li-row" style={{ gap: 8 }}>
					{Object.entries(c.feelings).map(([k, label]) => <button key={k} type="button" className="li-btn" disabled={busy} onClick={() => feel(k)}>{label}</button>)}
				</div>
			) : proposal.ask ? (
				<div className="li-row" style={{ gap: 8 }}>
					<b style={{ flexGrow: 1 }}>{proposal.ask}</b>
					<button type="button" className="li-btn primary" disabled={busy} onClick={() => finish({ target: proposal.proposed })}>{PLAN_COPY.yes}</button>
					<button type="button" className="li-btn" disabled={busy} onClick={() => finish({ keep: true })}>{proposal.keepLabel}</button>
				</div>
			) : (
				<div className="li-row" style={{ gap: 8 }}>
					<b style={{ flexGrow: 1 }}>Same again next week.</b>
					<button type="button" className="li-btn primary" disabled={busy} onClick={() => finish({ keep: true })}>Plan next week</button>
				</div>
			)}
		</section>
	);
}

export function PlanScreen() {
	const router = useRouter();
	const params = useSearchParams();
	const { now } = useLockedIn();
	const [week, setWeek] = useState<string | undefined>(params.get("week") ?? undefined);
	const [msg, setMsg] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [selected, setSelected] = useState<string | null>(null);
	const plan = useData(() => lockedIn.plan(week), [week]);
	const isSunday = now.getDay() === 0;
	const [showCheckin, setShowCheckin] = useState(params.get("checkin") === "1" || isSunday);
	const p = plan.data;

	async function propose() {
		setBusy(true);
		setMsg(null);
		try {
			const r = await lockedIn.proposePlan(p?.week);
			setMsg(r.message);
			void plan.reload();
		} catch (e) {
			setMsg(e instanceof ApiError ? e.message : "Couldn't plan the week");
		} finally {
			setBusy(false);
		}
	}
	/** "Re-plan the rest of my week" (v2.2) and its one Undo. Only ever on this button. */
	async function replan(undo = false) {
		setBusy(true);
		try {
			const r = undo ? await lockedIn.undoReplan() : await lockedIn.replanWeek();
			setMsg(r.message);
			void plan.reload();
		} catch (e) {
			setMsg(e instanceof ApiError ? e.message : "Couldn't re-plan the week");
		} finally {
			setBusy(false);
		}
	}
	async function setTarget(minutes: number) {
		await lockedIn.planSettings({ weeklyTargetMinutes: minutes });
		void plan.reload();
	}

	const days = p ? DAYS.map((name, i) => ({ name, date: addDaysIso(p.week, i) })) : [];
	const lecturesOn = (date: string) => (p?.lectures ?? []).filter((l) => l.start && iso(new Date(l.start)) === date);
	const blocksOn = (date: string) => (p?.blocks ?? []).filter((b) => b.date === date);
	const selectedBlock = p?.blocks.find((b) => b.id === selected) ?? null;
	const commitmentsOn = (date: string) => (p?.commitments ?? []).filter((c) => c.weekdays.includes(((new Date(`${date}T12:00:00`).getDay() + 6) % 7) + 1));
	const proposals = (p?.blocks ?? []).filter((b) => b.status === "proposed").length;

	return (
		<>
			{/* The whole week fits one screen (v3.0.1): the heading, the week and the target share a row, and the timetable takes the rest of the window. */}
			<span className="li-fit" hidden />
			<div className="li-row li-week-head">
				<PageHead eyebrow="Week" icon={<Icon.calendar />} title="Your study week" />
				<span style={{ flexGrow: 1 }} />
				<div className="li-row" style={{ gap: 14, alignItems: "center" }}>
					{/* The weekly target as blocks you can count: one per hour, mint for what is kept. */}
					<section className="li-card li-stack" style={{ gap: 6, padding: "8px 14px" }} aria-label="Weekly target">
						<span className="li-row" style={{ gap: 10, flexWrap: "nowrap" }}>
							<label className="li-row" style={{ gap: 8, flexWrap: "nowrap" }}>
								<b>Weekly target</b>
								<select className="li-input" style={{ width: "auto", minHeight: 34, padding: "2px 8px" }} value={p?.target ?? ""} onChange={(e) => void setTarget(Number(e.target.value))}>
									<option value="" disabled>Choose…</option>
									{[...new Set([...TARGETS, ...(p?.target ? [p.target] : [])])].sort((a, b) => a - b).map((m) => <option key={m} value={m}>{PLAN_COPY.hours(m)}</option>)}
								</select>
							</label>
							<b className="li-row" style={{ gap: 5, flexWrap: "nowrap" }}><Icon.check />{p ? `${PLAN_COPY.hours(p.committedMinutes)} kept` : ""}</b>
						</span>
						{p?.target ? (
							<span className="li-hours" role="img" aria-label={`${PLAN_COPY.hours(p.committedMinutes)} kept of ${PLAN_COPY.hours(p.target)}`}>
								{Array.from({ length: Math.ceil(p.target / 60) }, (_, i) => <i key={i}><span style={{ width: `${Math.max(0, Math.min(1, (p.committedMinutes - i * 60) / 60)) * 100}%` }} /></i>)}
							</span>
						) : null}
						{p?.proposedMinutes ? <span className="li-small li-muted">{PLAN_COPY.hours(p.proposedMinutes)} suggested</span> : null}
					</section>
					<button type="button" className="li-btn primary" disabled={busy || !p?.target} onClick={propose}>{busy ? "Planning…" : "Plan my week"}<Icon.arrow /></button>
				</div>
			</div>

			{showCheckin ? <CheckIn onDone={(w) => { setShowCheckin(false); setWeek(w); void plan.reload(); }} /> : null}

			<div className="li-row" style={{ gap: 10 }}>
				<span className="li-row" style={{ gap: 8, flexWrap: "nowrap", marginRight: 6 }}>
					<button type="button" className="li-btn ghost" onClick={() => setWeek(addDaysIso(p?.week ?? iso(now), -7))} aria-label="Previous week"><span style={{ display: "inline-flex", transform: "rotate(90deg)" }}><Icon.chevron /></span></button>
					<b style={{ whiteSpace: "nowrap" }}>{p ? `Week of ${new Date(`${p.week}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}` : "…"}</b>
					<button type="button" className="li-btn ghost" onClick={() => setWeek(addDaysIso(p?.week ?? iso(now), 7))} aria-label="Next week"><span style={{ display: "inline-flex", transform: "rotate(-90deg)" }}><Icon.chevron /></span></button>
				</span>
				{p?.replan.open ? <button type="button" className="li-btn" disabled={busy} onClick={() => void replan()}><Icon.ring />{PLAN_COPY.replan.button}</button> : null}
				{proposals ? <button type="button" className="li-btn" onClick={async () => { await lockedIn.acceptBlocks(p!.week); void plan.reload(); }}><Icon.check />Keep all {proposals}</button> : null}
				<Link className="li-btn ghost" href="/app/plan/chat"><Icon.say />Plan my week with me (2 min)</Link>
				{!showCheckin ? <button type="button" className="li-btn ghost" onClick={() => setShowCheckin(true)}>Check in</button> : null}
			</div>
			{msg || p?.replan.canUndo ? (
				<div className="li-note li-row" role="status" style={{ gap: 10, alignItems: "center" }}>
					<span style={{ flexGrow: 1 }}>{msg ?? PLAN_COPY.replan.still(p!.replan.moved)}</span>
					{p?.replan.canUndo ? <button type="button" className="li-btn" disabled={busy} onClick={() => void replan(true)}>{PLAN_COPY.replan.undo}</button> : null}
				</div>
			) : null}

			{/* Wide screens: a timetable to drag blocks around (V-37). Narrow ones keep the list below, where dragging has no room. */}
			{p ? (
				<div className="li-tt-wrap li-stack" style={{ gap: 10 }}>
					{/* Said before the timetable, not after it (v2.2, LF-10). */}
					<p className="li-row li-small" style={{ margin: 0, gap: 8 }}><Icon.move />{PLAN_COPY.dragHint}</p>
					<WeekGrid
						plan={p}
						today={iso(now)}
						selected={selected}
						onSelect={setSelected}
						onMove={async (id, to) => {
							try {
								await lockedIn.updateBlock(id, to);
								await plan.reload();
								return null;
							} catch (e) {
								return e instanceof ApiError ? e.message : "Couldn't move that block.";
							}
						}}
					/>
					{selectedBlock ? <div className="li-tt-options"><BlockCard key={`${selectedBlock.id}-${selectedBlock.status}-${selectedBlock.module}-${selectedBlock.start}-${selectedBlock.date}`} b={selectedBlock} order={0} modules={p.modules} onDone={() => void plan.reload()} /></div> : null}
				</div>
			) : null}
			<div className="li-week li-week-list" role="list" aria-label="This week">
				{days.map((d, di) => (
					<div key={d.date} className="li-day" role="listitem" data-today={d.date === iso(now) ? "true" : "false"}>
						<b>{d.name} <span className="li-muted li-small">{Number(d.date.slice(8))}</span></b>
						{[
							...lecturesOn(d.date).map((l) => ({ at: fmtTime(l.start!), key: l.id, node: <Tint key={l.id} module={l.module}><span className="li-event" data-kind={l.kind ?? "lecture"}>{fmtTime(l.start!)} {l.module} {l.title}</span></Tint> })),
							...commitmentsOn(d.date).map((c, i) => ({ at: c.start, key: `c${i}`, node: <span key={`c${i}`} className="li-event" data-kind="commitment">{c.start} {c.label}</span> })),
							...blocksOn(d.date).map((b) => ({ at: b.start, key: b.id, node: <BlockCard key={b.id} b={b} order={di} modules={p?.modules} onDone={() => void plan.reload()} /> })),
						]
							.sort((a, b) => a.at.localeCompare(b.at))
							.map((x) => x.node)}
					</div>
				))}
			</div>
			{p && !p.target ? <div className="li-card li-empty">Choose a weekly target, then &quot;Plan my week&quot;. Or <Link href="/app/plan/chat">plan it with me</Link> in about two minutes.</div> : null}
		</>
	);
}
