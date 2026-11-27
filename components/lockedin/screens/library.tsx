"use client";

/**
 * Library (v0.1 V-18): each module's course units grouped by teaching
 * week, the module's current week ("this is week N", reading weeks), and
 * "Add course material" for any shape of material (F-104).
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LEARN_COPY, NOTE_COPY, PRACTISE_COPY, SHARE_COPY, WEEK_SHARES, weekLabel, type WeekShare } from "@/src/core";
import { AddModule } from "../add-module";
import { ApiError, lockedIn, type CourseModule, type LectureWithStatus } from "../api";
import { fmtDay, useData } from "../hooks";
import { Icon, ModuleMark, StatusTag } from "../icons";
import { LearnSheet } from "../learn-sheet";
import { MaterialUpload } from "../material-upload";
import { ModuleNotes } from "../module-notes";
import { Tint, useLockedIn } from "../root";
import { SetWeek } from "../set-week";
import { PageHead } from "../shell";

const WEEKS = Array.from({ length: 20 }, (_, i) => i + 1);

function WeekControl({ mod, onChange }: { mod: CourseModule; onChange: () => void }) {
	const [open, setOpen] = useState(false);
	const [week, setWeek] = useState<number>(mod.week ?? 1);
	const [reading, setReading] = useState((mod.readingWeeks ?? []).join(", "));
	const [inReading, setInReading] = useState(mod.reading);
	const [error, setError] = useState<string | null>(null);

	async function save() {
		setError(null);
		const readingWeeks = reading.split(/[\s,]+/).filter(Boolean).map(Number);
		if (readingWeeks.some((w) => !Number.isInteger(w) || w < 1 || w > 52)) return setError("Reading weeks are week numbers, e.g. 6");
		try {
			await lockedIn.setModuleWeek(mod.code, { week, readingWeeks, inReadingWeek: inReading });
			setOpen(false);
			onChange();
		} catch (e) {
			setError(e instanceof ApiError ? e.message : "Couldn't save that");
		}
	}

	const label = mod.week === null ? "Set this week" : mod.reading ? `Reading week (after week ${mod.week})` : `Week ${mod.week}`;
	if (!open) return <button type="button" className="li-chip" onClick={() => setOpen(true)} aria-label={`${mod.name}: ${label}. Change`}>{label}</button>;
	return (
		<div className="li-card flat li-row" style={{ gap: 10, padding: 12 }}>
			<label className="li-row" style={{ gap: 6 }}>This is week <select className="li-input" style={{ width: "auto" }} value={week} onChange={(e) => setWeek(Number(e.target.value))}>{WEEKS.map((w) => <option key={w} value={w}>{w}</option>)}</select></label>
			<label className="li-row" style={{ gap: 6 }}><input type="checkbox" checked={inReading} onChange={(e) => setInReading(e.target.checked)} /> and it&apos;s a reading week</label>
			<label className="li-row" style={{ gap: 6 }}>Reading weeks after week <input className="li-input" style={{ width: 90 }} value={reading} onChange={(e) => setReading(e.target.value)} placeholder="e.g. 6" /></label>
			<button type="button" className="li-btn primary" onClick={save}>Save</button>
			<button type="button" className="li-btn" onClick={() => setOpen(false)}>Cancel</button>
			{error ? <span className="li-small" role="alert">{error}</span> : null}
		</div>
	);
}

/** A module's share of the week (V-63): one tap, never hours. The week's blocks follow it the next time they are suggested. */
function ShareControl({ mod, onChange, onError }: { mod: CourseModule; onChange: () => void; onError: (m: string) => void }) {
	const current: WeekShare = mod.share ?? "normal";
	const set = async (share: WeekShare) => {
		if (share === current) return;
		try {
			await lockedIn.setModuleShare(mod.code, share);
			onChange();
		} catch (e) {
			onError(e instanceof ApiError ? e.message : "Couldn't save that");
		}
	};
	return (
		<span className="li-weekshare li-small">
			<span className="li-muted" id={`share-${mod.code}`}>{SHARE_COPY.label}</span>
			<span className="li-seg" role="group" aria-labelledby={`share-${mod.code}`}>
				{WEEK_SHARES.map((s) => <button key={s} type="button" aria-pressed={current === s} onClick={() => void set(s)}>{SHARE_COPY[s]}</button>)}
			</span>
		</span>
	);
}

export function LibraryScreen() {
	const router = useRouter();
	const practise = async (code: string) => {
		try {
			const { sessionId } = await lockedIn.startPractise(code);
			router.push(`/app/session/${sessionId}`);
		} catch (e) {
			setMsg(e instanceof ApiError ? e.message : "Couldn't start that");
		}
	};
	const { now } = useLockedIn();
	const [q, setQ] = useState("");
	const [adding, setAdding] = useState<string | null>(null);
	const [learning, setLearning] = useState<string | null>(null);
	const [knowing, setKnowing] = useState<string | null>(null);
	const [msg, setMsg] = useState<string | null>(null);
	const course = useData(() => lockedIn.course());
	const search = useData(() => (q.trim() ? lockedIn.lectures(q.trim()) : Promise.resolve(null)), [q]);

	// "Learn this" starts at once: the topic is already known (step 5).
	async function learn(lectureId: string) {
		try {
			const { sessionId } = await lockedIn.startLearn({ lectureId });
			router.push(`/app/session/${sessionId}`);
		} catch (e) {
			setMsg(e instanceof ApiError ? e.message : "Couldn't start that");
		}
	}

	const hits = search.data ? new Set(search.data.map((l) => l.id)) : null;
	const modules = course.data ?? [];

	const unitRow = (l: LectureWithStatus) => (
		<div key={l.id} className="li-tl">
			<span className="li-tl-time">{l.week > 0 || l.start ? weekLabel(l.week) : <SetWeek lectureId={l.id} title={l.title} onSaved={() => void course.reload()} />}</span>
			<span style={{ flexGrow: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
				<Link href={`/app/library/${l.id}`}><b>{l.title}</b></Link>
				<span className="li-small li-muted">{l.start ? fmtDay(l.start, now) : "From your course material"}{l.attended === false ? " · you weren't there" : ""}{l.hasMaterials ? "" : " · no material yet"}</span>
			</span>
			{l.status === "revisit" ? <StatusTag status="revisit" /> : l.status === "answered" ? <StatusTag status="answered" /> : <StatusTag status="notyet" />}
			<Link className="li-btn soft" href={`/app/library/${l.id}`}>Open</Link>
			<button type="button" className="li-btn" disabled={!l.hasMaterials} onClick={() => void learn(l.id)}><Icon.learn />{LEARN_COPY.button}</button>
		</div>
	);

	return (
		<>
			<PageHead eyebrow="Library" title="Your course">
				<label className="li-row" style={{ marginTop: 12, maxWidth: 520, gap: 0, position: "relative" }}>
					<span className="li-sr">Search units and slides</span>
					<span style={{ position: "absolute", left: 14, color: "var(--li-muted)" }}><Icon.search /></span>
					<input className="li-input" style={{ paddingLeft: 44 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your course and slides, e.g. ethnography" />
				</label>
				{/* A module the timetable doesn't know about (V-64): a name is enough. */}
				<div style={{ marginTop: 12 }}><AddModule onAdd={() => void course.reload()} /></div>
			</PageHead>
			{msg ? <div className="li-note" role="status">{msg}</div> : null}
			{course.error ? <div className="li-card">Couldn&apos;t load your course: {course.error.message}</div> : null}
			{modules.map((m) => {
				const shown = hits ? m.units.filter((l) => hits.has(l.id)) : m.units;
				if (hits && shown.length === 0) return null;
				const weeks = [...new Set(shown.map((u) => u.week))].sort((a, b) => (a || 99) - (b || 99));
				return (
					<Tint key={m.code} module={m.code}>
						<section className="li-stack" aria-labelledby={`m-${m.code}`}>
							<div className="li-row">
								<ModuleMark module={m.code} />
								<h2 id={`m-${m.code}`} className="li-h2" style={{ flexGrow: 1 }}>{m.name}</h2>
								<WeekControl key={`${m.code}-${m.week}-${m.reading}`} mod={m} onChange={() => void course.reload()} />
								<span className="li-small li-muted">{m.units.filter((l) => l.status !== "not-started").length} of {m.units.length} started</span>
								{/* A quick round across the whole module (V-40): only once a unit has material to draw questions from. */}
								{/* The two ways to study a module (V-40): the tutor, or a quick round. Each needs a unit with material. */}
								{!hits && m.units.some((l) => l.hasMaterials) ? <button type="button" className="li-btn" aria-expanded={learning === m.code} onClick={() => setLearning(learning === m.code ? null : m.code)}>{LEARN_COPY.moduleButton}</button> : null}
								{!hits && m.units.some((l) => l.hasMaterials) ? <button type="button" className="li-btn" onClick={() => void practise(m.code)}>{PRACTISE_COPY.button}</button> : null}
								{!hits ? <button type="button" className="li-btn" onClick={() => setAdding(adding === m.code ? null : m.code)}>Add course material</button> : null}
							</div>
							{/* What the app holds about you here (V-53): one quiet link, closed until asked for. */}
							{!hits ? (
								<div className="li-row" style={{ gap: 16 }}>
									{m.units.some((l) => l.hasMaterials) ? <button type="button" className="li-btn ghost li-small" aria-expanded={knowing === m.code} onClick={() => setKnowing(knowing === m.code ? null : m.code)}>{NOTE_COPY.link} ›</button> : null}
									<span style={{ flexGrow: 1 }} />
									<ShareControl mod={m} onChange={() => void course.reload()} onError={setMsg} />
								</div>
							) : null}
							{knowing === m.code ? <ModuleNotes code={m.code} onClose={() => setKnowing(null)} /> : null}
							{learning === m.code ? <LearnSheet code={m.code} onClose={() => setLearning(null)} onPractise={() => void practise(m.code)} /> : null}
							{adding === m.code ? (
								<MaterialUpload code={m.code} name={m.name} onClose={() => setAdding(null)} onSaved={(n) => { setAdding(null); setMsg(`${n} ${n === 1 ? "unit" : "units"} added to ${m.name}.`); void course.reload(); }} />
							) : null}
							{shown.length === 0 && adding !== m.code ? (
								<div className="li-card li-empty">Nothing here yet. Add your slides, notes or a whole semester&apos;s material, and I&apos;ll split it into units.</div>
							) : null}
							{shown.length ? (
								<div className="li-card" style={{ padding: "8px 24px" }}>
									{weeks.map((w) => (
										<div key={w}>
											{weeks.length > 1 ? <div className="li-eyebrow" style={{ marginTop: 12 }}>{weekLabel(w)}{w > 0 && m.week === w ? " · this week" : ""}</div> : null}
											{shown.filter((u) => u.week === w).map(unitRow)}
										</div>
									))}
								</div>
							) : null}
						</section>
					</Tint>
				);
			})}
		</>
	);
}
