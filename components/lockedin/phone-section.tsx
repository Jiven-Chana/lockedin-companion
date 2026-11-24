"use client";

/**
 * Me → Phone (v0.1 F-112, J9; the pairing panel redesigned in v1.0.3). One
 * panel: the QR code, three steps, the 6-digit code an iPhone's Home Screen
 * app asks for, and a status line that changes by itself as the phone
 * arrives. Then unpair, and what the relay holds (R-7). The QR is our own
 * server-made SVG of the pairing link.
 */

import { useEffect, useState } from "react";
import { PHONE_PAIR_COPY } from "@/src/core";
import { ApiError, lockedIn, type PhonePairing } from "./api";
import { useData, usePoll } from "./hooks";

export function PhoneSection() {
	const status = useData(() => lockedIn.phone().catch((e) => (e instanceof ApiError && e.status === 501 ? null : Promise.reject(e))));
	const [pairing, setPairing] = useState<PhonePairing | null>(null);
	const [busy, setBusy] = useState(false);
	const [msg, setMsg] = useState<string | null>(null);
	// "Pair a phone again" on a phone that is already paired: the panel is shown on purpose.
	const [again, setAgain] = useState(false);
	const s = status.data;
	const finishing = !!s?.paired && !s.pushReady;
	// While a phone is on its way, watch for it connecting (J9 step 3).
	usePoll(() => void status.reload(), 3_000, !!pairing && !s?.pushReady);

	// Paired, but the phone isn't finished: the panel is simply there, with its code. Nothing to press to see it.
	useEffect(() => {
		if (finishing && !pairing && !busy) void lockedIn.pairPhone().then(setPairing, () => undefined);
	}, [finishing, pairing, busy]);

	// A code lasts ten minutes: when it runs out, the panel gets the next one by itself.
	const expiresAt = pairing?.codeExpiresAt ?? null;
	useEffect(() => {
		if (!expiresAt || !finishing) return;
		const t = window.setTimeout(() => void lockedIn.pairPhone().then(setPairing, () => undefined), Math.max(1_000, new Date(expiresAt).getTime() - Date.now() + 500));
		return () => window.clearTimeout(t);
	}, [expiresAt, finishing]);

	if (status.loading && !s) return <p className="li-muted">Checking your phone link…</p>;
	if (s === null) return <p className="li-muted">The phone relay isn&apos;t set up on this laptop (COMPANION_RELAY_URL). Everything else works without it.</p>;

	const run = async (fn: () => Promise<unknown>) => {
		setBusy(true);
		setMsg(null);
		try {
			await fn();
		} catch (e) {
			setMsg(e instanceof ApiError ? e.message : "Couldn't reach the relay. Try again.");
		} finally {
			setBusy(false);
			void status.reload();
		}
	};

	// The panel closes by itself once the phone is paired, unless it was opened again on purpose.
	const showPanel = !!pairing && (!s?.pushReady || again);
	const state = s?.pushReady ? "paired" : s?.phoneSeenAt ? "opened" : "waiting";

	return (
		<div className="li-stack" style={{ gap: 14 }}>
			{showPanel && pairing ? (
				<div className="li-pair">
					<div className="li-qr" aria-label="QR code to pair your phone" dangerouslySetInnerHTML={{ __html: pairing.qrSvg }} />
					<div className="li-stack" style={{ gap: 10, minWidth: 0 }}>
						<ol className="li-pair-steps">
							{PHONE_PAIR_COPY.steps.map((step) => <li key={step}>{step}</li>)}
						</ol>
						{pairing.code
							? <div className="li-pair-code" aria-label={`Pairing code ${pairing.code.split("").join(" ")}`}>{PHONE_PAIR_COPY.code(pairing.code)}</div>
							: <div className="li-note" role="alert">{PHONE_PAIR_COPY.noCode}</div>}
						<span className="li-small li-muted">{PHONE_PAIR_COPY.android}</span>
						<details className="li-small li-muted">
							<summary style={{ cursor: "pointer" }}>{PHONE_PAIR_COPY.cantScan}</summary>
							{PHONE_PAIR_COPY.openAddress(pairing.address)}
						</details>
					</div>
				</div>
			) : null}
			{s?.paired ? (
				<div className="li-pair-status" data-state={state} role="status" aria-live="polite">
					{state === "paired" ? null : <span className="li-pulse" aria-hidden="true" />}
					<span>
						{PHONE_PAIR_COPY[state]}
						{s.reachable === false ? " (Can't reach the relay right now; this laptop works on its own.)" : ""}
					</span>
				</div>
			) : null}
			<div className="li-row" style={{ gap: 8 }}>
				{!s?.paired ? <button type="button" className="li-btn primary" disabled={busy} onClick={() => run(async () => setPairing(await lockedIn.pairPhone()))}>{PHONE_PAIR_COPY.start}</button> : null}
				{s?.paired && s.pushReady && !showPanel ? <button type="button" className="li-btn" disabled={busy} onClick={() => run(async () => { setPairing(await lockedIn.pairPhone()); setAgain(true); })}>{PHONE_PAIR_COPY.showAgain}</button> : null}
				{s?.paired ? <button type="button" className="li-btn" disabled={busy} onClick={() => run(() => lockedIn.syncPhone())}>Sync now</button> : null}
				{s?.paired ? <button type="button" className="li-btn ghost" disabled={busy} onClick={() => run(async () => { await lockedIn.unpairPhone(); setPairing(null); setAgain(false); })}>Unpair</button> : null}
			</div>
			{msg ? <div className="li-note" role="alert">{msg}</div> : null}
			<span className="li-small li-muted"><b>What the relay holds:</b> {s?.holds}</span>
		</div>
	);
}
