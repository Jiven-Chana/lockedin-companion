"use client";

/**
 * Progress (v1.1, V-34 to V-36): the history of what you have learned.
 *
 * - The learning score over this week, the last month or the term, against
 *   a straight steady-pace line. Tap a point to see what happened then.
 * - Where it came from: what each module contributed, and the time on it.
 * - Needs attention: the gaps, each with one thing to do about it.
 * - Milestones: earned from real history, dated, and kept.
 * - Ideas to revisit, the neglected module first.
 *
 * It speaks about ideas and modules, never about the student: no "behind",
 * no deficit number, no streak (v1.1-research.md; R-6's intent).
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { MILESTONE_GROUPS, moduleHue, PROGRESS_COPY, type ScoreRange } from "@/src/core";
import { lockedIn, type ProgressAttention, type ProgressData, type ProgressPoint } from "../api";
import { GapsByIdea } from "../gaps";
import { useData } from "../hooks";
import { StatusTag } from "../icons";
import { Tint } from "../root";
import { pointTitle, ScoreChart } from "../score-chart";
import { PageHead } from "../shell";

const RANGES: ScoreRange[] = ["week", "month", "term"];

function minutesText(m: number): string {
	if (m <= 0) return "—";
	return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m} min`;
}
const list = (items: string[]) => (items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items.at(-1)}` : (items[0] ?? ""));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What happened in the period a point stands for, in a sentence or two. */
function PointDetail({ p, range, data }: { p: ProgressPoint; range: ScoreRange; data: ProgressData }) {
	const title = <b>{pointTitle(p, range)}</b>;
	if (p.future) return <p className="li-chart-detail">{title} <span className="li-muted">· still to come{p.pace !== null ? ` · ${PROGRESS_COPY.steadyPace.toLowerCase()} by then: ${p.pace.toLocaleString("en-GB")}` : ""}</span></p>;
	const d = p.detail;
	const names = (keys: string[]) => list([...new Set(keys.map((k) => data.ideas[k]?.title ?? "an idea"))]);
	const parts = [
		d.answered ? `${d.right} of ${d.answered} right${d.sessions ? ` in ${plural(d.sessions, "session")}` : ""}` : null,
		d.blocks ? `${plural(d.blocks, "study block")} started` : null,
	].filter(Boolean);
	const earned = p.milestones.map((id) => data.milestones.find((m) => m.id === id)?.title).filter((t): t is string => !!t);
	return (
		<div className="li-chart-detail">
			<p style={{ margin: 0 }}>
				{title} <span className="li-muted">· score {p.score.toLocaleString("en-GB")}{p.gained ? ` · +${p.gained}` : ""}</span>
				{parts.length ? <span> · {parts.join(" · ")}</span> : !p.gained ? <span className="li-muted"> · nothing recorded</span> : null}
			</p>
			{d.secured.length ? <p style={{ margin: 0 }}><StatusTag status="solid" /> Secured: {names(d.secured)}</p> : null}
			{d.cameBack.length ? <p style={{ margin: 0 }}><StatusTag status="solid" /> Came back: {names(d.cameBack)}</p> : null}
			{earned.length ? <p style={{ margin: 0 }}><span className="li-chip">◆ Milestone</span> {list(earned)}</p> : null}
		</div>
	);
}

/** The module's colour as a dot: the only tinted thing on a Progress card (v1.0 V-1). */
function ModuleDot({ code }: { code: string }) {
	return <Tint hue={moduleHue(code)} style={{ display: "inline-flex" }}><span className="li-dot" style={{ background: "var(--li-accent)" }} /></Tint>;
}

export function ProgressScreen() {
	const router = useRouter();
	const progress = useData(() => lockedIn.progress());
	const gaps = useData(() => lockedIn.gaps());
	const [range, setRange] = useState<ScoreRange>("week");
	const [picked, setPicked] = useState<Partial<Record<ScoreRange, number>>>({});
	const [busy, setBusy] = useState<string | null>(null);
	const p = progress.data;

	async function start(spec: { kind: "retest" | "try-now" | "post-lecture"; lectureId: string; nodes?: string[] }, extra?: object) {
		setBusy(spec.lectureId);
		try {
			// Getting something back is Practise: quick questions from the bank (V-40).
			const { sessionId } = await lockedIn.startSession({ ...(extra ?? {}), ...spec, study: "practise" });
			router.push(`/app/session/${sessionId}`);
		} finally {
			setBusy(null);
		}
	}

	if (!p) return (<><PageHead eyebrow="Progress" title="Where you are" /><div className="li-card li-empty">{progress.error ? "Couldn't load your progress. Reload the page." : "Loading…"}</div></>);

	const points = p.score.series[range];
	// The point shown: the one picked, else the latest that has happened.
	const latest = Math.max(0, points.map((x) => x.future).lastIndexOf(false));
	const selected = Math.min(points.length - 1, picked[range] ?? latest);
	const maxPoints = Math.max(1, ...p.modules.map((m) => m.shares[range].points));
	const earned = p.milestones.filter((m) => m.earnedAt);

	// Ideas to revisit: the module that needs attention first (V-36).
	const first = p.attention.find((a) => a.kind === "module")?.module ?? null;

	return (
		<>
			<PageHead eyebrow="Progress" title="Where you are">
				<div className="li-row" style={{ marginTop: 12 }}><Link className="li-btn" href="/app/plan">{PROGRESS_COPY.seeWeek}</Link></div>
			</PageHead>
			{p.welcomeBack ? (
				<Tint hue={285}>
					<button type="button" className="li-hero" onClick={() => start({ kind: "try-now", lectureId: p.welcomeBack!.spec.lectureId }, p.welcomeBack!.spec)}>
						<span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
							<span className="li-eyebrow" style={{ color: "inherit", opacity: 0.85 }}>Welcome back</span>
							<span className="li-hero-title">{p.welcomeBack.text}</span>
							<span style={{ opacity: 0.9 }}>Nothing has gone anywhere.</span>
						</span>
						<span className="li-hero-cta">Start</span>
					</button>
				</Tint>
			) : null}

			<section className="li-card li-stack" aria-labelledby="sc" style={{ gap: 14 }}>
				<div className="li-row" style={{ alignItems: "flex-end" }}>
					<div style={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
						<h2 id="sc" className="li-eyebrow" style={{ margin: 0 }}>{PROGRESS_COPY.score}</h2>
						<span className="li-row" style={{ gap: 12, alignItems: "baseline" }}>
							<b className="li-display li-score">{p.score.now.toLocaleString("en-GB")}</b>
							{p.score.weekChange !== 0 ? <span className="li-chip">{PROGRESS_COPY.thisWeek(p.score.weekChange)}</span> : null}
							<span className="li-muted">{p.score.ideasSecured} of {p.score.ideasTotal} ideas secured{p.score.fading ? ` · ${p.score.fading} fading` : ""}</span>
						</span>
					</div>
					<div className="li-row" role="group" aria-label="Range" style={{ gap: 6 }}>
						{RANGES.map((r) => <button key={r} type="button" className="li-chip" data-on={r === range ? "true" : "false"} aria-pressed={r === range} onClick={() => setRange(r)}>{PROGRESS_COPY.ranges[r]}</button>)}
					</div>
				</div>
				<ScoreChart points={points} range={range} selected={selected} onSelect={(i) => setPicked((s) => ({ ...s, [range]: i }))} />
				<div className="li-row li-small li-muted" style={{ gap: 18 }}>
					<span className="li-row" style={{ gap: 6 }}><i className="li-key li-key-you" />You</span>
					{p.score.term.target > 0 ? <span className="li-row" style={{ gap: 6 }} title={PROGRESS_COPY.steadyPaceHelp}><i className="li-key li-key-pace" />{PROGRESS_COPY.steadyPace}: {PROGRESS_COPY.steadyPaceHelp.charAt(0).toLowerCase()}{PROGRESS_COPY.steadyPaceHelp.slice(1)}</span> : null}
					<span className="li-row" style={{ gap: 6 }}>◆ A milestone</span>
				</div>
				<div aria-live="polite">{points[selected] ? <PointDetail p={points[selected]!} range={range} data={p} /> : null}</div>
			</section>

			<div className="li-progress-two">
				<section className="li-card li-stack" aria-labelledby="wf" style={{ gap: 12 }}>
					<h2 id="wf" className="li-h2">{PROGRESS_COPY.whereFrom} <span className="li-muted li-small" style={{ fontWeight: 400 }}>· {range === "week" ? "this week" : range === "month" ? "the last 30 days" : "this term"}</span></h2>
					{p.modules.map((m) => {
						const share = m.shares[range];
						return (
							<div key={m.code} className="li-share">
								<span className="li-row" style={{ gap: 8, flexWrap: "nowrap" }}>
									<ModuleDot code={m.code} />
									<b style={{ flexGrow: 1, minWidth: 0 }}>{m.name}</b>
									<span className="li-small li-muted" style={{ whiteSpace: "nowrap" }}>{m.hasMaterial ? minutesText(share.minutes) : "no material yet"}</span>
									<b style={{ minWidth: 52, textAlign: "right" }}>{share.points.toLocaleString("en-GB")}</b>
								</span>
								<Tint hue={moduleHue(m.code)}><span className="li-bar"><span style={{ width: `${(share.points / maxPoints) * 100}%` }} /></span></Tint>
							</div>
						);
					})}
				</section>

				<section className="li-card li-stack" aria-labelledby="na" style={{ gap: 12 }}>
					<h2 id="na" className="li-h2">{PROGRESS_COPY.attention}</h2>
					{p.attention.length === 0 ? <span className="li-muted">{PROGRESS_COPY.nothingNeeds}</span> : null}
					{p.attention.map((a: ProgressAttention) => (
						<div key={a.kind} className="li-attention">
							<span>{a.text}</span>
							{a.action.session
								? <button type="button" className="li-btn primary" disabled={busy !== null} onClick={() => start(a.action.session!)}>{a.action.label}</button>
								: <Link className="li-btn" href={a.action.href ?? "/app/library"}>{a.action.label}</Link>}
						</div>
					))}
				</section>
			</div>

			<section className="li-card li-stack" aria-labelledby="ms" style={{ gap: 14 }}>
				<h2 id="ms" className="li-h2">{PROGRESS_COPY.milestones} <span className="li-muted li-small" style={{ fontWeight: 400 }}>· {PROGRESS_COPY.earned(earned.length, p.milestones.length)}</span></h2>
				{(Object.keys(MILESTONE_GROUPS) as (keyof typeof MILESTONE_GROUPS)[]).map((g) => (
					<div key={g} className="li-stack" style={{ gap: 8 }}>
						<span className="li-eyebrow">{MILESTONE_GROUPS[g]}</span>
						<div className="li-milestones">
							{p.milestones.filter((m) => m.group === g).map((m) => (
								<div key={m.id} className="li-milestone" data-earned={m.earnedAt ? "true" : "false"}>
									<b>{m.earnedAt ? "◆ " : ""}{m.title}</b>
									<span className="li-small">{m.earnedAt ? new Date(m.earnedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : m.how}</span>
								</div>
							))}
						</div>
					</div>
				))}
			</section>

			{/* Gaps by idea (V-39): module, then idea, then the questions missed. */}
			<GapsByIdea data={gaps.data ?? null} first={first} />
		</>
	);
}
