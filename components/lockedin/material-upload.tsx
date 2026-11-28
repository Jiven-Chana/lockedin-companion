"use client";

/**
 * Add course material to a module (v0.1 F-104, V-18): drop files or paste
 * text → LockedIn proposes course units (by file name, by "Week N"
 * headings, or the AI) → one list to fix titles, weeks and what to keep →
 * Save. Nothing becomes course material until Save.
 */

import { useCallback, useState } from "react";
import { MATERIALS_COPY, MATERIALS_RULES, PACK_COPY, WEEK_COPY, eachFile } from "@/src/core";
import { ApiError, lockedIn, type MaterialProposal } from "./api";
import { MicButton, useMic } from "./mic";

/** `short`: too little text to study from (V-24), so the unit can't be kept. */
/** `upload`: which request the file went in. Each file travels by itself (v3.1), so each has its own held upload. */
interface Row { upload: string; file: number; title: string; week: number; pages: [number, number]; keep: boolean; short: boolean }

const WEEKS = Array.from({ length: 20 }, (_, i) => i + 1);

export function MaterialUpload({ code, name, onSaved, onClose }: { code: string; name: string; onSaved: (n: number) => void; onClose: () => void }) {
	const [files, setFiles] = useState<File[]>([]);
	const [text, setText] = useState("");
	const mic = useMic(useCallback((t: string) => setText((x) => (x ? `${x.trimEnd()} ${t}` : t)), []), "paste");
	const [proposals, setProposals] = useState<MaterialProposal[] | null>(null);
	const [at, setAt] = useState<[number, number] | null>(null);
	const [notAdded, setNotAdded] = useState<{ name: string; error: string }[]>([]);
	const [rows, setRows] = useState<Row[]>([]);
	const [busy, setBusy] = useState<null | "reading" | "saving">(null);
	const [error, setError] = useState<string | null>(null);
	const [over, setOver] = useState(false);

	async function propose() {
		setBusy("reading");
		setError(null);
		setNotAdded([]);
		// One request a file (v3.1): the total size never matters, and a file that cannot be read is named while the others are kept.
		const parts: { name: string; fill: (form: FormData) => void }[] = [
			...files.map((f) => ({ name: f.name, fill: (form: FormData) => form.append("file", f) })),
			...(text.trim() ? [{ name: `${name} notes`, fill: (form: FormData) => { form.append("text", text); form.append("name", `${name} notes`); } }] : []),
		];
		const r = await eachFile(parts, (part, i) => {
			setAt([i, parts.length]);
			const form = new FormData();
			part.fill(form);
			return lockedIn.proposeMaterials(code, form);
		});
		setAt(null);
		setBusy(null);
		const failed = [...r.failed, ...r.done.flatMap((p) => p.failed ?? [])];
		setNotAdded(failed);
		if (r.done.length === 0) return setError(failed.length ? MATERIALS_COPY.couldNotRead(failed) : "Couldn't read those files.");
		setProposals(r.done);
		setRows(r.done.flatMap((p) => p.files.flatMap((f) => f.units.map((u) => {
			const short = u.chars < MATERIALS_RULES.minUnitChars;
			return { upload: p.uploadId, file: f.file, title: u.title, week: u.week, pages: u.pages, keep: !short, short };
		}))));
	}

	async function save() {
		if (!proposals) return;
		setBusy("saving");
		setError(null);
		try {
			let saved = 0;
			for (const p of proposals) {
				const units = rows.filter((r) => r.upload === p.uploadId && r.keep && !r.short && r.title.trim()).map(({ keep: _k, short: _s, upload: _u, ...r }) => ({ ...r, title: r.title.trim() }));
				if (units.length) saved += (await lockedIn.saveMaterials(code, { uploadId: p.uploadId, units })).units.length;
			}
			onSaved(saved);
		} catch (e) {
			setError(e instanceof ApiError ? e.message : "Couldn't save. Try again.");
		} finally {
			setBusy(null);
		}
	}

	const set = (i: number, patch: Partial<Row>) => setRows((all) => all.map((r, j) => (j === i ? { ...r, ...patch } : r)));

	if (!proposals) {
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
					<b>{MATERIALS_COPY.drop}</b>
					<span className="li-small li-muted">{MATERIALS_COPY.formats} · 25 MB each · one lecture, one week, or a whole semester</span>
					<input type="file" multiple accept={MATERIALS_RULES.accept} className="li-sr" onChange={(e) => setFiles((f) => [...f, ...Array.from(e.target.files ?? [])])} />
				</label>
				{files.length ? (
					<ul style={{ margin: 0, paddingLeft: "1.2em" }}>
						{files.map((f, i) => <li key={`${f.name}-${i}`}>{f.name} <button type="button" className="li-link" onClick={() => setFiles((all) => all.filter((_, j) => j !== i))}>remove</button></li>)}
					</ul>
				) : null}
				<label className="li-stack" style={{ gap: 6 }}>
					<span className="li-small"><b>Or paste text</b>, e.g. the weekly summaries from Canvas</span>
					<textarea className="li-input" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder={MATERIALS_COPY.pastePlaceholder} />
				</label>
				<MicButton mic={mic} />
				{error ? <div className="li-note" role="alert">{error}</div> : null}
				<button type="button" className="li-btn primary" style={{ alignSelf: "flex-start" }} disabled={busy !== null || (files.length === 0 && !text.trim())} onClick={propose}>
					{busy === "reading" ? MATERIALS_COPY.reading(at?.[0] ?? 0, at?.[1] ?? 1) : "Continue"}
				</button>
			</div>
		);
	}

	const kept = rows.filter((r) => r.keep && !r.short).length;
	return (
		<div className="li-card li-stack" style={{ gap: 14 }}>
			<div className="li-row"><b style={{ flexGrow: 1 }}>Check the units for {name}</b><button type="button" className="li-btn" onClick={onClose} disabled={busy !== null}>Cancel</button></div>
			<span className="li-small li-muted">Each unit is something you&apos;ll study on its own, usually one lecture or one week. Fix any title or week, and untick anything you don&apos;t need.</span>
			{notAdded.length ? <div className="li-note li-small" role="status">{MATERIALS_COPY.couldNotRead(notAdded)}</div> : null}
			{proposals.flatMap((p) => p.files.map((f) => (
				<div key={`${p.uploadId}-${f.file}`} className="li-stack" style={{ gap: 8 }}>
					<span className="li-small">
						<b>{f.name}</b> · {f.pageCount} {f.pageCount === 1 ? "page" : "pages"}
						{f.via === "ai" ? " · split by your AI" : f.via === "name" ? " · split by its week labels" : ""}
						{f.noText.length ? ` · no text found on ${f.noText.length === 1 ? "page" : "pages"} ${f.noText.join(", ")}` : ""}
					</span>
					{f.note ? <span className="li-note li-small">{f.note}</span> : null}
					{rows.map((r, i) =>
						r.upload !== p.uploadId || r.file !== f.file ? null : (
							<div key={i} className="li-row li-opt" style={{ gap: 10, flexWrap: "wrap" }}>
								<input type="checkbox" checked={r.keep} disabled={r.short} onChange={(e) => set(i, { keep: e.target.checked })} aria-label={`Keep ${r.title}`} />
								<input className="li-input" style={{ flex: "1 1 240px" }} value={r.title} onChange={(e) => set(i, { title: e.target.value })} aria-label="Unit title" />
								<select className="li-input" style={{ width: "auto" }} value={r.week} onChange={(e) => set(i, { week: Number(e.target.value) })} aria-label="Week">
									<option value={0}>{WEEK_COPY.notSet}</option>
									{WEEKS.map((w) => <option key={w} value={w}>{WEEK_COPY.week(w)}</option>)}
								</select>
								<span className="li-small li-muted">{r.pages[0] === r.pages[1] ? `p. ${r.pages[0]}` : `pp. ${r.pages[0]}–${r.pages[1]}`}</span>
								{r.short ? <span className="li-small" role="note" style={{ flexBasis: "100%" }}>{PACK_COPY.tooShort}</span> : null}
							</div>
						),
					)}
				</div>
			)))}
			{error ? <div className="li-note" role="alert">{error}</div> : null}
			<button type="button" className="li-btn primary" style={{ alignSelf: "flex-start" }} disabled={busy !== null || !rows.some((r) => r.keep && !r.short && r.title.trim())} onClick={save}>
				{busy === "saving" ? "Saving…" : `Save ${kept} ${kept === 1 ? "unit" : "units"}`}
			</button>
		</div>
	);
}
