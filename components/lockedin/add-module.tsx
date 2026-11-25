"use client";

/**
 * "+ Add a module" (v2.0 step 7, V-64): a small button that opens one line
 * for the name. LockedIn makes the short code itself. Used in setup's
 * timetable and slides steps and at the top of the Library.
 */

import { useState } from "react";
import { SETUP_COPY, SETUP_RULES } from "@/src/core";
import { ApiError, lockedIn } from "./api";

export function AddModule({ onAdd, save = true }: { /** Called with the name (and the code, once saved). */ onAdd: (m: { name: string; code?: string }) => void; /** False where the profile doesn't exist yet (setup's timetable step keeps the name until Next). */ save?: boolean }) {
	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function add() {
		const n = name.trim();
		if (!n || busy) return;
		setError(null);
		try {
			if (save) {
				setBusy(true);
				onAdd(await lockedIn.addModule(n));
			} else {
				onAdd({ name: n });
			}
			setName("");
			setOpen(false);
		} catch (e) {
			setError(e instanceof ApiError ? e.message : "Couldn't add that. Try again.");
		} finally {
			setBusy(false);
		}
	}

	if (!open) return <button type="button" className="li-btn li-add" onClick={() => setOpen(true)}><span aria-hidden="true">+</span> {SETUP_COPY.timetable.add}</button>;
	return (
		<div className="li-stack" style={{ gap: 6 }}>
			<div className="li-row" style={{ gap: 8 }}>
				<input
					className="li-input"
					style={{ flex: "1 1 220px" }}
					autoFocus
					maxLength={SETUP_RULES.moduleNameMax}
					aria-label={SETUP_COPY.timetable.addPlaceholder}
					placeholder={SETUP_COPY.timetable.addPlaceholder}
					value={name}
					onChange={(e) => setName(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") void add();
						if (e.key === "Escape") setOpen(false);
					}}
				/>
				<button type="button" className="li-btn primary" onClick={() => void add()} disabled={!name.trim() || busy}>{SETUP_COPY.timetable.addButton}</button>
			</div>
			{error ? <span className="li-small" role="alert">{error}</span> : null}
		</div>
	);
}
