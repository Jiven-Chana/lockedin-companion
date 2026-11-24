"use client";

/**
 * Add course material to a module (v0.1 F-104, V-18): drop files or paste
 * text → LockedIn proposes course units (by file name, by "Week N"
 * headings, or the AI) → one list to fix titles, weeks and what to keep →
 * Save. Nothing becomes course material until Save.
 */

import { useState } from "react";
import { ApiError, lockedIn, type MaterialProposal } from "./api";

interface Row { file: number; title: string; week: number; pages: [number, number]; keep: boolean }

const WEEKS = Array.from({ length: 20 }, (_, i) => i + 1);

export function MaterialUpload({ code, name, onSaved, onClose }: { code: string; name: string; onSaved: (n: number) => void; onClose: () => void }) {
	const [files, setFiles] = useState<File[]>([]);
	const [text, setText] = useState("");
	const [proposal, setProposal] = useState<MaterialProposal | null>(null);
	const [rows, setRows] = useState<Row[]>([]);
	const [busy, setBusy] = useState<null | "reading" | "saving">(null);
	const [error, setError] = useState<string | null>(null);
	const [over, setOver] = useState(false);

	async function propose() {
		setBusy("reading");
		setError(null);
		try {
			const form = new FormData();
			for (const f of files) form.append("file", f);
			if (text.trim()) {
				form.append("text", text);
				form.append("name", `${name} notes`);
			}
			const p = await lockedIn.proposeMaterials(code, form);
			setProposal(p);
			setRows(p.files.flatMap((f) => f.units.map((u) => ({ file: f.file, title: u.title, week: u.week, pages: u.pages, keep: true }))));
		} catch (e) {
			setError(e instanceof ApiError ? e.message : "Couldn't read those files.");
		} finally {
			setBusy(null);
		}
	}

	async function save() {
		if (!proposal) return;
		setBusy("saving");
		setError(null);
		try {
			const units = rows.filter((r) => r.keep && r.title.trim()).map(({ keep: _k, ...r }) => ({ ...r, title: r.title.trim() }));
			const r = await lockedIn.saveMaterials(code, { uploadId: proposal.uploadId, units });
			void lockedIn.event("settings_changed", { changed: ["materials"], module: code, units: r.units.length });
			onSaved(r.units.length);
		} catch (e) {
			setError(e instanceof ApiError ? e.message : "Couldn't save. Try again.");
		} finally {
			setBusy(null);
		}
	}

	const set = (i: number, patch: Partial<Row>) => setRows((all) => all.map((r, j) => (j === i ? { ...r, ...patch } : r)));

	if (!proposal) {
		return (
			<div className="li-card li-stack" style={{ gap: 14 }}>
				<div className="li-row"><b style={{ flexGrow: 1 }}>Add course material to {name}</b><button type="button" className="li-btn" onClick={onClose}>Close</button></div>
				<label
					className="li-drop"
					data-over={over ? "true" : "false"}
					onDragOver={(e) => { e.preventDefault(); setOver(true); }}
					onDragLeave={() => setOver(false)}
					onDrop={(e) => { e.preventDefault(); setOver(false); setFiles((f) => [...f, ...Array.from(e.dataTransfer.files)]); }}
				>
					<b>Drop slides or notes here, or click to choose</b>
					<span className="li-small li-muted">PDF, Markdown or text · 25 MB each · one lecture, one week, or a whole semester</span>
					<input type="file" multiple accept=".pdf,.md,.markdown,.txt,application/pdf,text/plain,text/markdown" className="li-sr" onChange={(e) => setFiles((f) => [...f, ...Array.from(e.target.files ?? [])])} />
				</label>
				{files.length ? (
					<ul style={{ margin: 0, paddingLeft: "1.2em" }}>
						{files.map((f, i) => <li key={`${f.name}-${i}`}>{f.name} <button type="button" className="li-link" onClick={() => setFiles((all) => all.filter((_, j) => j !== i))}>remove</button></li>)}
					</ul>
				) : null}
				<label className="li-stack" style={{ gap: 6 }}>
					<span className="li-small"><b>Or paste text</b>, e.g. the weekly summaries from Canvas</span>
					<textarea className="li-input" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Week 1: …" />
				</label>
				{error ? <div className="li-note" role="alert">{error}</div> : null}
				<button type="button" className="li-btn primary" style={{ alignSelf: "flex-start" }} disabled={busy !== null || (files.length === 0 && !text.trim())} onClick={propose}>
					{busy === "reading" ? "Reading your material…" : "Continue"}
				</button>
			</div>
		);
	}

	return (
		<div className="li-card li-stack" style={{ gap: 14 }}>
			<div className="li-row"><b style={{ flexGrow: 1 }}>Check the units for {name}</b><button type="button" className="li-btn" onClick={onClose} disabled={busy !== null}>Cancel</button></div>
			<span className="li-small li-muted">Each unit is something you&apos;ll study on its own, usually one lecture or one week. Fix any title or week, and untick anything you don&apos;t need.</span>
			{proposal.files.map((f) => (
				<div key={f.file} className="li-stack" style={{ gap: 8 }}>
					<span className="li-small">
						<b>{f.name}</b> · {f.pageCount} {f.pageCount === 1 ? "page" : "pages"}
						{f.via === "ai" ? " · split by your AI" : f.via === "name" ? " · split by its week labels" : ""}
						{f.noText.length ? ` · no text found on ${f.noText.length === 1 ? "page" : "pages"} ${f.noText.join(", ")}` : ""}
					</span>
					{f.note ? <span className="li-note li-small">{f.note}</span> : null}
					{rows.map((r, i) =>
						r.file !== f.file ? null : (
							<div key={i} className="li-row li-opt" style={{ gap: 10, flexWrap: "wrap" }}>
								<input type="checkbox" checked={r.keep} onChange={(e) => set(i, { keep: e.target.checked })} aria-label={`Keep ${r.title}`} />
								<input className="li-input" style={{ flex: "1 1 240px" }} value={r.title} onChange={(e) => set(i, { title: e.target.value })} aria-label="Unit title" />
								<select className="li-input" style={{ width: "auto" }} value={r.week} onChange={(e) => set(i, { week: Number(e.target.value) })} aria-label="Week">
									<option value={0}>Week unknown</option>
									{WEEKS.map((w) => <option key={w} value={w}>Week {w}</option>)}
								</select>
								<span className="li-small li-muted">{r.pages[0] === r.pages[1] ? `p. ${r.pages[0]}` : `pp. ${r.pages[0]}–${r.pages[1]}`}</span>
							</div>
						),
					)}
				</div>
			))}
			{error ? <div className="li-note" role="alert">{error}</div> : null}
			<button type="button" className="li-btn primary" style={{ alignSelf: "flex-start" }} disabled={busy !== null || !rows.some((r) => r.keep && r.title.trim())} onClick={save}>
				{busy === "saving" ? "Saving…" : `Save ${rows.filter((r) => r.keep).length} units`}
			</button>
		</div>
	);
}
