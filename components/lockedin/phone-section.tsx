"use client";

/**
 * Me → Phone (v0.1 F-112, J9): pair with a QR code, see whether the phone
 * has connected and can get notifications, unpair, and what the relay holds
 * (R-7). The QR is our own server-made SVG of the pairing link.
 */

import { useState } from "react";
import { PHONE_PAIR_COPY } from "@/src/core";
import { ApiError, lockedIn, type PhoneStatus } from "./api";
import { useData, usePoll } from "./hooks";

export function PhoneSection() {
	const status = useData(() => lockedIn.phone().catch((e) => (e instanceof ApiError && e.status === 501 ? null : Promise.reject(e))));
	const [pairing, setPairing] = useState<(PhoneStatus & { url: string; qrSvg: string }) | null>(null);
	const [busy, setBusy] = useState(false);
	const [msg, setMsg] = useState<string | null>(null);
	const s = status.data;
	// While the QR is up, watch for the phone connecting (J9 step 3).
	usePoll(() => void status.reload(), 3_000, !!pairing && !s?.pushReady);

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

	return (
		<div className="li-stack" style={{ gap: 12 }}>
			{s?.paired ? (
				<div className="li-note" role="status">
					{s.pushReady ? PHONE_PAIR_COPY.paired : s.phoneSeenAt ? PHONE_PAIR_COPY.opened : PHONE_PAIR_COPY.waiting}
					{s.reachable === false ? " (Can't reach the relay right now; this laptop works on its own.)" : ""}
				</div>
			) : null}
			{pairing ? (
				<div className="li-row" style={{ gap: 20, alignItems: "flex-start" }}>
					<div className="li-qr" aria-label="QR code to pair your phone" dangerouslySetInnerHTML={{ __html: pairing.qrSvg }} />
					<ol style={{ margin: 0, paddingLeft: "1.2em", display: "flex", flexDirection: "column", gap: 6, maxWidth: 420 }}>
						{PHONE_PAIR_COPY.steps.map((step) => <li key={step}>{step}</li>)}
						<li className="li-small li-muted">Or open this link on your phone: <span style={{ wordBreak: "break-all" }}>{pairing.url}</span></li>
					</ol>
				</div>
			) : null}
			<div className="li-row" style={{ gap: 8 }}>
				<button type="button" className="li-btn primary" disabled={busy} onClick={() => run(async () => setPairing(await lockedIn.pairPhone()))}>{s?.paired ? "Show the pairing code" : "Get questions on your phone"}</button>
				{s?.paired ? <button type="button" className="li-btn" disabled={busy} onClick={() => run(() => lockedIn.syncPhone())}>Sync now</button> : null}
				{s?.paired ? <button type="button" className="li-btn ghost" disabled={busy} onClick={() => run(async () => { await lockedIn.unpairPhone(); setPairing(null); })}>Unpair</button> : null}
			</div>
			{msg ? <div className="li-note" role="alert">{msg}</div> : null}
			<span className="li-small li-muted"><b>What the relay holds:</b> {s?.holds}</span>
		</div>
	);
}
