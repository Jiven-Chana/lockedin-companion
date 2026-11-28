"use client";

/**
 * The first step of every Learn session (v3.1): "What do you want from this
 * session?". The student types it their way, or taps a suggestion taken
 * from their own module, may attach a sheet, and chooses whether to be
 * checked first. Nothing is sent to the AI until one of the two buttons is
 * pressed.
 */

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { LEARN_COPY, LEARN_RULES, type IntentSuggestion, type SessionAttachment } from "@/src/core";
import { ApiError, lockedIn } from "./api";
import { Attach, type AttachHandle } from "./attach";
import { Icon } from "./icons";
import { MicButton, useMic } from "./mic";

export function LearnIntent({ sessionId, name, suggestions, attachments, onDone }: { sessionId: string; name: string; suggestions: (IntentSuggestion & { sessionId?: string })[]; attachments: SessionAttachment[]; onDone: () => void }) {
	const router = useRouter();
	const [goal, setGoal] = useState("");
	const [picked, setPicked] = useState<IntentSuggestion["id"] | null>(null);
	const [files, setFiles] = useState(attachments);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const attach = useRef<AttachHandle>(null);
	const mic = useMic(useCallback((t: string) => setGoal((g) => (g ? `${g.trimEnd()} ${t}` : t)), []), "learn-intent");

	async function go(check: boolean) {
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			await mic.dictation.finish().catch(() => undefined);
			await lockedIn.answerIntent(sessionId, { ...(goal.trim() ? { goal: goal.trim() } : {}), check, ...(picked ? { suggestion: picked } : {}) });
			onDone();
		} catch (e) {
			setError(e instanceof ApiError ? e.message : "That didn't start");
			setBusy(false);
		}
	}
	async function tap(s: IntentSuggestion & { sessionId?: string }) {
		// A session stopped part-way is picked up as it was, with its plan: this new one is dropped.
		if (s.sessionId) {
			setBusy(true);
			await lockedIn.answerIntent(sessionId, { resume: true }).catch(() => undefined);
			return router.replace(`/app/session/${s.sessionId}`);
		}
		setGoal(s.goal);
		setPicked(s.id);
		if (s.attach) attach.current?.open();
	}

	return (
		<form className="li-stack li-intent" style={{ gap: 18 }} onSubmit={(e) => { e.preventDefault(); void go(true); }}>
			<div className="li-stack" style={{ gap: 4 }}>
				<h2 className="li-q-stem" style={{ fontSize: "1.6em" }}>{LEARN_COPY.intent.title}</h2>
				<span className="li-muted">{name}</span>
			</div>
			<div className="li-row" style={{ gap: 8, alignItems: "flex-end", flexWrap: "nowrap" }}>
				<textarea className="li-input" rows={2} value={goal} maxLength={LEARN_RULES.goalMax} autoFocus aria-label={LEARN_COPY.intent.title} placeholder={LEARN_COPY.intent.placeholder} onChange={(e) => { setGoal(e.target.value); setPicked(null); }} />
				<MicButton mic={mic} />
			</div>
			<Attach ref={attach} sessionId={sessionId} attachments={files} onChange={setFiles} label={LEARN_COPY.intent.attach} disabled={busy} />
			<div className="li-stack" style={{ gap: 8 }}>
				<b>{LEARN_COPY.intent.unsure}</b>
				<div className="li-row" style={{ gap: 8 }}>
					{suggestions.map((s) => <button key={s.id} type="button" className="li-opt li-suggest" aria-pressed={picked === s.id} disabled={busy} onClick={() => void tap(s)}>{s.label}</button>)}
				</div>
			</div>
			{error ? <div className="li-note" role="alert">{error}</div> : null}
			<div className="li-row" style={{ gap: 12, alignItems: "center" }}>
				<button type="submit" className="li-btn primary big" disabled={busy}>{LEARN_COPY.intent.check}<Icon.arrow /></button>
				<button type="button" className="li-btn" disabled={busy} onClick={() => void go(false)}>{LEARN_COPY.intent.skip}</button>
			</div>
			<span className="li-small li-muted">{LEARN_COPY.intent.checkNote}</span>
		</form>
	);
}
