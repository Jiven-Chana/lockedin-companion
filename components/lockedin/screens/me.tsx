"use client";

/** Me (F-09, F-119; v3.0): a few lines (your AI, your phone, notifications, appearance, what LockedIn uses, delete) and one "Advanced" section for the rest. */

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AI_COPY, MODULE_COLOUR_CHOICES, type MotionChoice, type Profile } from "@/src/core";
import { ApiError, lockedIn, type AiFullStatus } from "../api";
import { useData, useLocalFlag } from "../hooks";
import { Icon, ModuleMark } from "../icons";
import { useLockedIn } from "../root";
import { PageHead } from "../shell";
import { ConnectAi } from "./connect";
import { PhoneSection } from "../phone-section";
import { VoiceSection } from "../voice-section";
import { RoutineSettings, StudyBlocksSettings } from "../study-settings";


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
	const { appearance, setAppearance, moduleLook, refreshModules } = useLockedIn();
	// "Advanced" is closed unless a link asked for something inside it (#blocks, #routine, #voice, #advanced).
	const [advanced, setAdvanced] = useState(false);
	useEffect(() => {
		if (["#advanced", "#blocks", "#routine", "#voice", "#ai-settings"].includes(window.location.hash)) setAdvanced(true);
	}, []);
	function openAdvanced(id: string) {
		setAdvanced(true);
		requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }));
	}
	const profile = useData(() => lockedIn.profile());
	const reads = useData(() => lockedIn.reads());
	const [prefs, setPrefs] = useState<Profile["prefs"] | null>(null);
	const [notify, setNotify] = useLocalFlag("li-notify");
	const [msg, setMsg] = useState<string | null>(null);
	// The AI status is loaded once, by the AI panel in "Advanced"; the "Your AI" line and Voice read it from there.
	const [ai, setAi] = useState<AiFullStatus | null>(null);
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

	const modules = profile.data?.modules ?? [];
	async function pickColour(code: string, colour: string | null) {
		try {
			await lockedIn.setModuleColour(code, colour);
			void profile.reload();
			// Every screen takes the module's colour from the root: tell it.
			refreshModules();
		} catch (e) {
			setMsg(e instanceof ApiError ? e.message : "Couldn't save that colour");
		}
	}

	return (
		<>
			<PageHead eyebrow="Me" icon={<Icon.me />} title="Make it yours" />
			{msg ? <div className="li-note" role="status">{msg}</div> : null}

			{/* Me in a few lines (v3.0; lo-fi v12, UI research Q5). What most students never touch is behind "Advanced", at the bottom. */}
			<section id="ai" className="li-card li-row" aria-labelledby="ai-h" style={{ gap: 14 }}>
				<span style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 }}>
					<h2 id="ai-h" className="li-h2">Your AI</h2>
					<span className="li-muted">{ai ? (ai.ready ? "Connected. It teaches your Learn sessions and writes your questions." : (ai.blocker ?? AI_COPY.fallback)) : "Checking…"}</span>
				</span>
				{ai?.ready ? <span className="li-status solid"><Icon.check />Connected</span> : null}
				<button type="button" className="li-btn" onClick={() => openAdvanced("ai-settings")}>{ai?.ready ? "Change" : "Connect"}<Icon.arrow /></button>
			</section>

			<section id="phone" className="li-card li-stack" aria-labelledby="ph-h" style={{ gap: 12 }}>
				<h2 id="ph-h" className="li-h2">Phone</h2>
				<PhoneSection />
			</section>

			{prefs ? (
				<section id="notifications" className="li-card li-stack" aria-labelledby="nd" style={{ gap: 18 }}>
					<h2 id="nd" className="li-h2">Notifications</h2>
					<div className="li-row" style={{ gap: 28, alignItems: "flex-end" }}>
						<Seg label="Notifications a day" value={prefs.nudgesPerDay} options={[[0, "Off"], [1, "One"], [2, "Two"]]} onChange={(v) => savePrefs({ nudgesPerDay: v })} />
						<label className="li-stack" style={{ gap: 6 }}><b>Quiet from</b><input className="li-input" type="time" value={prefs.quietHours.from} onChange={(e) => savePrefs({ quietHours: { ...prefs.quietHours, from: e.target.value } })} /></label>
						<label className="li-stack" style={{ gap: 6 }}><b>until</b><input className="li-input" type="time" value={prefs.quietHours.to} onChange={(e) => savePrefs({ quietHours: { ...prefs.quietHours, to: e.target.value } })} /></label>
					</div>
					<div className="li-row">
						<span style={{ flexGrow: 1 }}><b>On this laptop</b><br /><span className="li-small li-muted">A real notification here when a question is ready.</span></span>
						<div className="li-seg" role="group" aria-label="Notifications on this laptop">
							<button type="button" aria-pressed={!notify} onClick={() => { if (notify) void toggleNotify(); }}>Off</button>
							<button type="button" aria-pressed={notify} onClick={() => { if (!notify) void toggleNotify(); }}>On</button>
						</div>
					</div>
				</section>
			) : null}

			<section id="look" className="li-card li-stack" aria-labelledby="ap" style={{ gap: 20 }}>
				<h2 id="ap" className="li-h2">Appearance</h2>
				<Seg label="Theme" value={appearance.theme} options={[["system", "System"], ["light", "Light"], ["dark", "Dark"], ["contrast", "High contrast"]]} onChange={(v) => setAppearance({ theme: v })} />
				{/* "Make it yours" is choosing each module's colour (v3.0): a colour means a module, on every screen. Mint and lilac are not here: they mean right and to revisit. */}
				{modules.length ? (
					<div className="li-stack" style={{ gap: 10 }}>
						<span><b>Your modules&apos; colours</b><br /><span className="li-small li-muted">A module keeps its colour on every screen and on your phone.</span></span>
						{modules.map((m) => {
							const now = moduleLook(m.code).colour;
							return (
								<div key={m.code} className="li-row" style={{ gap: 12, flexWrap: "nowrap" }}>
									<ModuleMark module={m.code} small />
									<b style={{ flex: "1 1 180px", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}</b>
									<div className="li-row" role="group" aria-label={`Colour for ${m.name}`} style={{ gap: 8, flexWrap: "nowrap" }}>
										{MODULE_COLOUR_CHOICES.map((c) => (
											<button key={c} type="button" className={`li-swatch li-mod-${c}`} aria-pressed={now === c} aria-label={c} title={c} onClick={() => void pickColour(m.code, c)}>{now === c ? <Icon.check /> : null}</button>
										))}
									</div>
								</div>
							);
						})}
					</div>
				) : null}
				<div className="li-row" style={{ gap: 28, alignItems: "flex-start" }}>
					<Seg label="Text size" value={appearance.textSize} options={[["normal", "Normal"], ["large", "Large"], ["xlarge", "Extra large"]]} onChange={(v) => setAppearance({ textSize: v })} />
					<Seg label="Line spacing" value={appearance.loose ? "loose" : "normal"} options={[["normal", "Normal"], ["loose", "Loose"]]} onChange={(v) => setAppearance({ lineSpacing: v })} />
					<Seg label="Motion" value={appearance.motion} options={[["calm", "Calm"], ["full", "Full"], ["off", "Off"]]} onChange={(v) => setAppearance({ motion: v as MotionChoice })} />
				</div>
			</section>

			<section className="li-card li-stack" aria-labelledby="dl" style={{ gap: 12 }}>
				<h2 id="dl" className="li-h2">What LockedIn uses</h2>
				<div className="li-row" style={{ gap: 10 }}>
					<span className="li-status solid"><Icon.check />Your timetable</span>
					<span className="li-status solid"><Icon.check />Your lecture slides</span>
					<span className="li-status notyet">Your location: never</span>
				</div>
				<span className="li-muted">Everything LockedIn keeps lives on this laptop. Delete it all in one click; your lecture slides stay.</span>
				{confirmDelete ? (
					<div className="li-row">
						<b>Delete your profile, sessions, answers and notifications?</b>
						<button type="button" className="li-btn primary" onClick={async () => { await lockedIn.deleteAll(); router.replace("/app/welcome"); }}>Yes, delete everything</button>
						<button type="button" className="li-btn" onClick={() => setConfirmDelete(false)}>Keep it</button>
					</div>
				) : <button type="button" className="li-btn" style={{ alignSelf: "flex-start" }} onClick={() => setConfirmDelete(true)}>Delete all my data</button>}
			</section>

			{/* Advanced: models, the voice key, calendar details, block length, the routine. The power user's corner (anti-persona A-2). */}
			<details id="advanced" className="li-card li-advanced" open={advanced} onToggle={(e) => setAdvanced((e.target as HTMLDetailsElement).open)}>
				<summary><span className="li-h2">Advanced</span><span className="li-muted">Models, voice, calendar details, block length, your routine</span><Icon.chevron /></summary>
				<div className="li-stack" style={{ gap: 28, marginTop: 20 }}>
					<section id="ai-settings" className="li-stack" aria-labelledby="ais-h" style={{ gap: 12 }}>
						<h3 id="ais-h" className="li-h2" style={{ fontSize: "1.25em" }}>Your AI and its models</h3>
						<span className="li-muted">The AI that teaches your sessions, and the model behind each part of the teacher.</span>
						<ConnectAi variant="settings" onStatus={setAi} />
					</section>
					<section id="voice" className="li-stack" aria-labelledby="vo-h" style={{ gap: 12 }}>
						<h3 id="vo-h" className="li-h2" style={{ fontSize: "1.25em" }}>Voice</h3>
						<VoiceSection voice={ai ? !!ai.voice : null} />
					</section>
					<section className="li-stack" aria-labelledby="rd" style={{ gap: 12 }}>
						<h3 id="rd" className="li-h2" style={{ fontSize: "1.25em" }}>Calendar and what LockedIn reads</h3>
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
					{profile.data ? (
						<>
							<section id="blocks" className="li-stack" aria-labelledby="sb-h" style={{ gap: 12 }}>
								<h3 id="sb-h" className="li-h2" style={{ fontSize: "1.25em" }}>Study blocks</h3>
								<StudyBlocksSettings profile={profile.data} onSaved={setMsg} />
							</section>
							<section id="routine" className="li-stack" aria-labelledby="rt-h" style={{ gap: 12 }}>
								<h3 id="rt-h" className="li-h2" style={{ fontSize: "1.25em" }}>Routine</h3>
								<RoutineSettings profile={profile.data} />
							</section>
						</>
					) : null}
					{prefs ? (
						<section className="li-stack" aria-labelledby="ss-h" style={{ gap: 12 }}>
							<h3 id="ss-h" className="li-h2" style={{ fontSize: "1.25em" }}>Sessions</h3>
							<div className="li-row" style={{ gap: 28, alignItems: "flex-end" }}>
								<Seg label="Sessions start with" value={prefs.defaultMode} options={[["question-first", "Question me first"], ["show-first", "Show me first"]]} onChange={(v) => savePrefs({ defaultMode: v })} />
								<label className="li-stack" style={{ gap: 6 }}><b>Evening offers at</b><input className="li-input" type="time" value={prefs.eveningTime} onChange={(e) => savePrefs({ eveningTime: e.target.value })} /></label>
							</div>
						</section>
					) : null}
					<span className="li-small li-muted">LockedIn&apos;s teaching engine is LearnHarness (AGPL-3.0), included and modified. See NOTICE.</span>
				</div>
			</details>
		</>
	);
}
