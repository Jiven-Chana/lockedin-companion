"use client";

/** The T23 facilitator panel (F-10): demo clock, scenarios, fire nudges, engine, event log. COMPANION_DEMO=1 only. */

import { useState } from "react";
import { ApiError, api, lockedIn } from "../api";
import { fmtTime, useData, usePoll } from "../hooks";
import { useLockedIn } from "../root";
import { PageHead } from "../shell";

function parseCsv(text: string): { t: string; type: string; data: string }[] {
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = "";
	let q = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i]!;
		if (q) {
			if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
		} else if (c === '"') q = true;
		else if (c === ",") { row.push(cell); cell = ""; }
		else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
		else cell += c;
	}
	return rows.slice(1).map((r) => ({ t: r[0] ?? "", type: r[3] ?? "", data: r[4] ?? "" }));
}

export function FacilitatorScreen() {
	const { refreshClock } = useLockedIn();
	const state = useData(() => lockedIn.demo.state());
	const log = useData(() => fetch("/api/companion/events.csv", { cache: "no-store" }).then((r) => r.text()).then(parseCsv));
	const [msg, setMsg] = useState<string | null>(null);
	const [participant, setParticipant] = useState("");
	const [setAt, setSetAt] = useState("");
	// F-119: the phone relay's status (null when COMPANION_RELAY_URL isn't set).
	const phone = useData(() => lockedIn.phone().catch(() => null));
	usePoll(() => { void state.reload(); void log.reload(); void phone.reload(); }, 4000, true);

	async function run(label: string, fn: () => Promise<unknown>) {
		try {
			await fn();
			setMsg(label);
			refreshClock();
			window.dispatchEvent(new Event("li:clock"));
			void state.reload();
			void log.reload();
		} catch (e) {
			setMsg(e instanceof ApiError ? `${label} failed: ${e.message}` : `${label} failed`);
		}
	}

	const s = state.data;
	return (
		<>
			<PageHead eyebrow="Facilitator · not shown to testers" title="Run a session" />
			{msg ? <div className="li-note" role="status">{msg}</div> : null}
			<div className="li-grid-2">
				<div className="li-stack">
					<section className="li-card li-stack" style={{ gap: 12 }}>
						<h2 className="li-h2">Scenarios</h2>
						<span className="li-small li-muted">Each one resets the data (the event log is archived), places the demo clock and onboards with the sample timetable.</span>
						<div className="li-row">
							<button type="button" className="li-btn primary" onClick={() => run("Tayo: Tue 12:58, HCI ends at 13:00", () => lockedIn.demo.scenario("tayo"))}>J2 · Tayo (post-lecture)</button>
							<button type="button" className="li-btn" onClick={() => run("Maya: Tue 18:45, missed HCI", () => lockedIn.demo.scenario("maya"))}>J3 · Maya (missed lecture)</button>
							<button type="button" className="li-btn" onClick={() => run("Returning: 8 days away", () => lockedIn.demo.scenario("returning"))}>J6 · Returning</button>
							<button type="button" className="li-btn ghost" onClick={() => run("Reset: first-run state (J1)", () => lockedIn.demo.reset())}>J1 · Reset to first run</button>
						</div>
					</section>
					<section className="li-card li-stack" style={{ gap: 12 }}>
						<h2 className="li-h2">Demo clock · {s ? `${new Date(s.now).toLocaleDateString("en-GB", { weekday: "short" })} ${fmtTime(s.now)}` : "…"}</h2>
						<div className="li-row">
							<button type="button" className="li-btn" onClick={() => run("+5 minutes", () => lockedIn.demo.clock({ advanceMinutes: 5 }))}>+5 min</button>
							<button type="button" className="li-btn" onClick={() => run("+30 minutes", () => lockedIn.demo.clock({ advanceMinutes: 30 }))}>+30 min</button>
							<button type="button" className="li-btn" onClick={() => run("+1 hour", () => lockedIn.demo.clock({ advanceMinutes: 60 }))}>+1 h</button>
							<button type="button" className="li-btn" onClick={() => run("Jumped to the next lecture's end", () => lockedIn.demo.clock({ jump: "next-lecture-end" }))}>Next lecture end</button>
							<button type="button" className="li-btn" onClick={() => run("Next day 09:00", () => lockedIn.demo.clock({ jump: "next-day" }))}>Next day</button>
							<button type="button" className="li-btn" onClick={() => run("Sunday evening (check-in time)", () => lockedIn.demo.clock({ jump: "sunday-evening" }))}>Sunday evening</button>
							<button type="button" className="li-btn ghost" onClick={() => run("Real time", () => lockedIn.demo.clock({ jump: "reset" }))}>Real time</button>
						</div>
						<label className="li-row">
							<span className="li-small">Set to</span>
							<input className="li-input" style={{ width: 260 }} type="datetime-local" value={setAt} onChange={(e) => setSetAt(e.target.value)} />
							<button type="button" className="li-btn" disabled={!setAt} onClick={() => run("Clock set", () => lockedIn.demo.clock({ set: new Date(setAt).toISOString() }))}>Set</button>
						</label>
					</section>
					<section className="li-card li-stack" style={{ gap: 12 }}>
						<h2 className="li-h2">Fire a nudge now</h2>
						<div className="li-row">
							{["N-1", "N-2", "N-3", "N-4", "N-5", "block"].map((t) => <button key={t} type="button" className="li-btn" onClick={() => run(`Fired ${t}`, () => lockedIn.demo.fire(t))}>{t}</button>)}
						</div>
						<div className="li-row">
							<b className="li-small">Phone (no phone needed):</b>
							<button type="button" className="li-btn" onClick={() => run("Phone: answered right, then 4 more on the laptop", () => api("/demo/phone", { body: { action: "handover", correct: true } }))}>Answer + hand-off</button>
							<button type="button" className="li-btn" onClick={() => run("Phone: answered wrong, then 4 more on the laptop", () => api("/demo/phone", { body: { action: "handover", correct: false } }))}>Wrong + hand-off</button>
							<button type="button" className="li-btn" onClick={() => run("Phone: answered, then Done for now", () => api("/demo/phone", { body: { action: "done" } }))}>Answer + done</button>
						</div>
						<span className="li-small li-muted">Upcoming by the rules: {s?.candidates.length ? s.candidates.map((c) => `${c.type} at ${fmtTime(c.fireAt)}`).join(", ") : "none right now"}.</span>
					</section>
				</div>
				<div className="li-stack">
					<section className="li-card li-stack" style={{ gap: 12 }}>
						<h2 className="li-h2">Phone relay</h2>
						{phone.data ? (
							<>
								<span className="li-small">
									{phone.data.relay} · {phone.data.reachable === false ? "unreachable (the laptop carries on alone)" : "reachable"}
									{" · "}{phone.data.paired ? `paired${phone.data.pushReady ? ", notifications on" : phone.data.phoneSeenAt ? ", phone opened the link (no notifications yet)" : ", phone not seen yet"}` : "not paired"}
									{phone.data.uploadedAt ? ` · week uploaded ${fmtTime(phone.data.uploadedAt)}` : ""}
								</span>
								<div className="li-row">
									<button type="button" className="li-btn" disabled={!phone.data.paired} onClick={() => run("Synced with the relay", () => lockedIn.syncPhone())}>Sync now</button>
									<button type="button" className="li-btn" disabled={!phone.data.paired} onClick={() => run("Pairing reset: pair again from Me → Phone", () => lockedIn.unpairPhone())}>Reset pairing</button>
								</div>
							</>
						) : (
							<span className="li-small li-muted">No relay on this laptop (COMPANION_RELAY_URL is not set). Use the phone buttons under “Fire a nudge now” to simulate it.</span>
						)}
					</section>
					<section className="li-card li-stack" style={{ gap: 12 }}>
						<h2 className="li-h2">Participant</h2>
						<div className="li-row">
							<input className="li-input" style={{ width: 160 }} placeholder={s?.participant ?? "P01"} value={participant} onChange={(e) => setParticipant(e.target.value)} />
							<button type="button" className="li-btn" onClick={() => run(`Participant ${participant || "cleared"}`, () => lockedIn.demo.participant(participant || null))}>Set</button>
						</div>
						<span className="li-small li-muted">Current: {s?.participant ?? "none"} · stamped on every event</span>
					</section>
					<section className="li-card li-stack" style={{ gap: 12 }}>
						<h2 className="li-h2">Engine for new sessions</h2>
						<div className="li-seg" role="group" aria-label="Engine">
							{([[null, `Default (${s?.defaultEngine ?? "…"})`], ["scripted", "Scripted"], ["learnharness", "LearnHarness"]] as const).map(([v, l]) => (
								<button key={String(v)} type="button" aria-pressed={(s?.engineOverride ?? null) === v} onClick={() => run(`Engine: ${l}`, () => lockedIn.demo.engine(v))}>{l}</button>
							))}
						</div>
					</section>
					<section className="li-card li-stack" style={{ gap: 10 }}>
						<div className="li-row"><h2 className="li-h2" style={{ flexGrow: 1 }}>Event log</h2><a className="li-btn soft" href="/api/companion/events.csv">Export CSV</a></div>
						<div className="li-log">
							{(log.data ?? []).slice(-40).reverse().map((e, i) => (
								<div key={i}><span className="li-muted">{e.t ? fmtTime(e.t) : ""}</span><b>{e.type}</b><span className="li-muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.data}</span></div>
							))}
						</div>
					</section>
				</div>
			</div>
		</>
	);
}
