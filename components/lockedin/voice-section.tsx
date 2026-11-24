"use client";

/**
 * Me → Voice (v0.1 F-116, O-5): the student's own Deepgram key turns on
 * the Speak button in the session's "why" box. Optional; nothing needs it.
 */

import { useState } from "react";
import { ApiError, lockedIn } from "./api";
import { useData } from "./hooks";
import { resetVoiceAvailable } from "./mic";

export function VoiceSection() {
	const status = useData(() => lockedIn.ai.status());
	const [key, setKey] = useState("");
	const [busy, setBusy] = useState(false);
	const [msg, setMsg] = useState<string | null>(null);
	const voice = !!status.data?.voice;

	const save = async (value: string | null) => {
		setBusy(true);
		setMsg(null);
		try {
			const s = await lockedIn.ai.voice(value);
			resetVoiceAvailable(!!s.voice);
			setKey("");
			setMsg(s.voice ? "✓ Saved. Sessions now show a Speak button under “Why?”." : "Removed. The Speak button is hidden.");
			void status.reload();
		} catch (e) {
			setMsg(e instanceof ApiError ? e.message : "Couldn't save the key. Try again.");
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="li-stack" style={{ gap: 12 }}>
			<span className="li-muted">Optional. Say your reason instead of typing it. Tapping an answer is always enough.</span>
			{voice ? (
				<div className="li-row" style={{ gap: 12, alignItems: "center" }}>
					<span>✓ Dictation is on (your Deepgram key).</span>
					<button type="button" className="li-btn ghost" disabled={busy} onClick={() => save(null)}>Remove key</button>
				</div>
			) : (
				<form className="li-stack" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); if (key.trim()) void save(key); }}>
					<label className="li-stack" style={{ gap: 6 }}>
						<b>Deepgram key</b>
						<input className="li-input" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste your key" style={{ maxWidth: 420 }} />
					</label>
					<span className="li-small li-muted">
						Make one at <a href="https://console.deepgram.com" target="_blank" rel="noreferrer">console.deepgram.com</a> → API Keys → Create a key, with <b>Member</b> permission (a read-only key can&apos;t start dictation). Your voice goes from this laptop straight to Deepgram; LockedIn keeps only the words that land in the box.
					</span>
					<button type="submit" className="li-btn primary" style={{ alignSelf: "flex-start" }} disabled={busy || !key.trim()}>{busy ? "Checking…" : "Save key"}</button>
				</form>
			)}
			{msg ? <div className="li-note" role="status">{msg}</div> : null}
		</div>
	);
}
