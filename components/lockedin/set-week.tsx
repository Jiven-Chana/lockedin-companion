"use client";

/**
 * "Set week" on a course unit whose material didn't say which week it
 * belongs to (v1.0 V-25): one tap opens the list, picking a week saves it.
 */

import { useState } from "react";
import { WEEK_COPY } from "@/src/core";
import { lockedIn } from "./api";

const WEEKS = Array.from({ length: 20 }, (_, i) => i + 1);

export function SetWeek({ lectureId, title, onSaved }: { lectureId: string; title: string; onSaved: () => void }) {
	const [open, setOpen] = useState(false);
	const [failed, setFailed] = useState(false);
	if (!open) return <button type="button" className="li-chip" onClick={() => setOpen(true)} aria-label={`${title}: ${WEEK_COPY.notSet}. ${WEEK_COPY.set}`}>{WEEK_COPY.set}</button>;
	return (
		<select
			className="li-input"
			style={{ width: "auto" }}
			autoFocus
			defaultValue=""
			aria-label={`${WEEK_COPY.set} for ${title}`}
			aria-invalid={failed}
			onBlur={() => setOpen(false)}
			onChange={async (e) => {
				const week = Number(e.target.value);
				if (!week) return;
				try {
					await lockedIn.setUnitWeek(lectureId, week);
					setOpen(false);
					onSaved();
				} catch {
					setFailed(true);
				}
			}}
		>
			<option value="" disabled>{WEEK_COPY.set}</option>
			{WEEKS.map((w) => <option key={w} value={w}>{WEEK_COPY.week(w)}</option>)}
		</select>
	);
}
