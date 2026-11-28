"use client";

/**
 * Attach a file to a Learn session (v3.1): a problem sheet, a worked
 * solution, a photo of working. Each file is sent by itself and read on the
 * laptop with no AI; it goes to the tutor with the student's next message.
 * A file can be taken back until then.
 */

import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { ATTACH_COPY, ATTACH_RULES, MATERIALS_COPY, eachFile, type SessionAttachment } from "@/src/core";
import { ApiError, lockedIn } from "./api";
import { Icon } from "./icons";

export interface AttachHandle { open: () => void }

export const Attach = forwardRef<AttachHandle, { sessionId: string; attachments: SessionAttachment[]; onChange: (all: SessionAttachment[]) => void; label?: string; disabled?: boolean }>(function Attach({ sessionId, attachments, onChange, label, disabled }, ref) {
	const input = useRef<HTMLInputElement>(null);
	const [busy, setBusy] = useState(false);
	const [note, setNote] = useState<string | null>(null);
	useImperativeHandle(ref, () => ({ open: () => input.current?.click() }), []);

	async function add(files: File[]) {
		if (files.length === 0 || busy) return;
		setBusy(true);
		setNote(null);
		let latest = attachments;
		const r = await eachFile(files, async (f) => {
			const form = new FormData();
			form.append("file", f);
			latest = (await lockedIn.attach(sessionId, form)).attachments;
			onChange(latest);
		});
		setNote(r.failed.length ? MATERIALS_COPY.couldNotRead(r.failed) : null);
		setBusy(false);
	}
	async function remove(attId: string) {
		try {
			onChange((await lockedIn.removeAttachment(sessionId, attId)).attachments);
		} catch (e) {
			setNote(e instanceof ApiError ? e.message : "Couldn't remove that");
		}
	}
	const waiting = attachments.filter((a) => !a.sent);

	return (
		<div className="li-stack li-attach" style={{ gap: 8 }}>
			<label className="li-btn ghost" style={{ cursor: disabled || busy ? "default" : "pointer", alignSelf: "flex-start" }} title={ATTACH_COPY.hint} aria-disabled={disabled || busy}>
				<Icon.upload />{busy ? "Reading…" : (label ?? ATTACH_COPY.button)}
				<input ref={input} type="file" multiple accept={ATTACH_RULES.accept} className="li-sr" disabled={disabled || busy} onChange={(e) => { void add(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
			</label>
			{waiting.length ? (
				<ul className="li-attached" aria-label="Attached, not sent yet">
					{waiting.map((a) => (
						<li key={a.id}>
							<Icon.slide /><span style={{ flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</span>
							<button type="button" className="li-link" onClick={() => void remove(a.id)}>{ATTACH_COPY.remove}</button>
						</li>
					))}
				</ul>
			) : null}
			{note ? <span className="li-small" role="alert">{note}</span> : null}
		</div>
	);
});
