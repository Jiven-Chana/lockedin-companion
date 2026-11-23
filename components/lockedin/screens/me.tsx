"use client";

/** Me (F-09; v0.1 F-119): your AI, appearance with a live preview, nudges, sessions, calendar, what I read, delete. */

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Profile } from "@/src/core";
import { ApiError, lockedIn } from "../api";
import { useData, useLocalFlag } from "../hooks";
import { useLockedIn } from "../root";
import { PageHead } from "../shell";
import { ConnectAi } from "./connect";
import { PhoneSection } from "../phone-section";

const SEEDS: [string, number][] = [["Lavender", 285], ["Ocean", 230], ["Moss", 150], ["Ember", 40], ["Rose", 350]];

function Seg<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
	return (
		<div className="li-stack" style={{ gap: 6 }}>
			<b>{label}</b>
			<div className="li-seg" role="group" aria-label={label}>
				{options.map(([v, l]) => <button key={String(v)} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>{l}</button>)}
			</div>
		</div>
	);
}

export function MeScreen() {
	const router = useRouter();
	const { appearance, setAppearance } = useLockedIn();
	const profile = useData(() => lockedIn.profile());
	const reads = useData(() => lockedIn.reads());
	const [prefs, setPrefs] = useState<Profile["prefs"] | null>(null);
	const [notify, setNotify] = useLocalFlag("li-notify");
	const [msg, setMsg] = useState<string | null>(null);
	const [confirmDelete, setConfirmDelete] = useState(false);

	useEffect(() => { if (profile.data) setPrefs(profile.data.prefs); }, [profile.data]);

	async function savePrefs(patch: Partial<Profile["prefs"]>) {
		setPrefs((p) => (p ? { ...p, ...patch } : p));
		try {
			const p = await lockedIn.updateProfile({ prefs: patch });
			setPrefs(p.prefs);
		} catch (e) {
			setMsg(e instanceof ApiError ? e.message : "Couldn't save that");
		}
	}
	async function toggleNotify() {
		if (notify) return setNotify(false);
		if (typeof Notification === "undefined") return setMsg("This browser can't show notifications.");
		const p = await Notification.requestPermission();
		setNotify(p === "granted");
		if (p !== "granted") setMsg("Notifications are blocked for this site in your browser settings.");
		void lockedIn.event("settings_changed", { changed: ["notifications"], granted: p === "granted" });
	}

	const hue = appearance.hue === "auto" ? "auto" : appearance.hue;

	return (
		<>
			<PageHead eyebrow="Me" title="Make it yours" />
			{msg ? <div className="li-note" role="status">{msg}</div> : null}

			<section id="ai" className="li-card li-stack" aria-labelledby="ai-h" style={{ gap: 16 }}>
				<h2 id="ai-h" className="li-h2">Your AI</h2>
				<span className="li-muted">The AI that teaches your sessions, and the model behind each part of the teacher.</span>
				<ConnectAi variant="settings" />
			</section>

			<section id="phone" className="li-card li-stack" aria-labelledby="ph-h" style={{ gap: 12 }}>
				<h2 id="ph-h" className="li-h2">Phone</h2>
				<PhoneSection />
			</section>

			<section className="li-card li-stack" aria-labelledby="ap" style={{ gap: 20 }}>
				<h2 id="ap" className="li-h2">Appearance</h2>
				<Seg label="Theme" value={appearance.theme} options={[["system", "System"], ["light", "Light"], ["dark", "Dark"], ["contrast", "High contrast"]]} onChange={(v) => setAppearance({ theme: v })} />
				<div className="li-stack" style={{ gap: 8 }}>
					<b>Colour</b>
					<span className="li-small li-muted">Every colour is generated from one hue. Auto gives each module its own.</span>
					<div className="li-row" style={{ gap: 10 }}>
						<button type="button" className="li-btn" aria-pressed={hue === "auto"} onClick={() => setAppearance({ accent: "auto" })} style={{ borderColor: hue === "auto" ? "var(--li-accent)" : undefined, borderWidth: 2 }}>Auto</button>
						{SEEDS.map(([name, h]) => (
							<button key={name} type="button" aria-label={name} aria-pressed={hue === h} onClick={() => setAppearance({ accent: String(h) })} style={{ width: 44, height: 44, borderRadius: 999, background: `oklch(0.6 0.16 ${h})`, border: `3px solid ${hue === h ? "var(--li-ink)" : "transparent"}` }} />
						))}
						<label className="li-row" style={{ gap: 8, flexGrow: 1, minWidth: 260 }}>
							<span className="li-small li-muted">Any hue</span>
							<input type="range" min={0} max={359} value={hue === "auto" ? 285 : hue} onChange={(e) => setAppearance({ accent: e.target.value })} style={{ flexGrow: 1, accentColor: "var(--li-accent)" }} aria-label="Hue" />
						</label>
					</div>
				</div>
				<div className="li-row" style={{ gap: 28, alignItems: "flex-start" }}>
					<Seg label="Text size" value={appearance.textSize} options={[["normal", "Normal"], ["large", "Large"], ["xlarge", "Extra large"]]} onChange={(v) => setAppearance({ textSize: v })} />
					<Seg label="Line spacing" value={appearance.loose ? "loose" : "normal"} options={[["normal", "Normal"], ["loose", "Loose"]]} onChange={(v) => setAppearance({ lineSpacing: v })} />
					<Seg label="Motion" value={appearance.reduceMotion ? "reduce" : "full"} options={[["full", "Full"], ["reduce", "Reduce"]]} onChange={(v) => setAppearance({ reduceMotion: v === "reduce" })} />
				</div>
				<div className="li-card flat" style={{ background: "linear-gradient(160deg, var(--li-bg-a), var(--li-bg-b))" }}>
					<span className="li-eyebrow">Preview</span>
					<div className="li-row" style={{ marginTop: 8 }}>
						<span className="li-chip">HCI · ready now</span>
						<b className="li-display" style={{ fontSize: "1.3em", flexGrow: 1 }}>Personas and scenarios</b>
						<span className="li-btn primary">Start</span>
					</div>
				</div>
			</section>

			{prefs ? (
				<section className="li-card li-stack" aria-labelledby="nd" style={{ gap: 20 }}>
					<h2 id="nd" className="li-h2">Nudges and sessions</h2>
					<div className="li-row" style={{ gap: 28, alignItems: "flex-start" }}>
						<Seg label="Nudges a day" value={prefs.nudgesPerDay} options={[[0, "Off"], [1, "One"], [2, "Two"]]} onChange={(v) => savePrefs({ nudgesPerDay: v })} />
						<Seg label="Sessions start with" value={prefs.defaultMode} options={[["question-first", "Question me first"], ["show-first", "Show me first"]]} onChange={(v) => savePrefs({ defaultMode: v })} />
					</div>
					<div className="li-row" style={{ gap: 20 }}>
						<label className="li-stack" style={{ gap: 6 }}><b>Quiet from</b><input className="li-input" type="time" value={prefs.quietHours.from} onChange={(e) => savePrefs({ quietHours: { ...prefs.quietHours, from: e.target.value } })} /></label>
						<label className="li-stack" style={{ gap: 6 }}><b>until</b><input className="li-input" type="time" value={prefs.quietHours.to} onChange={(e) => savePrefs({ quietHours: { ...prefs.quietHours, to: e.target.value } })} /></label>
						<label className="li-stack" style={{ gap: 6 }}><b>Evening offers at</b><input className="li-input" type="time" value={prefs.eveningTime} onChange={(e) => savePrefs({ eveningTime: e.target.value })} /></label>
					</div>
					<div className="li-row">
						<span style={{ flexGrow: 1 }}><b>Desktop notifications</b><br /><span className="li-small li-muted">A real notification on this laptop when a nudge is ready.</span></span>
						<button type="button" className={`li-btn ${notify ? "primary" : ""}`} aria-pressed={notify} onClick={toggleNotify}>{notify ? "On" : "Off"}</button>
					</div>
				</section>
			) : null}

			<section className="li-card li-stack" aria-labelledby="rd" style={{ gap: 12 }}>
				<h2 id="rd" className="li-h2">Calendar and what I read</h2>
				{reads.data ? (
					<ul style={{ margin: 0, paddingLeft: "1.2em" }}>
						<li>Source: {reads.data.label}{reads.data.link ? ` (${reads.data.link})` : ""}</li>
						{reads.data.refreshedAt ? <li>Refreshed {new Date(reads.data.refreshedAt).toLocaleString("en-GB")}; it refreshes when you open the app and every 6 hours</li> : null}
						<li>Times read in {reads.data.timeZone}</li>
						<li>{reads.data.events} timetable events, {reads.data.lectures} lectures, modules {reads.data.modules.join(", ") || "none"}</li>
						<li>Last read: {reads.data.lastReadAt ? new Date(reads.data.lastReadAt).toLocaleString("en-GB") : "never"}</li>
						<li>Location: never read</li>
					</ul>
				) : null}
				<div className="li-row">
					<button type="button" className="li-btn" onClick={async () => { try { const r = await lockedIn.refreshCalendar(); setMsg(`Calendar refreshed: ${r.added} events.`); void reads.reload(); } catch (e) { setMsg(e instanceof ApiError ? e.message : "Couldn't refresh"); } }}>Refresh calendar link</button>
					<label className="li-btn" style={{ cursor: "pointer" }}>
						Import an .ics file
						<input type="file" accept=".ics,text/calendar" className="li-sr" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { const r = await lockedIn.importIcs(await f.text()); setMsg(`${r.added} events read from ${f.name}.`); void reads.reload(); } catch (err) { setMsg(err instanceof ApiError ? err.message : "Couldn't read that file"); } }} />
					</label>
				</div>
			</section>

			<section className="li-card li-stack" aria-labelledby="dl" style={{ gap: 12 }}>
				<h2 id="dl" className="li-h2">Your data</h2>
				<span className="li-muted">Everything LockedIn keeps lives on this laptop. Delete it all in one click; your lecture slides stay.</span>
				{confirmDelete ? (
					<div className="li-row">
						<b>Delete your profile, sessions, answers and nudges?</b>
						<button type="button" className="li-btn primary" onClick={async () => { await lockedIn.deleteAll(); router.replace("/app/welcome"); }}>Yes, delete everything</button>
						<button type="button" className="li-btn" onClick={() => setConfirmDelete(false)}>Keep it</button>
					</div>
				) : <button type="button" className="li-btn" style={{ alignSelf: "flex-start" }} onClick={() => setConfirmDelete(true)}>Delete all my data</button>}
				<span className="li-small li-muted">LockedIn&apos;s teaching engine is LearnHarness (AGPL-3.0), included and modified. See NOTICE.</span>
			</section>
		</>
	);
}
