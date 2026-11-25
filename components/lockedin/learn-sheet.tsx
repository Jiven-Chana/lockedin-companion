"use client";

/**
 * The module's Learn start sheet (v2.0 step 5). One suggestion for anyone
 * who doesn't know where to start (AFF-K), and one line for anyone who does:
 * type or say what you want to cover, matched to this module's topics as you
 * type. "This week" and the full lecture list are quiet links (INT-02-b: no
 * menu of choices). There is no "where are you?" question: say it in the
 * same line, and the tutor's first guesses find it.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { LEARN_COPY, LEARN_RULES, matchTopics, PRACTISE_COPY, weekLabel, type LearnTopic } from "@/src/core";
import { ApiError, lockedIn } from "./api";
import { useData } from "./hooks";
import { MicButton, useMic } from "./mic";

export function LearnSheet({ code, onClose, onPractise }: { code: string; onClose: () => void; onPractise: () => void }) {
	const router = useRouter();
	const sheet = useData(() => lockedIn.learnSheet(code), [code]);
	const [goal, setGoal] = useState("");
	const [all, setAll] = useState(false);
	const [busy, setBusy] = useState(false);
	const [msg, setMsg] = useState<string | null>(null);
	const mic = useMic(useCallback((t: string) => setGoal((g) => (g ? `${g.trimEnd()} ${t}` : t)), []), "learn-goal");
	const d = sheet.data;

	async function go(body: Parameters<typeof lockedIn.startLearn>[0]) {
		if (busy) return;
		setBusy(true);
		setMsg(null);
		try {
			await mic.dictation.finish().catch(() => undefined);
			router.push(`/app/session/${(await lockedIn.startLearn(body)).sessionId}`);
		} catch (e) {
			setMsg(e instanceof ApiError ? e.message : "Couldn't start that");
			setBusy(false);
		}
	}
	const said = goal.trim() ? { goal: goal.trim().slice(0, LEARN_RULES.goalMax) } : {};
	const topic = (t: LearnTopic) => go({ lectureId: t.lectureId, ...(t.nodeId ? { nodes: [t.nodeId] } : {}), ...said });

	if (!d) return <div className="li-card" role="status">{sheet.error ? "Couldn't load this. Reload the page." : "Loading…"}</div>;
	const matches = matchTopics(goal, d.topics);
	const typed = goal.trim().length >= 3;

	return (
		<div className="li-card li-stack" role="dialog" aria-label={LEARN_COPY.sheetTitle(d.module.name)} style={{ gap: 16 }}>
			<div className="li-row">
				<h3 className="li-h2" style={{ flexGrow: 1 }}>{LEARN_COPY.sheetTitle(d.module.name)}</h3>
				<button type="button" className="li-btn ghost" aria-label="Close" onClick={onClose}>✕</button>
			</div>
			{!d.connected ? (
				<div className="li-note li-row" role="status" style={{ gap: 12 }}>
					<span style={{ flexGrow: 1 }}>{LEARN_COPY.notConnected}</span>
					<Link className="li-btn" href="/app/me#ai">{LEARN_COPY.connect}</Link>
					<button type="button" className="li-btn primary" onClick={onPractise}>{PRACTISE_COPY.button}</button>
				</div>
			) : d.lectures.length === 0 ? (
				<div className="li-note">{LEARN_COPY.nothingToLearn}</div>
			) : (
				<>
					{d.suggestion ? (
						<button type="button" className="li-btn primary big" style={{ justifyContent: "flex-start", textAlign: "left", height: "auto", padding: "14px 20px" }} disabled={busy} autoFocus
							onClick={() => (d.suggestion!.type === "resume" ? router.push(`/app/session/${d.suggestion!.sessionId}`) : void go({ lectureId: d.suggestion!.lectureId }))}>
							<span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
								<b>{d.suggestion.type === "resume" ? `${LEARN_COPY.pickUp}: ${d.suggestion.title}` : LEARN_COPY.start(d.suggestion.title)}</b>
								<span style={{ fontWeight: 400, opacity: 0.9 }}>{d.suggestion.type === "resume" ? LEARN_COPY.stopped(d.minutes) : LEARN_COPY.nextInCourse(d.minutes)}</span>
							</span>
						</button>
					) : null}
					<form className="li-stack" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); if (matches[0]) void topic(matches[0]); else if (typed) setAll(true); }}>
						<label htmlFor={`learn-goal-${code}`}><b>{LEARN_COPY.orSay}</b></label>
						<div className="li-row" style={{ gap: 8 }}>
							<input id={`learn-goal-${code}`} className="li-input" value={goal} maxLength={LEARN_RULES.goalMax} onChange={(e) => setGoal(e.target.value)} placeholder={LEARN_COPY.sayPlaceholder} autoComplete="off" />
							<MicButton mic={mic} />
						</div>
						{matches.length ? (
							<div className="li-stack" style={{ gap: 6 }} aria-label="Matching topics">
								{matches.map((t) => (
									<button key={`${t.lectureId}#${t.nodeId ?? ""}`} type="button" className="li-opt" style={{ minHeight: 48, padding: "8px 14px" }} disabled={busy} onClick={() => void topic(t)}>
										<span style={{ flexGrow: 1 }}>{t.title}</span>
										{t.week > 0 ? <span className="li-small li-muted">{weekLabel(t.week)}</span> : null}
									</button>
								))}
							</div>
						) : typed ? <span className="li-small li-muted" role="status">{LEARN_COPY.noMatch(d.module.name)}</span> : null}
					</form>
					{(all || (typed && matches.length === 0)) ? (
						<div className="li-stack" style={{ gap: 6 }} aria-label={LEARN_COPY.allLectures}>
							{d.lectures.map((l) => (
								<button key={l.id} type="button" className="li-opt" style={{ minHeight: 48, padding: "8px 14px" }} disabled={busy} onClick={() => void go({ lectureId: l.id, ...said })}>
									<span style={{ flexGrow: 1 }}>{l.title}</span>
									{l.week > 0 ? <span className="li-small li-muted">{weekLabel(l.week)}</span> : null}
								</button>
							))}
						</div>
					) : null}
					<div className="li-row li-small" style={{ gap: 16 }}>
						{d.week ? <button type="button" className="li-btn ghost" disabled={busy} onClick={() => void go({ module: d.module.code, week: true, ...said })}>{LEARN_COPY.thisWeek(d.week.lectureIds.length)}</button> : null}
						{!all ? <button type="button" className="li-btn ghost" onClick={() => setAll(true)}>{LEARN_COPY.allLectures} ›</button> : null}
					</div>
				</>
			)}
			{msg ? <div className="li-note" role="alert">{msg}</div> : null}
		</div>
	);
}
