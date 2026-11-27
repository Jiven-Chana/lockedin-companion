"use client";

/**
 * Gaps by idea (v2.0, V-39): "Ideas to revisit" as three levels. You see
 * modules and their ideas; open an idea to see the questions you missed on
 * it; open a question to see what you chose, the answer and why. From an
 * idea, "Practise this idea" starts a round on it.
 *
 * Only ideas with a gap are listed, so the list shrinks as ideas close
 * (V-43). Nothing is dated or called overdue (R-6): the counts name what is
 * there, never how late it is.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { GAP_COPY, GAP_RULES } from "@/src/core";
import { ApiError, lockedIn, type GapsData } from "./api";
import { Tint } from "./root";

type Idea = GapsData["modules"][number]["ideas"][number];

function Question({ q }: { q: Idea["questions"][number] }) {
	const [open, setOpen] = useState(false);
	return (
		<li className="li-gap-q">
			<button type="button" className="li-gap-row" aria-expanded={open} onClick={() => setOpen(!open)}>
				<span aria-hidden="true">{open ? "▾" : "▸"}</span>
				<span style={{ flexGrow: 1, textAlign: "left" }}>{q.text}</span>
				{q.slide ? <span className="li-small li-muted">Slide {q.slide}</span> : null}
			</button>
			{open ? (
				<div className="li-gap-detail li-small">
					{/* What you chose is only known for answers given since v2.0. */}
					{q.reason === "wrong" ? (q.chosen.length ? <span><b>{GAP_COPY.youChose}</b>: {q.chosen.join("; ")}</span> : null) : <span><b>{q.reason === "dont-know" ? GAP_COPY.dontKnow : GAP_COPY.unsure}</b></span>}
					<span><b>{GAP_COPY.answer}</b>: {q.correct.join("; ")}</span>
					{q.explanation ? <span className="li-muted">{q.explanation}</span> : null}
				</div>
			) : null}
		</li>
	);
}

function IdeaRow({ idea, onError }: { idea: Idea; onError: (m: string) => void }) {
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const [busy, setBusy] = useState(false);
	const practise = async () => {
		setBusy(true);
		try {
			const { sessionId } = await lockedIn.startPractise(idea.module, idea.key);
			router.push(`/app/session/${sessionId}`);
		} catch (e) {
			onError(e instanceof ApiError ? e.message : "Couldn't start that");
			setBusy(false);
		}
	};
	return (
		<li className="li-gap-idea">
			<button type="button" className="li-gap-row" aria-expanded={open} onClick={() => setOpen(!open)}>
				<span aria-hidden="true">{open ? "▾" : "▸"}</span>
				<span style={{ display: "flex", flexDirection: "column", flexGrow: 1, textAlign: "left", minWidth: 0 }}>
					<b>{idea.title}</b>
					<span className="li-small li-muted">{idea.unit}</span>
				</span>
				<span className="li-small">{GAP_COPY.missed(idea.missed)}</span>
			</button>
			{open ? (
				<div className="li-stack" style={{ gap: 8, paddingLeft: 22 }}>
					<ul className="li-gap-list">{idea.questions.map((q) => <Question key={q.id} q={q} />)}</ul>
					<span className="li-small li-muted">{GAP_COPY.progress(idea.right, idea.needed)}</span>
					{idea.canPractise ? <button type="button" className="li-btn primary" style={{ alignSelf: "flex-start" }} disabled={busy} aria-busy={busy} onClick={() => void practise()}>{busy ? GAP_COPY.writing(GAP_RULES.newQuestions) : GAP_COPY.practise}</button> : null}
				</div>
			) : null}
		</li>
	);
}

/** `first`: the module that most needs attention (V-36) is listed first. */
export function GapsByIdea({ data, first }: { data: GapsData | null; first?: string | null }) {
	const [err, setErr] = useState<string | null>(null);
	const modules = [...(data?.modules ?? [])].sort((a, b) => Number(b.code === first) - Number(a.code === first));
	return (
		<section className="li-stack" aria-labelledby="rv">
			<h2 id="rv" className="li-h2">{GAP_COPY.title}</h2>
			{data && modules.length === 0 ? <div className="li-card flat li-muted">{GAP_COPY.empty}</div> : null}
			{err ? <p className="li-small" role="alert" style={{ margin: 0 }}>{err}</p> : null}
			{modules.map((m) => (
				<Tint key={m.code} module={m.code}>
					<div className="li-card li-stack" style={{ gap: 6 }}>
						<div className="li-row">
							<span aria-hidden="true" style={{ width: 12, height: 12, borderRadius: 999, background: "var(--li-accent)" }} />
							<b style={{ flexGrow: 1 }}>{m.name}</b>
							<span className="li-small li-muted">{GAP_COPY.ideas(m.ideas.length)}</span>
						</div>
						<ul className="li-gap-list">{m.ideas.map((i) => <IdeaRow key={i.key} idea={i} onError={setErr} />)}</ul>
					</div>
				</Tint>
			))}
		</section>
	);
}
