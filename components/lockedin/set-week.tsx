"use client";

/**
 * A course unit's week (v1.0 V-25; v3.1.1): the label is a button, on every
 * unit made from material, whether or not its week is already set. It opens
 * a first and a last week, so a unit can cover a range ("Weeks 7 to 9"), and
 * two units can be given the same week.
 */

import { useState } from "react";
import { WEEK_COPY, weekLabel } from "@/src/core";
import { ApiError, lockedIn } from "./api";

const WEEKS = Array.from({ length: 20 }, (_, i) => i + 1);

export function SetWeek({ lectureId, title, week = 0, weekTo, onSaved }: { lectureId: string; title: string; week?: number; weekTo?: number | undefined; onSaved: () => void }) {
	const [open, setOpen] = useState(false);
	const [from, setFrom] = useState(week || 1);
	const [to, setTo] = useState(Math.max(weekTo ?? week ?? 1, week || 1));
	const [error, setError] = useState<string | null>(null);
	const label = weekLabel(week, weekTo);
	if (!open) {
		return (
			<button type="button" className="li-chip li-week-chip" onClick={() => { setFrom(week || 1); setTo(Math.max(weekTo ?? week ?? 1, week || 1)); setOpen(true); }} aria-label={`${title}: ${label}. ${week > 0 ? WEEK_COPY.change : WEEK_COPY.set}`} title={week > 0 ? WEEK_COPY.change : WEEK_COPY.set}>
				{week > 0 ? label : WEEK_COPY.set}
			</button>
		);
	}
	async function save() {
		setError(null);
		try {
			await lockedIn.setUnitWeek(lectureId, from, Math.max(from, to));
			setOpen(false);
			onSaved();
		} catch (e) {
			setError(e instanceof ApiError ? e.message : "Couldn't save that");
		}
	}
	return (
		<span className="li-row li-week-edit" role="group" aria-label={`${WEEK_COPY.set} for ${title}`} style={{ gap: 6, flexWrap: "nowrap" }}>
			<label className="li-sr" htmlFor={`wf-${lectureId}`}>{WEEK_COPY.from}</label>
			<select id={`wf-${lectureId}`} className="li-input" style={{ width: "auto", minHeight: 36, padding: "2px 6px" }} autoFocus value={from} onChange={(e) => { const v = Number(e.target.value); setFrom(v); if (to < v) setTo(v); }}>
				{WEEKS.map((w) => <option key={w} value={w}>{WEEK_COPY.week(w)}</option>)}
			</select>
			<span className="li-small">to</span>
			<label className="li-sr" htmlFor={`wt-${lectureId}`}>{WEEK_COPY.to}</label>
			<select id={`wt-${lectureId}`} className="li-input" style={{ width: "auto", minHeight: 36, padding: "2px 6px" }} value={Math.max(from, to)} onChange={(e) => setTo(Number(e.target.value))}>
				{WEEKS.filter((w) => w >= from).map((w) => <option key={w} value={w}>{w}</option>)}
			</select>
			<button type="button" className="li-btn ghost" onClick={() => void save()}>{WEEK_COPY.save}</button>
			<button type="button" className="li-link li-small" onClick={() => setOpen(false)}>Cancel</button>
			{error ? <span className="li-small" role="alert">{error}</span> : null}
		</span>
	);
}
