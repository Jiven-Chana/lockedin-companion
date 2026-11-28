"use client";

/**
 * The first run (v2.0 step 7; DECISIONS.md V-45, V-63 to V-66). Five short
 * steps, one main action each, and every one but sign-in can wait:
 *   1. Sign in with ChatGPT (models are chosen for the student)
 *   2. Your timetable: paste the link, the modules appear; or add them by hand
 *   3. Your slides and notes: dropped in per module and saved straight away
 *   4. Your week: when you have energy, one total, blocks that say why
 *   5. Your phone
 * It ends on Learn, on the student's own first unit. A closed tab reopens on
 * the step that was reached.
 */

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { CALENDAR_COPY, ENERGY_TIMES, SETUP_COPY, SETUP_RULES, WEEK_COPY, type DetectedModule, type EnergyTime, type SetupModuleLine, type SetupView, type SetupWeek, MATERIALS_COPY, MATERIALS_RULES, eachFile } from "@/src/core";
import { AddModule } from "../add-module";
import { ApiError, lockedIn } from "../api";
import { usePoll } from "../hooks";
import { Logo } from "../icons";
import { PhoneSection } from "../phone-section";
import { Tint } from "../root";
import { ConnectAi } from "./connect";

const WEEKS = Array.from({ length: 20 }, (_, i) => i + 1);
const message = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);
const dayLabel = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

// ─── step 2: the timetable ──────────────────────────────────────────────────

interface ModuleRow { code?: string; name: string; on: boolean; /** Typed by the student, not found in the calendar. */ added?: boolean }

function TimetableStep({ view, busy, onSave }: { view: SetupView; busy: boolean; onSave: (body: Parameters<typeof lockedIn.setupTimetable>[0], later: boolean) => void }) {
	const [link, setLink] = useState("");
	const [fileText, setFileText] = useState<string | null>(null);
	const [useFile, setUseFile] = useState(false);
	const [rows, setRows] = useState<ModuleRow[]>([]);
	const [found, setFound] = useState<number | null>(null);
	const [reading, setReading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const asked = useRef(0);
	const linkOk = /^(https?|webcal):\/\//i.test(link.trim());

	const preview = useCallback(async (body: { url: string } | { text: string }) => {
		const mine = ++asked.current;
		setReading(true);
		setError(null);
		try {
			const p = await lockedIn.calendarPreview(body);
			if (mine !== asked.current) return;
			setFound(p.events);
			// What the student typed stays; what the calendar says replaces the last reading.
			setRows((old) => [...p.modules.map((m: DetectedModule) => ({ code: m.code, name: m.name, on: m.confident })), ...old.filter((r) => r.added)]);
		} catch (e) {
			if (mine !== asked.current) return;
			setFound(null);
			setError(message(e, SETUP_COPY.timetable.failed));
		} finally {
			if (mine === asked.current) setReading(false);
		}
	}, []);

	// The modules appear as the link is pasted: no button to press (AFF-G).
	useEffect(() => {
		if (useFile || !linkOk) return;
		const t = window.setTimeout(() => void preview({ url: link.trim() }), 500);
		return () => window.clearTimeout(t);
	}, [link, linkOk, useFile, preview]);

	const read = found !== null && !error;
	const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
	const chosen = (all: boolean) => rows.filter((r) => r.on && r.name.trim() && (all || r.added)).map((r) => ({ name: r.name.trim(), ...(r.code ? { code: r.code } : {}) }));
	const next = () =>
		onSave({ calendar: !read || view.calendar ? { kind: "none" } : useFile ? { kind: "file", text: fileText ?? "" } : { kind: "link", url: link.trim() }, modules: chosen(true), timeZone }, false);
	const later = () => onSave({ calendar: { kind: "none" }, modules: chosen(false), timeZone }, true);
	const set = (i: number, patch: Partial<ModuleRow>) => setRows((all) => all.map((r, j) => (j === i ? { ...r, ...patch } : r)));
	const anything = read || rows.some((r) => r.on && r.name.trim()) || view.modules.length > 0;

	return (
		<>
			<h1 className="li-h1">{SETUP_COPY.timetable.title}</h1>
			<p className="li-muted li-setup-lead">{SETUP_COPY.timetable.lead}</p>
			{view.calendar ? (
				<div className="li-note">✓ {SETUP_COPY.timetable.connected}</div>
			) : useFile ? (
				<label key="file" className="li-stack" style={{ gap: 6 }}>
					<b className="li-small">Calendar file (.ics)</b>
					<input
						type="file"
						accept=".ics,text/calendar"
						onChange={async (e) => {
							const f = e.target.files?.[0];
							if (!f) return;
							const text = await f.text();
							setFileText(text);
							void preview({ text });
						}}
					/>
				</label>
			) : (
				<label key="link" className="li-stack" style={{ gap: 6 }}>
					<b className="li-small">{SETUP_COPY.timetable.label}</b>
					<input className="li-input" type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder={SETUP_COPY.timetable.placeholder} autoFocus />
				</label>
			)}
			{!view.calendar ? (
				<div className="li-row li-small" style={{ gap: 16 }}>
					{!useFile ? (
						<details style={{ flexGrow: 1 }}>
							<summary style={{ cursor: "pointer" }}>{CALENDAR_COPY.findLinkLabel}</summary>
							<div className="li-stack" style={{ gap: 4, marginTop: 6 }}>
								{CALENDAR_COPY.findLink.map((line) => <span key={line} className="li-muted">{line}</span>)}
							</div>
						</details>
					) : <span style={{ flexGrow: 1 }} />}
					<button type="button" className="li-link" onClick={() => { setUseFile(!useFile); setFound(null); setError(null); setRows((r) => r.filter((x) => x.added)); }}>{useFile ? SETUP_COPY.timetable.useLink : SETUP_COPY.timetable.file}</button>
				</div>
			) : null}
			<div aria-live="polite" className="li-small li-muted">
				{reading ? SETUP_COPY.timetable.reading : read ? (rows.some((r) => !r.added) ? SETUP_COPY.timetable.found(found!) : SETUP_COPY.timetable.none) : null}
			</div>
			{error ? <div className="li-note" role="alert">{error}</div> : null}

			{view.modules.length + rows.length > 0 ? (
				<div className="li-stack" style={{ gap: 8 }}>
					{view.modules.map((m) => (
						<Tint key={m.code} module={m.code}>
							<div className="li-opt li-setup-module" data-on="true"><input type="checkbox" checked disabled aria-label={m.name} /><b style={{ flexGrow: 1 }}>{m.name}</b></div>
						</Tint>
					))}
					{rows.map((r, i) => (
						<Tint key={`${r.code ?? "new"}-${i}`} module={r.code || r.name}>
							<div className="li-opt li-setup-module" data-on={r.on ? "true" : "false"}>
								<input type="checkbox" aria-label={`Include ${r.name}`} checked={r.on} onChange={(e) => set(i, { on: e.target.checked })} />
								<input className="li-input" aria-label="Module name" maxLength={SETUP_RULES.moduleNameMax} value={r.name} onChange={(e) => set(i, { name: e.target.value })} style={{ flexGrow: 1 }} />
							</div>
						</Tint>
					))}
				</div>
			) : null}
			<AddModule save={false} onAdd={(m) => setRows((all) => [...all, { name: m.name, on: true, added: true }])} />

			<Footer>
				<button type="button" className="li-btn ghost" onClick={later} disabled={busy}>{SETUP_COPY.later}</button>
				<button type="button" className="li-btn primary big" onClick={next} disabled={busy || reading || !anything}>{SETUP_COPY.next}</button>
			</Footer>
		</>
	);
}

// ─── step 3: slides and notes ───────────────────────────────────────────────

function SlidesModule({ line, onChanged }: { line: SetupModuleLine; onChanged: () => void }) {
	const [busy, setBusy] = useState(false);
	const [over, setOver] = useState(false);
	const [note, setNote] = useState<string | null>(null);
	const [changing, setChanging] = useState(false);
	const [at, setAt] = useState<[number, number] | null>(null);

	// Each file travels by itself (v3.1): several lectures' PDFs together were too big for one request, and one unreadable file lost the rest.
	async function add(files: File[]) {
		if (files.length === 0 || busy) return;
		setBusy(true);
		setNote(null);
		const r = await eachFile(files, (f, i) => {
			setAt([i, files.length]);
			const form = new FormData();
			form.append("file", f);
			return lockedIn.quickMaterials(line.code, form).then((x) => { onChanged(); return x; });
		});
		const skipped = r.done.reduce((n, x) => n + x.skipped, 0);
		const notes = [skipped ? SETUP_COPY.slides.skipped(skipped) : null, r.failed.length ? MATERIALS_COPY.couldNotRead(r.failed) : null].filter(Boolean);
		setNote(notes.length ? notes.join(" ") : null);
		setAt(null);
		setBusy(false);
	}
	const change = async (fn: () => Promise<unknown>) => {
		try {
			await fn();
		} catch (e) {
			setNote(message(e, "Couldn't save that."));
		}
		onChanged();
	};
	const state = line.preparing > 0 ? SETUP_COPY.slides.preparing : line.units > 0 && line.ready === line.units ? SETUP_COPY.slides.ready : null;

	return (
		<Tint module={line.code}>
			<section className="li-stack" style={{ gap: 8 }} aria-label={line.name}>
				<b>{line.name}</b>
				<label
					className="li-drop li-setup-drop"
					data-over={over ? "true" : "false"}
					onDragOver={(e) => { e.preventDefault(); setOver(true); }}
					onDragLeave={() => setOver(false)}
					onDrop={(e) => { e.preventDefault(); setOver(false); void add(Array.from(e.dataTransfer.files)); }}
				>
					<span>{busy ? (at ? MATERIALS_COPY.reading(at[0], at[1]) : SETUP_COPY.slides.reading) : SETUP_COPY.slides.drop}</span>
					{!busy ? <span className="li-small li-muted">{SETUP_COPY.slides.formats}</span> : null}
					<input type="file" multiple accept={MATERIALS_RULES.accept} className="li-sr" disabled={busy} onChange={(e) => { void add(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
				</label>
				{line.units > 0 ? (
					<div className="li-row li-small" aria-live="polite">
						<span style={{ flexGrow: 1 }}><b>{SETUP_COPY.slides.found(line.units)}</b>{state ? <span className="li-muted"> · {state}{line.preparing > 0 ? "…" : ""}</span> : null}</span>
						<button type="button" className="li-link" aria-expanded={changing} onClick={() => setChanging(!changing)}>{changing ? SETUP_COPY.slides.done : SETUP_COPY.slides.change}</button>
					</div>
				) : null}
				{note ? <span className="li-small" role="status">{note}</span> : null}
				{changing ? (
					<div className="li-stack" style={{ gap: 6 }}>
						{line.list.map((u) => (
							<div key={u.id} className="li-row" style={{ gap: 8 }}>
								<input
									className="li-input"
									style={{ flex: "1 1 220px" }}
									aria-label="Chapter title"
									maxLength={SETUP_RULES.unitTitleMax}
									defaultValue={u.title}
									onBlur={(e) => { const t = e.target.value.trim(); if (t && t !== u.title) void change(() => lockedIn.renameUnit(u.id, t)); }}
								/>
								<select className="li-input" style={{ width: "auto" }} aria-label="Week" value={u.week} onChange={(e) => void change(() => lockedIn.setUnitWeek(u.id, Number(e.target.value)))}>
									{u.week === 0 ? <option value={0} disabled>{WEEK_COPY.notSet}</option> : null}
									{WEEKS.map((w) => <option key={w} value={w}>{WEEK_COPY.week(w)}</option>)}
								</select>
								<button type="button" className="li-link li-small" onClick={() => void change(() => lockedIn.removeMaterials(u.id))}>{SETUP_COPY.slides.remove}</button>
							</div>
						))}
					</div>
				) : null}
			</section>
		</Tint>
	);
}

function SlidesStep({ view, reload, onNext, onBack }: { view: SetupView; reload: () => void; onNext: (later: boolean) => void; onBack: () => void }) {
	const units = view.modules.reduce((n, m) => n + m.units, 0);
	// "preparing" turns to "ready" by itself.
	usePoll(reload, SETUP_RULES.pollMs, view.modules.some((m) => m.preparing > 0));
	return (
		<>
			<h1 className="li-h1">{SETUP_COPY.slides.title}</h1>
			<p className="li-muted li-setup-lead">{SETUP_COPY.slides.lead}</p>
			{view.modules.length === 0 ? <p style={{ margin: 0 }}>{SETUP_COPY.slides.noModules}</p> : null}
			{view.modules.map((m) => <SlidesModule key={m.code} line={m} onChanged={reload} />)}
			<AddModule onAdd={reload} />
			<Footer onBack={onBack}>
				{units === 0
					? <button type="button" className="li-btn ghost" onClick={() => onNext(true)}>{SETUP_COPY.later}</button>
					: <button type="button" className="li-btn primary big" onClick={() => onNext(false)}>{SETUP_COPY.next}</button>}
			</Footer>
		</>
	);
}

// ─── step 4: the week ───────────────────────────────────────────────────────

function WeekStep({ view, onNext, onBack }: { view: SetupView; onNext: (later: boolean) => void; onBack: () => void }) {
	const [week, setWeek] = useState<SetupWeek | null>(view.week);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const asked = useRef(0);

	const ask = useCallback(async (body: { energy?: EnergyTime[]; weeklyTargetMinutes?: number }) => {
		const mine = ++asked.current;
		setError(null);
		try {
			const w = await lockedIn.setupWeek(body);
			if (mine === asked.current) setWeek(w);
		} catch (e) {
			if (mine === asked.current) setError(message(e, "Couldn't plan the week. Try again."));
		}
	}, []);
	// The week is suggested as the step opens, at five hours, so there is something to look at before any tap.
	const opened = useRef(false);
	useEffect(() => {
		if (opened.current || view.week) return;
		opened.current = true;
		void ask({});
	}, [ask, view.week]);

	const energy = week?.energy ?? [];
	const target = week?.target ?? SETUP_RULES.defaultTargetMinutes;
	const toggle = (e: EnergyTime) => {
		const next = energy.includes(e) ? energy.filter((x) => x !== e) : [...energy, e];
		setWeek((w) => (w ? { ...w, energy: next } : w));
		void ask({ energy: next });
	};
	const step = (by: number) => {
		const next = Math.min(40 * 60, Math.max(30, target + by));
		if (next === target) return;
		setWeek((w) => (w ? { ...w, target: next } : w));
		void ask({ weeklyTargetMinutes: next });
	};
	async function finish(later: boolean) {
		setBusy(true);
		try {
			if (later) await lockedIn.skipSetupWeek();
			else if (week) await lockedIn.acceptBlocks(week.week);
			onNext(later);
		} catch (e) {
			setError(message(e, "Couldn't save that. Try again."));
			setBusy(false);
		}
	}
	const thisMonday = (() => {
		const d = new Date();
		d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
	})();

	return (
		<>
			<h1 className="li-h1">{SETUP_COPY.week.title}</h1>
			<div className="li-stack" style={{ gap: 10 }}>
				<b id="setup-energy">{SETUP_COPY.week.energy}</b>
				<div className="li-row" role="group" aria-labelledby="setup-energy" style={{ gap: 10 }}>
					{ENERGY_TIMES.map((e) => (
						<button key={e} type="button" className="li-btn li-setup-pick" aria-pressed={energy.includes(e)} onClick={() => toggle(e)}>{SETUP_COPY.week.energies[e]}</button>
					))}
				</div>
			</div>
			<div className="li-stack" style={{ gap: 10 }}>
				<b id="setup-target">{SETUP_COPY.week.target}</b>
				<div className="li-row" role="group" aria-labelledby="setup-target" style={{ gap: 14 }}>
					<button type="button" className="li-btn li-setup-step" aria-label={SETUP_COPY.week.fewer} onClick={() => step(-SETUP_RULES.targetStepMinutes)} disabled={target <= 30}>−</button>
					<b className="li-setup-target" aria-live="polite">{SETUP_COPY.week.hours(target)}</b>
					<button type="button" className="li-btn li-setup-step" aria-label={SETUP_COPY.week.more} onClick={() => step(SETUP_RULES.targetStepMinutes)} disabled={target >= 40 * 60}>+</button>
				</div>
			</div>
			<div className="li-stack" style={{ gap: 8 }} aria-live="polite">
				<b>{SETUP_COPY.week.blocks}</b>
				{week && week.week > thisMonday ? <span className="li-small li-muted">{SETUP_COPY.week.nextWeek}</span> : null}
				{week?.message ? <span className="li-small">{week.message}</span> : null}
				{(week?.blocks ?? []).map((b) => (
					<Tint key={b.id} module={b.module ?? "free"}>
						<div className="li-setup-block">
							<b className="li-setup-when">{dayLabel(b.date)} · {b.start}</b>
							<span style={{ flexGrow: 1, minWidth: 0 }}>
								{b.title ?? SETUP_COPY.week.freeStudy}
								{b.why ? <span className="li-small li-muted" style={{ display: "block" }}>{b.why}</span> : null}
							</span>
							<span className="li-small li-muted" style={{ whiteSpace: "nowrap" }}>{b.minutes} min</span>
						</div>
					</Tint>
				))}
			</div>
			{error ? <div className="li-note" role="alert">{error}</div> : null}
			<Footer onBack={onBack}>
				<button type="button" className="li-btn ghost" onClick={() => void finish(true)} disabled={busy}>{SETUP_COPY.later}</button>
				<button type="button" className="li-btn primary big" onClick={() => void finish(false)} disabled={busy || !week || week.blocks.length === 0}>{SETUP_COPY.week.looksGood}</button>
			</Footer>
		</>
	);
}

// ─── step 5: the phone ──────────────────────────────────────────────────────

function PhoneStep({ view, reload, onNext, onBack }: { view: SetupView; reload: () => void; onNext: (later: boolean) => void; onBack: () => void }) {
	usePoll(reload, 3_000, !view.phone.paired);
	return (
		<>
			<h1 className="li-h1">{SETUP_COPY.phone.title}</h1>
			<p className="li-muted li-setup-lead">{SETUP_COPY.phone.lead}</p>
			<PhoneSection />
			<Footer onBack={onBack}>
				{view.phone.paired
					? <button type="button" className="li-btn primary big" onClick={() => onNext(false)}>{SETUP_COPY.phone.finish}</button>
					: <button type="button" className="li-btn ghost" onClick={() => onNext(true)}>{SETUP_COPY.later}</button>}
			</Footer>
		</>
	);
}

function Footer({ children, onBack }: { children: React.ReactNode; onBack?: () => void }) {
	return (
		<div className="li-row li-setup-foot">
			{onBack ? <button type="button" className="li-btn ghost" onClick={onBack}>‹ {SETUP_COPY.back}</button> : null}
			<span style={{ flexGrow: 1 }} />
			{children}
		</div>
	);
}

// ─── the screen ─────────────────────────────────────────────────────────────

export function WelcomeScreen() {
	const router = useRouter();
	const [view, setView] = useState<SetupView | null>(null);
	const [step, setStep] = useState(1);
	const [aiReady, setAiReady] = useState(false);
	const [ended, setEnded] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const reload = useCallback(() => {
		lockedIn.setup().then(setView).catch(() => undefined);
	}, []);
	useEffect(() => {
		lockedIn.setup().then((s) => {
			if (s.done) return router.replace("/app");
			setView(s);
			setStep(s.step);
		}).catch((e) => setError(message(e, "Couldn't open setup. Reload the page.")));
	}, [router]);

	const steps = view?.phone.available === false ? SETUP_RULES.steps - 1 : SETUP_RULES.steps;
	const shown = !!view && !ended;
	useEffect(() => { if (shown) void lockedIn.event("onboarding_step", { step, flow: "v2.0" }); }, [step, shown]);

	/** Move to a step; past the last one, setup ends. `later`: the step was left for later. */
	const go = useCallback(async (to: number, later = false) => {
		setError(null);
		if (later) void lockedIn.event("onboarding_step", { step, flow: "v2.0", later: true });
		try {
			if (to > steps) {
				setView(await lockedIn.setupDone());
				setEnded(true);
				return;
			}
			if (to >= 2 && view?.started) setView(await lockedIn.setupStep(to));
			setStep(to);
		} catch (e) {
			setError(message(e, "Something went wrong. Try again."));
		}
	}, [step, steps, view?.started]);

	// With no phone relay on this laptop there is no phone step: setup ends after the week.
	useEffect(() => { if (shown && step > steps) void go(step); }, [shown, step, steps, go]);

	async function saveTimetable(body: Parameters<typeof lockedIn.setupTimetable>[0], later: boolean) {
		setBusy(true);
		setError(null);
		try {
			if (later) void lockedIn.event("onboarding_step", { step: 2, flow: "v2.0", later: true });
			const s = await lockedIn.setupTimetable(body);
			setView(s);
			setStep(s.step);
		} catch (e) {
			setError(message(e, "Something went wrong. Try again."));
		} finally {
			setBusy(false);
		}
	}

	async function learn() {
		if (!view?.end) return;
		setBusy(true);
		try {
			const { sessionId } = await lockedIn.startLearn({ lectureId: view.end.lectureId });
			router.push(`/app/session/${sessionId}`);
		} catch (e) {
			setError(message(e, "Couldn't start that. You can start it from Today."));
			setBusy(false);
		}
	}

	return (
		<div className="li-setup">
			<div className="li-row">
				<span className="li-row" style={{ gap: 10, flexGrow: 1 }}><Logo /><b className="li-display" style={{ fontSize: 20 }}>LockedIn</b></span>
				{view && !ended ? (
					<>
						<span className="li-small li-muted">{SETUP_COPY.stepOf(Math.min(step, steps), steps)}</span>
						<span aria-hidden="true" className="li-row" style={{ gap: 6 }}>{Array.from({ length: steps }, (_, i) => <span key={i} className="li-setup-bar" data-on={i < step ? "true" : "false"} />)}</span>
					</>
				) : null}
			</div>

			<section className="li-card li-setup-card">
				{!view && !error ? <p className="li-muted" aria-live="polite">…</p> : null}

				{view && ended ? (
					<>
						<h1 className="li-h1">{SETUP_COPY.end.title}</h1>
						{view.end ? (
							<Tint module={view.end.module}>
								<button type="button" className="li-hero" onClick={() => void learn()} disabled={busy}>
									<span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
										<span className="li-hero-title">{SETUP_COPY.end.learn(view.end.title)}</span>
										<span style={{ opacity: 0.9 }}>{SETUP_COPY.end.learnLead}</span>
									</span>
									<span className="li-hero-cta">{busy ? "Starting…" : "Start"}</span>
								</button>
							</Tint>
						) : (
							<>
								<p className="li-muted li-setup-lead">{SETUP_COPY.end.noSlides}</p>
								<button type="button" className="li-btn primary big" style={{ alignSelf: "flex-start" }} onClick={() => router.push("/app/library")}>{SETUP_COPY.end.addSlides}</button>
							</>
						)}
						<button type="button" className="li-btn ghost" style={{ alignSelf: "flex-start" }} onClick={() => router.push("/app")}>{SETUP_COPY.end.today}</button>
					</>
				) : null}

				{view && !ended && step === 1 ? (
					<>
						<h1 className="li-h1">{SETUP_COPY.signIn.title}</h1>
						<p className="li-muted li-setup-lead">{SETUP_COPY.signIn.lead}</p>
						<ConnectAi variant="setup" onReadyChange={setAiReady} />
						<Footer>
							<button type="button" className="li-btn primary big" disabled={!aiReady} onClick={() => void go(2)}>{SETUP_COPY.next}</button>
						</Footer>
					</>
				) : null}
				{view && !ended && step === 2 ? <TimetableStep view={view} busy={busy} onSave={(body, later) => void saveTimetable(body, later)} /> : null}
				{view && !ended && step === 3 ? <SlidesStep view={view} reload={reload} onNext={(later) => void go(4, later)} onBack={() => void go(2)} /> : null}
				{view && !ended && step === 4 ? <WeekStep view={view} onNext={(later) => void go(5, later)} onBack={() => void go(3)} /> : null}
				{view && !ended && step === 5 ? <PhoneStep view={view} reload={reload} onNext={(later) => void go(6, later)} onBack={() => void go(4)} /> : null}

				{error ? <div className="li-note" role="alert">{error}</div> : null}
			</section>

			{view && !ended && (step === 2 || step === 3) ? (
				<details className="li-small li-setup-reads">
					<summary>{SETUP_COPY.reads.label}</summary>
					<ul>{SETUP_COPY.reads.lines.map((l) => <li key={l}>{l}</li>)}</ul>
				</details>
			) : null}
		</div>
	);
}
