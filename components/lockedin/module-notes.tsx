"use client";

/**
 * "What LockedIn knows" (v2.0 step 6; V-53): the three short notes kept per
 * module, behind a quiet link in the Library and closed by default. How you
 * learn it, where you are in it, and the last session's plan and where it
 * stopped. The first two can be edited; the tutor reads all three at the
 * start of a session. Showing what the app holds is a rule, not a nicety
 * (R-7, AFF-H).
 */

import { useState } from "react";
import { NOTE_COPY, NOTE_RULES, wordCount, type ModuleNotesView } from "@/src/core";
import { ApiError, lockedIn } from "./api";
import { fmtDay, useData } from "./hooks";
import { useLockedIn } from "./root";

function Note({ title, text, empty, meta, max, onSave }: { title: string; text: string | null; empty: string; meta?: string; max: number; onSave: (text: string) => Promise<void> }) {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState("");
	const [error, setError] = useState<string | null>(null);
	const over = wordCount(draft) > max;
	async function save() {
		try {
			await onSave(draft);
			setEditing(false);
			setError(null);
		} catch (e) {
			setError(e instanceof ApiError ? e.message : "That didn't save");
		}
	}
	return (
		<section className="li-stack" style={{ gap: 6 }}>
			<div className="li-row">
				<b style={{ flexGrow: 1 }}>{title}{meta ? <span className="li-small li-muted" style={{ fontWeight: 400 }}> · {meta}</span> : null}</b>
				{editing ? null : <button type="button" className="li-btn ghost" aria-label={`${NOTE_COPY.edit}: ${title}`} onClick={() => { setDraft(text ?? ""); setEditing(true); }}>{NOTE_COPY.edit}</button>}
			</div>
			{editing ? (
				<>
					<textarea className="li-input" rows={4} value={draft} aria-label={title} onChange={(e) => setDraft(e.target.value)} />
					{over || error ? <span className="li-small" role="alert">{over ? NOTE_COPY.tooLong(max) : error}</span> : null}
					<div className="li-row" style={{ gap: 8 }}>
						<button type="button" className="li-btn primary" disabled={over} onClick={() => void save()}>{NOTE_COPY.save}</button>
						<button type="button" className="li-btn" onClick={() => setEditing(false)}>{NOTE_COPY.cancel}</button>
					</div>
				</>
			) : (
				<p className={text ? undefined : "li-muted"} style={{ margin: 0, whiteSpace: "pre-line" }}>{text ?? empty}</p>
			)}
		</section>
	);
}

export function ModuleNotes({ code, onClose }: { code: string; onClose: () => void }) {
	const { now } = useLockedIn();
	const notes = useData(() => lockedIn.notes(code), [code]);
	const d = notes.data;
	if (!d) return <div className="li-card" role="status">{notes.error ? "Couldn't load this. Reload the page." : "Loading…"}</div>;
	const save = async (body: { how?: string; where?: string }) => { notes.setData(await lockedIn.saveNote(code, body)); };
	const last: ModuleNotesView["last"] = d.last;
	const marks = { done: "✓", current: "●", todo: "○" } as const;
	return (
		<div className="li-card li-stack" role="region" aria-label={NOTE_COPY.title(d.module.name)} style={{ gap: 18 }}>
			<div className="li-row">
				<h3 className="li-h2" style={{ flexGrow: 1 }}>{NOTE_COPY.title(d.module.name)}</h3>
				<button type="button" className="li-btn ghost" aria-label="Close" onClick={onClose}>✕</button>
			</div>
			<Note title={NOTE_COPY.how} text={d.how?.text ?? null} empty={NOTE_COPY.noHow} max={NOTE_RULES.howWords} onSave={(text) => save({ how: text })} />
			<Note title={NOTE_COPY.where} text={d.where?.text ?? null} empty={NOTE_COPY.noWhere} max={NOTE_RULES.whereWords}
				meta={d.where ? (d.where.by === "you" ? NOTE_COPY.byYou : NOTE_COPY.updated(fmtDay(d.where.at, now))) : undefined} onSave={(text) => save({ where: text })} />
			<section className="li-stack" style={{ gap: 6 }}>
				<b>{NOTE_COPY.last}</b>
				{last ? (
					<>
						<p style={{ margin: 0 }}>{last.finished ? NOTE_COPY.finishedAt(last.lecture) : NOTE_COPY.stoppedAt(last.index, last.total, last.title, last.lecture)}</p>
						{last.plan.length ? <p className="li-small li-muted" style={{ margin: 0 }}>{last.plan.map((n, i) => <span key={i}>{i > 0 ? " · " : ""}{marks[n.state]} {n.title}</span>)}</p> : null}
					</>
				) : <p className="li-muted" style={{ margin: 0 }}>{NOTE_COPY.noLast}</p>}
			</section>
			<span className="li-small li-muted">{NOTE_COPY.readBy}</span>
		</div>
	);
}
