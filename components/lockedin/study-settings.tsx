"use client";

/**
 * Me → Study blocks and Me → Routine (v0.1 F-119): the weekly target,
 * block length and Sunday check-in time (the same settings the Week page
 * and the check-in change), and the routine the planner works around,
 * with links to edit it or plan with the chat again. The focus screen
 * toggle arrives with F-113 (phase B).
 */

import Link from "next/link";
import { useState } from "react";
import { DEFAULT_PLAN, PLAN_COPY, type Profile } from "@/src/core";
import { ApiError, lockedIn } from "./api";

const TARGETS = [60, 120, 180, 240, 300, 360, 480, 600];
const LENGTHS = [25, 40, 50, 60, 75, 90];
const DAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const ENERGY: Record<string, string> = { morning: "mornings", afternoon: "afternoons", evening: "evenings" };

export function StudyBlocksSettings({ profile, onSaved }: { profile: Profile; onSaved: (msg: string) => void }) {
	const [plan, setPlan] = useState({ ...DEFAULT_PLAN, ...(profile.plan ?? {}) });
	const [err, setErr] = useState<string | null>(null);
	const save = async (patch: Partial<typeof plan>) => {
		setErr(null);
		setPlan((p) => ({ ...p, ...patch }));
		try {
			setPlan(await lockedIn.planSettings(patch));
			onSaved("Saved");
		} catch (e) {
			setErr(e instanceof ApiError ? e.message : "Couldn't save that");
		}
	};
	const target = plan.weeklyTargetMinutes;
	return (
		<div className="li-stack" style={{ gap: 12 }}>
			<div className="li-row" style={{ gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
				<label className="li-stack" style={{ gap: 6 }}>
					<b>Weekly target</b>
					<select className="li-input" style={{ width: "auto" }} value={target ?? ""} onChange={(e) => void save({ weeklyTargetMinutes: e.target.value ? Number(e.target.value) : null })}>
						<option value="">Not set</option>
						{[...new Set([...TARGETS, ...(target ? [target] : [])])].sort((a, b) => a - b).map((m) => <option key={m} value={m}>{PLAN_COPY.hours(m)}</option>)}
					</select>
				</label>
				<label className="li-stack" style={{ gap: 6 }}>
					<b>Block length</b>
					<select className="li-input" style={{ width: "auto" }} value={plan.blockMinutes} onChange={(e) => void save({ blockMinutes: Number(e.target.value) })}>
						{[...new Set([...LENGTHS, plan.blockMinutes])].sort((a, b) => a - b).map((m) => <option key={m} value={m}>{m} min</option>)}
					</select>
				</label>
				<label className="li-stack" style={{ gap: 6 }}>
					<b>Sunday check-in at</b>
					<input className="li-input" type="time" style={{ width: "auto" }} value={plan.sundayTime} onChange={(e) => { if (e.target.value) void save({ sundayTime: e.target.value }); }} />
				</label>
			</div>
			<span className="li-small li-muted">New blocks use these the next time you plan a week. Without a target there&apos;s no Sunday check-in.</span>
			{err ? <div className="li-note" role="alert">{err}</div> : null}
		</div>
	);
}

export function RoutineSettings({ profile }: { profile: Profile }) {
	const r = profile.routine;
	return (
		<div className="li-stack" style={{ gap: 12 }}>
			{r ? (
				<ul className="li-stack" style={{ gap: 4, margin: 0, paddingLeft: "1.2em" }}>
					<li>Best time to study: {r.energy.length ? r.energy.map((e) => ENERGY[e] ?? e).join(", ") : "no preference"}</li>
					<li>Other commitments: {r.commitments.length ? r.commitments.map((c) => `${c.label} (${c.weekdays.map((d) => DAY[d - 1]).join(", ")} ${c.start}–${c.end})`).join("; ") : "none"}</li>
					{r.places.length ? <li>Places: {r.places.join(", ")}</li> : null}
				</ul>
			) : (
				<span className="li-muted">No routine yet. The planner uses your timetable and free gaps only.</span>
			)}
			<div className="li-row" style={{ gap: 8 }}>
				<Link href="/app/plan/chat?edit=1" className="li-btn">{r ? "Edit my routine" : "Fill in my routine"}</Link>
				<Link href="/app/plan/chat" className="li-btn ghost">Plan my week with me again</Link>
			</div>
		</div>
	);
}
