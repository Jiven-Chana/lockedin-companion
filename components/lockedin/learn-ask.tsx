"use client";

/**
 * The first-time card (v2.0 step 6; V-52): "How do you like to learn this?",
 * asked once per module, before its first Learn session. One card, three
 * rows of taps and one optional line (AE2-P14: a short questionnaire felt
 * like sixty questions). Every row is optional; Skip, and from the second
 * module "Same as my other modules", are one tap. What is tapped becomes the
 * module's "how you learn it" note, which the student can see and change
 * (R-7, AE2-P16).
 */

import { useCallback, useState } from "react";
import { HOW_ROWS, NOTE_COPY, NOTE_RULES, type HowPrefs } from "@/src/core";
import { ApiError, lockedIn } from "./api";
import { MicButton, useMic } from "./mic";

export function LearnAsk({ sessionId, name, canCopy, onDone }: { sessionId: string; name: string; canCopy: boolean; onDone: () => void }) {
	const [prefs, setPrefs] = useState<HowPrefs>({});
	const [more, setMore] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const mic = useMic(useCallback((t: string) => setMore((m) => (m ? `${m.trimEnd()} ${t}` : t)), []), "learn-how");

	async function send(body: Parameters<typeof lockedIn.answerHow>[1]) {
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			await mic.dictation.finish().catch(() => undefined);
			await lockedIn.answerHow(sessionId, body);
			onDone();
		} catch (e) {
			setError(e instanceof ApiError ? e.message : "That didn't save");
			setBusy(false);
		}
	}
	const tap = (key: (typeof HOW_ROWS)[number]["key"], value: string) => setPrefs((p) => {
		const next = { ...p } as Record<string, string | undefined>;
		if (next[key] === value) delete next[key];
		else next[key] = value;
		return next as HowPrefs;
	});

	return (
		<form className="li-stack" style={{ gap: 18 }} onSubmit={(e) => { e.preventDefault(); void send({ ...prefs, ...(more.trim() ? { more: more.trim() } : {}) }); }}>
			<div className="li-stack" style={{ gap: 4 }}>
				<h2 className="li-q-stem" style={{ fontSize: "1.45em" }}>{NOTE_COPY.askTitle(name)}</h2>
				<span className="li-muted">{NOTE_COPY.askOnce}</span>
			</div>
			{HOW_ROWS.map((row) => (
				<div key={row.key} className="li-stack" style={{ gap: 8 }}>
					<b id={`how-${row.key}`}>{row.label}</b>
					<div role="radiogroup" aria-labelledby={`how-${row.key}`} className="li-row" style={{ flexWrap: "wrap", gap: 8 }}>
						{row.options.map((o) => (
							<button key={o.value} type="button" role="radio" aria-checked={prefs[row.key] === o.value} className="li-opt" style={{ width: "auto", minHeight: 48, padding: "8px 18px" }} onClick={() => tap(row.key, o.value)}>{o.label}</button>
						))}
					</div>
				</div>
			))}
			<div className="li-row" style={{ gap: 8, alignItems: "flex-end" }}>
				<input className="li-input" value={more} maxLength={NOTE_RULES.moreMax} onChange={(e) => setMore(e.target.value)} placeholder={NOTE_COPY.more} aria-label="Anything else" />
				<MicButton mic={mic} />
			</div>
			{error ? <div className="li-note" role="alert">{error}</div> : null}
			<div className="li-row" style={{ gap: 12 }}>
				{canCopy ? <button type="button" className="li-btn ghost" disabled={busy} onClick={() => void send({ same: true })}>{NOTE_COPY.same}</button> : null}
				<button type="button" className="li-btn ghost" style={{ marginLeft: "auto" }} disabled={busy} onClick={() => void send({ skip: true })}>{NOTE_COPY.skip}</button>
				<button type="submit" className="li-btn primary big" disabled={busy}>{NOTE_COPY.start}</button>
			</div>
		</form>
	);
}
