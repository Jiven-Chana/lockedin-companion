"use client";

/**
 * Library (v0.1 V-18): each module's course units grouped by teaching
 * week, the module's current week ("this is week N", reading weeks), and
 * "Add course material" for any shape of material (F-104).
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { moduleHue } from "@/src/core";
import { ApiError, lockedIn, type CourseModule, type LectureWithStatus } from "../api";
import { fmtDay, useData } from "../hooks";
import { Icon, StatusTag } from "../icons";
import { MaterialUpload } from "../material-upload";
import { Tint, useLockedIn } from "../root";
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

export function LibraryScreen() {
	const router = useRouter();
	const { now } = useLockedIn();
	const [q, setQ] = useState("");
	const [adding, setAdding] = useState<string | null>(null);
	const [msg, setMsg] = useState<string | null>(null);
	const course = useData(() => lockedIn.course());
	const search = useData(() => (q.trim() ? lockedIn.lectures(q.trim()) : Promise.resolve(null)), [q]);

	async function quiz(lectureId: string) {
		const { sessionId } = await lockedIn.startSession({ kind: "post-lecture", lectureId });
		router.push(`/app/session/${sessionId}`);
	}

	const hits = search.data ? new Set(search.data.map((l) => l.id)) : null;
	const modules = course.data ?? [];

	const unitRow = (l: LectureWithStatus) => (
		<div key={l.id} className="li-tl">
			<span className="li-tl-time">{l.week > 0 ? `Week ${l.week}` : "—"}</span>
			<span style={{ flexGrow: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
				<Link href={`/app/library/${l.id}`}><b>{l.title}</b></Link>
				<span className="li-small li-muted">{l.start ? fmtDay(l.start, now) : "From your course material"}{l.attended === false ? " · you weren't there" : ""}{l.hasMaterials ? "" : " · no material yet"}</span>
			</span>
			{l.status === "revisit" ? <StatusTag status="revisit" /> : l.status === "answered" ? <StatusTag status="answered" /> : <StatusTag status="notyet" />}
			<Link className="li-btn soft" href={`/app/library/${l.id}`}>Open</Link>
			<button type="button" className="li-btn primary" disabled={!l.hasMaterials} onClick={() => quiz(l.id)}>Quiz me</button>
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
			</PageHead>
			{msg ? <div className="li-note" role="status">{msg}</div> : null}
			{course.error ? <div className="li-card">Couldn&apos;t load your course: {course.error.message}</div> : null}
			{modules.map((m) => {
				const shown = hits ? m.units.filter((l) => hits.has(l.id)) : m.units;
				if (hits && shown.length === 0) return null;
				const weeks = [...new Set(shown.map((u) => u.week))].sort((a, b) => (a || 99) - (b || 99));
				return (
					<Tint key={m.code} hue={moduleHue(m.code)}>
						<section className="li-stack" aria-labelledby={`m-${m.code}`}>
							<div className="li-row">
								<span style={{ width: 14, height: 14, borderRadius: 5, background: "var(--li-accent)" }} />
								<h2 id={`m-${m.code}`} className="li-h2" style={{ flexGrow: 1 }}>{m.name}</h2>
								<WeekControl key={`${m.code}-${m.week}-${m.reading}`} mod={m} onChange={() => void course.reload()} />
								<span className="li-small li-muted">{m.units.filter((l) => l.status !== "not-started").length} of {m.units.length} started</span>
								{!hits ? <button type="button" className="li-btn" onClick={() => setAdding(adding === m.code ? null : m.code)}>Add course material</button> : null}
							</div>
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
											{weeks.length > 1 ? <div className="li-eyebrow" style={{ marginTop: 12 }}>{w > 0 ? `Week ${w}${m.week === w ? " · this week" : ""}` : "Week unknown"}</div> : null}
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
