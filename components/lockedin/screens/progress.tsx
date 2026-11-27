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
import { MILESTONE_GROUPS, PROGRESS_COPY, type ScoreRange } from "@/src/core";
import { lockedIn, type ProgressAttention, type ProgressData, type ProgressPoint } from "../api";
import { GapsByIdea } from "../gaps";
import { useData } from "../hooks";
import { Icon, ModuleMark, StatusTag } from "../icons";
import { Tint, useLockedIn } from "../root";
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

/**
 * Where the score came from, as a ring: one arc per module, in its colour,
 * sized by its points. A ring shows the split at a glance; a tester said it
 * "makes a dip bearable" because it shows why (look test, 27 Nov). The rows
 * beside it carry the same numbers as words.
 */
function Ring({ parts }: { parts: { code: string; colour: string; value: number }[] }) {
	const total = parts.reduce((n, p) => n + p.value, 0);
	const R = 54, C = 2 * Math.PI * R;
	let at = 0;
	return (
		<svg width="168" height="168" viewBox="0 0 140 140" role="img" aria-label="Where your score came from, by module" style={{ flex: "none" }}>
			<circle cx="70" cy="70" r={R} fill="none" stroke="var(--li-sand)" strokeWidth="26" strokeDasharray={total ? undefined : "6 8"} />
			{total ? parts.filter((p) => p.value > 0).map((p) => {
				const len = (p.value / total) * C;
				const arc = <circle key={p.code} className={`li-mod-${p.colour}`} cx="70" cy="70" r={R} fill="none" stroke="var(--li-mod)" strokeWidth="26" strokeDasharray={`${Math.max(0, len - 2).toFixed(2)} ${(C - Math.max(0, len - 2)).toFixed(2)}`} strokeDashoffset={(-at).toFixed(2)} transform="rotate(-90 70 70)" />;
				at += len;
				return arc;
			}) : null}
			<circle cx="70" cy="70" r={R + 13} fill="none" stroke="var(--li-edge)" strokeWidth="2.5" />
			<circle cx="70" cy="70" r={R - 13} fill="none" stroke="var(--li-edge)" strokeWidth="2.5" />
		</svg>
	);
}

export function ProgressScreen() {
	const router = useRouter();
	const progress = useData(() => lockedIn.progress());
	const gaps = useData(() => lockedIn.gaps());
	const [range, setRange] = useState<ScoreRange>("week");
	const [picked, setPicked] = useState<Partial<Record<ScoreRange, number>>>({});
	const [busy, setBusy] = useState<string | null>(null);
	const p = progress.data;
	const { moduleLook } = useLockedIn();

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

	const attention = p.attention;
	const ideas = p.score.ideasTotal;
	const rangeWord = range === "week" ? "this week" : range === "month" ? "the last 30 days" : "this term";

	return (
		<>
			<div className="li-row" style={{ alignItems: "flex-end", justifyContent: "space-between" }}>
				<PageHead eyebrow="Progress" icon={<Icon.progress />} title="Where you are" />
				{/* The week is one tap from Progress (v2.2; asked for in the look test). */}
				<Link className="li-btn" href="/app/plan"><Icon.calendar />{PROGRESS_COPY.seeWeek}</Link>
			</div>
			{p.welcomeBack ? (
				<button type="button" className="li-hero plain" onClick={() => start({ kind: "try-now", lectureId: p.welcomeBack!.spec.lectureId }, p.welcomeBack!.spec)}>
					<span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
						<span className="li-eyebrow">Welcome back</span>
						<span className="li-hero-title" style={{ fontSize: "2em" }}>{p.welcomeBack.text}</span>
						<span>Nothing has gone anywhere.</span>
					</span>
					<span className="li-btn primary big" style={{ marginLeft: "auto" }}>Start<Icon.arrow /></span>
				</button>
			) : null}

			{/* Progress first; what to do about it comes after (look test, 27 Nov). */}
			<div className="li-progress-top">
				<section className="li-panel ink li-stack" aria-labelledby="sc" style={{ gap: 14 }}>
					<h2 id="sc" className="li-eyebrow" style={{ margin: 0, color: "inherit" }}><Icon.progress />{PROGRESS_COPY.score}</h2>
					<span className="li-row" style={{ gap: 14, alignItems: "flex-end" }}>
						<b className="li-numeral li-score">{p.score.now.toLocaleString("en-GB")}</b>
						{p.score.weekChange !== 0 ? <span className="li-chip li-on-mint" style={{ fontSize: "1em", padding: "4px 14px", marginBottom: 10 }}>{p.score.weekChange > 0 ? <Icon.up /> : null}{PROGRESS_COPY.thisWeek(p.score.weekChange)}</span> : null}
					</span>
					{/* Blocks you can count: one per idea, mint when it is secured. With very many ideas, a bar says the same. */}
					{ideas > 0 && ideas <= 90
						? <span className="li-count" aria-hidden="true">{Array.from({ length: ideas }, (_, i) => <i key={i} data-on={String(i < p.score.ideasSecured)} />)}</span>
						: ideas > 0 ? <span className="li-bar" aria-hidden="true"><span style={{ width: `${(p.score.ideasSecured / ideas) * 100}%` }} /></span> : null}
					<b>{p.score.ideasSecured} of {ideas} ideas secured{p.score.fading ? ` · ${p.score.fading} fading` : ""}</b>
				</section>

				<section className="li-card li-stack" aria-label="Your score over time" style={{ gap: 12 }}>
					<div className="li-row" style={{ justifyContent: "space-between" }}>
						<div className="li-row li-small" style={{ gap: 18 }}>
							<span className="li-row" style={{ gap: 6 }}><i className="li-key li-key-you" />You</span>
							{p.score.term.target > 0 ? <span className="li-row" style={{ gap: 6 }} title={PROGRESS_COPY.steadyPaceHelp}><i className="li-key li-key-pace" />{PROGRESS_COPY.steadyPace}</span> : null}
							<span className="li-row" style={{ gap: 6 }}><Icon.flag />A milestone</span>
						</div>
						<div className="li-seg" role="group" aria-label="Range">
							{RANGES.map((r) => <button key={r} type="button" aria-pressed={r === range} onClick={() => setRange(r)}>{PROGRESS_COPY.ranges[r]}</button>)}
						</div>
					</div>
					<ScoreChart points={points} range={range} selected={selected} onSelect={(i) => setPicked((s) => ({ ...s, [range]: i }))} />
					<div aria-live="polite">{points[selected] ? <PointDetail p={points[selected]!} range={range} data={p} /> : null}</div>
					{p.score.term.target > 0 ? <span className="li-small li-muted">{PROGRESS_COPY.steadyPace}: {PROGRESS_COPY.steadyPaceHelp.charAt(0).toLowerCase()}{PROGRESS_COPY.steadyPaceHelp.slice(1)}</span> : null}
				</section>
			</div>

			<div className="li-progress-two">
				<section className="li-card li-stack" aria-labelledby="wf" style={{ gap: 14 }}>
					<h2 id="wf" className="li-h2">{PROGRESS_COPY.whereFrom} · {rangeWord}</h2>
					<div className="li-row" style={{ gap: 24, alignItems: "center", flexWrap: "nowrap" }}>
						<Ring parts={p.modules.map((m) => ({ code: m.code, colour: moduleLook(m.code).colour, value: m.shares[range].points }))} />
						<div className="li-stack" style={{ gap: 10, flexGrow: 1, minWidth: 0 }}>
							{p.modules.map((m) => {
								const share = m.shares[range];
								return (
									<div key={m.code} className="li-row" style={{ gap: 10, flexWrap: "nowrap" }}>
										<ModuleMark module={m.code} small />
										<span style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 }}>
											<b style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}</b>
											<span className="li-small li-muted li-row" style={{ gap: 5, flexWrap: "nowrap" }}>{m.hasMaterial ? <><Icon.time />{minutesText(share.minutes)}</> : "no material yet"}</span>
										</span>
										<b className="li-numeral" style={{ fontSize: "1.5em" }}>{share.points.toLocaleString("en-GB")}</b>
									</div>
								);
							})}
						</div>
					</div>
				</section>

				<section className="li-card li-stack" aria-labelledby="ms" style={{ gap: 12 }}>
					<h2 id="ms" className="li-h2">{PROGRESS_COPY.milestones} · {PROGRESS_COPY.earned(earned.length, p.milestones.length)}</h2>
					{(Object.keys(MILESTONE_GROUPS) as (keyof typeof MILESTONE_GROUPS)[]).map((g) => (
						<div key={g} className="li-stack" style={{ gap: 8 }}>
							<span className="li-small"><b>{MILESTONE_GROUPS[g]}</b></span>
							<div className="li-milestones">
								{p.milestones.filter((m) => m.group === g).map((m) => (
									<div key={m.id} className="li-milestone" data-earned={m.earnedAt ? "true" : "false"}>
										<span className="li-tickbox" aria-hidden="true">{m.earnedAt ? <Icon.check /> : null}</span>
										<b>{m.title}</b>
										<span className="li-small">{m.earnedAt ? new Date(m.earnedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : m.how}</span>
									</div>
								))}
							</div>
						</div>
					))}
				</section>
			</div>

			{/* What to do next: the first thing as a panel in its module's colour, the rest as rows. */}
			<section className="li-stack" aria-labelledby="na" style={{ gap: 12 }}>
				<h2 id="na" className="li-h2">{PROGRESS_COPY.attention}</h2>
				{attention.length === 0 ? <div className="li-card li-muted">{PROGRESS_COPY.nothingNeeds}</div> : null}
				{attention.map((a: ProgressAttention, i) => {
					const action = a.action.session
						? <button type="button" className={`li-btn${i === 0 ? " primary big" : ""}`} disabled={busy !== null} onClick={() => start(a.action.session!)}>{a.action.label}<Icon.arrow /></button>
						: <Link className={`li-btn${i === 0 ? " primary big" : ""}`} href={a.action.href ?? "/app/library"}>{a.action.label}<Icon.arrow /></Link>;
					return i === 0 ? (
						<Tint key={a.kind} module={a.module}>
							<div className={a.module ? "li-panel li-stack" : "li-card li-stack"} style={{ gap: 14, alignItems: "flex-start" }}>
								{a.module ? <span className="li-eyebrow"><ModuleMark module={a.module} small onColour />{a.module}</span> : null}
								<span className="li-h2" style={{ fontSize: "1.9em" }}>{a.text}</span>
								{action}
							</div>
						</Tint>
					) : (
						<div key={a.kind} className="li-card li-attention">
							<span>{a.text}</span>
							{action}
						</div>
					);
				})}
			</section>

			{/* Gaps by idea (V-39): module, then idea, then the questions missed. */}
			<GapsByIdea data={gaps.data ?? null} first={first} />
		</>
	);
}
