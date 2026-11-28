"use client";

/**
 * Progress (v1.1, V-34 to V-36): the history of what you have learned.
 *
 * - The learning score over this week, the last month or the term, against
 *   a straight steady-pace line. Tap a point to see what happened then.
 * - Needs attention: the gaps, each with one thing to do about it.
 * - Where it came from: what each module contributed, and the time on it.
 * - Milestones: earned from real history, dated, and kept.
 * - Ideas to revisit, the neglected module first.
 *
 * All of it is on one screen (v3.0.1). Milestones and "To revisit" say the
 * short version and open the whole list in a panel at the side.
 *
 * It speaks about ideas and modules, never about the student: no "behind",
 * no deficit number, no streak (v1.1-research.md; R-6's intent).
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { GAP_COPY, MILESTONE_GROUPS, PROGRESS_COPY, milestoneSummary, type ScoreRange } from "@/src/core";
import { lockedIn, type ProgressAttention, type ProgressData, type ProgressPoint } from "../api";
import { GapsByIdea } from "../gaps";
import { useData } from "../hooks";
import { Icon, ModuleMark, StatusTag } from "../icons";
import { Tint, useLockedIn } from "../root";
import { pointTitle, ScoreChart } from "../score-chart";
import { PageHead } from "../shell";
import { SidePanel } from "../side-panel";

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
		<svg className="li-ring" width="168" height="168" viewBox="0 0 140 140" role="img" aria-label="Where your score came from, by module" style={{ flex: "none" }}>
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
	const [panel, setPanel] = useState<"milestones" | "revisit" | null>(null);
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

	// Ideas to revisit: the module that needs attention first (V-36).
	const first = p.attention.find((a) => a.kind === "module")?.module ?? null;

	const attention = p.attention;
	const ideas = p.score.ideasTotal;
	const rangeWord = range === "week" ? "this week" : range === "month" ? "the last 30 days" : "this term";

	const ms = milestoneSummary(p.milestones);
	const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
	const gapModules = [...(gaps.data?.modules ?? [])].sort((a, b) => Number(b.code === first) - Number(a.code === first));
	const act = (a: ProgressAttention, main: boolean) => a.action.session
		? <button type="button" className={main ? "li-btn primary" : "li-btn ghost"} title={a.action.label} disabled={busy !== null} onClick={() => start(a.action.session!)}><span>{a.action.label}</span><Icon.arrow /></button>
		: <Link className={main ? "li-btn primary" : "li-btn ghost"} title={a.action.label} href={a.action.href ?? "/app/library"}><span>{a.action.label}</span><Icon.arrow /></Link>;

	return (
		<>
			{/* Progress is one screen of blocks (v3.0.1): nothing is below the fold, and the two long lists open in a panel at the side. */}
			<span className="li-fit li-fill" hidden />
			<div className="li-row" style={{ alignItems: "flex-end", justifyContent: "space-between" }}>
				<PageHead eyebrow="Progress" icon={<Icon.progress />} title="Where you are" />
				{/* The week is one tap from Progress (v2.2; asked for in the look test). */}
				<Link className="li-btn" href="/app/plan"><Icon.calendar />{PROGRESS_COPY.seeWeek}</Link>
			</div>
			{p.welcomeBack ? (
				<button type="button" className="li-hero plain li-band" onClick={() => start({ kind: "try-now", lectureId: p.welcomeBack!.spec.lectureId }, p.welcomeBack!.spec)}>
					<span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
						<span className="li-eyebrow">Welcome back</span>
						<b>{p.welcomeBack.text} Nothing has gone anywhere.</b>
					</span>
					<span className="li-btn primary" style={{ marginLeft: "auto" }}>Start<Icon.arrow /></span>
				</button>
			) : null}

			{/* Progress first; what to do about it comes after (look test, 27 Nov). */}
			<div className="li-progress-top">
				<section className="li-panel ink li-stack" aria-labelledby="sc" style={{ gap: 12 }}>
					<span className="li-row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
						<h2 id="sc" className="li-eyebrow" style={{ margin: 0, color: "inherit" }}><Icon.progress />{PROGRESS_COPY.score}</h2>
						{p.score.weekChange !== 0 ? <span className="li-chip li-on-mint" style={{ fontSize: "0.95em", padding: "2px 12px" }}>{p.score.weekChange > 0 ? <Icon.up /> : null}{PROGRESS_COPY.thisWeek(p.score.weekChange)}</span> : null}
					</span>
					<span className="li-row" style={{ gap: 14, alignItems: "flex-end", flexWrap: "nowrap" }}>
						<b className="li-numeral li-score">{p.score.now.toLocaleString("en-GB")}</b>
						<b style={{ paddingBottom: 4, minWidth: 0 }}>{p.score.ideasSecured} of {ideas} ideas secured{p.score.fading ? ` · ${p.score.fading} fading` : ""}</b>
					</span>
					<span className="li-grow" />
					{/* Blocks you can count: one per idea, mint when it is secured. With very many ideas, a bar says the same. */}
					{ideas > 0 && ideas <= 90
						? <span className="li-count" aria-hidden="true">{Array.from({ length: ideas }, (_, i) => <i key={i} data-on={String(i < p.score.ideasSecured)} />)}</span>
						: ideas > 0 ? <span className="li-bar" aria-hidden="true"><span style={{ width: `${(p.score.ideasSecured / ideas) * 100}%` }} /></span> : null}
				</section>

				<section className="li-card li-stack li-chart-card" aria-label="Your score over time" style={{ gap: 10 }}>
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
					{/* What the steady-pace line is: said in full where there is room, and always on the key above (its tooltip). */}
					{p.score.term.target > 0 ? <span className="li-small li-muted li-pace-help">{PROGRESS_COPY.steadyPace}: {PROGRESS_COPY.steadyPaceHelp.charAt(0).toLowerCase()}{PROGRESS_COPY.steadyPaceHelp.slice(1)}</span> : null}
				</section>
			</div>

			{/* What to do next: one band in the module's colour, with its one button. Anything else that needs attention is a line inside it. */}
			<section aria-labelledby="na">
				<Tint module={attention[0]?.module}>
					<div className={attention[0]?.module ? "li-panel li-band" : "li-card li-band"}>
						<span className="li-band-main">
							<span className="li-one-line" style={{ gap: 12 }}>
								{attention[0]?.module ? <ModuleMark module={attention[0].module} small onColour /> : null}
								<h2 id="na" className="li-chip" style={{ margin: 0 }}>{PROGRESS_COPY.attention}</h2>
								<b className="li-band-text" title={attention[0]?.text}>{attention[0]?.text ?? PROGRESS_COPY.nothingNeeds}</b>
							</span>
							{attention.slice(1).map((a) => <span key={a.kind} className="li-small li-band-more"><span title={a.text}>{a.text}</span>{a.action.session ? <button type="button" className="li-link" disabled={busy !== null} onClick={() => start(a.action.session!)}>{a.action.label}</button> : <Link className="li-link" href={a.action.href ?? "/app/library"}>{a.action.label}</Link>}</span>)}
						</span>
						{attention[0] ? act(attention[0], true) : null}
					</div>
				</Tint>
			</section>

			<div className="li-progress-three">
				<section className="li-card li-stack" aria-labelledby="wf" style={{ gap: 10 }}>
					<span className="li-row" style={{ flexWrap: "nowrap", justifyContent: "space-between" }}><h2 id="wf" className="li-h2">{PROGRESS_COPY.whereFrom}</h2><span className="li-chip">{rangeWord}</span></span>
					<div className="li-row" style={{ gap: 16, alignItems: "center", flexWrap: "nowrap", flex: "1 1 auto", minHeight: 0 }}>
						<Ring parts={p.modules.map((m) => ({ code: m.code, colour: moduleLook(m.code).colour, value: m.shares[range].points }))} />
						<div className="li-from-rows">
							{p.modules.map((m) => {
								const share = m.shares[range];
								return (
									<div key={m.code} className="li-row" style={{ gap: 8, flexWrap: "nowrap" }} title={`${m.name} · ${m.hasMaterial ? minutesText(share.minutes) : "no material yet"}`}>
										<ModuleMark module={m.code} small />
										<b style={{ flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}</b>
										{m.hasMaterial && share.minutes > 0 ? <span className="li-small li-muted" style={{ whiteSpace: "nowrap" }}>{minutesText(share.minutes)}</span> : null}
										<b className="li-numeral" style={{ fontSize: "1.25em", minWidth: "2.2ch", textAlign: "right", flex: "none", paddingRight: 2 }}>{share.points.toLocaleString("en-GB")}</b>
									</div>
								);
							})}
						</div>
					</div>
				</section>

				<section className="li-card li-stack" aria-labelledby="ms" style={{ gap: 10 }}>
					<span className="li-row" style={{ flexWrap: "nowrap", justifyContent: "space-between", alignItems: "baseline" }}><h2 id="ms" className="li-h2">{PROGRESS_COPY.milestones}</h2><b className="li-numeral" style={{ fontSize: "1.6em" }}>{PROGRESS_COPY.earned(ms.earned, ms.total)}</b></span>
					{/* Blocks you can count: one per milestone, mint when it is earned. */}
					<span className="li-count" aria-hidden="true">{p.milestones.map((m) => <i key={m.id} data-on={String(!!m.earnedAt)} />)}</span>
					{ms.latest ? <span className="li-one-line"><span className="li-tickbox small" data-on="true" aria-hidden="true"><Icon.check /></span><span className="li-small li-muted">{PROGRESS_COPY.latest} · {day(ms.latest.earnedAt!)}</span><b title={ms.latest.title}>{ms.latest.title}</b></span> : null}
					{ms.next ? <span className="li-one-line"><span className="li-tickbox small" aria-hidden="true" /><span className="li-small li-muted">{PROGRESS_COPY.next}</span><b title={`${ms.next.title}: ${ms.next.how}`}>{ms.next.title}</b></span> : <span className="li-muted">{PROGRESS_COPY.allEarned}</span>}
					<span className="li-grow" />
					<button type="button" className="li-btn" style={{ alignSelf: "flex-start" }} onClick={() => setPanel("milestones")}>{PROGRESS_COPY.seeAll(ms.total)}<Icon.arrow /></button>
				</section>

				<section className="li-card li-stack" aria-labelledby="rv" style={{ gap: 10 }}>
					<span className="li-row" style={{ flexWrap: "nowrap", justifyContent: "space-between", alignItems: "baseline" }}><h2 id="rv" className="li-h2">{PROGRESS_COPY.toRevisit}</h2>{gapModules.length ? <b className="li-numeral" style={{ fontSize: "1.6em" }}>{GAP_COPY.ideas(gaps.data!.ideas)}</b> : null}</span>
					{gaps.data && gapModules.length === 0 ? <span className="li-muted">{GAP_COPY.empty}</span> : null}
					{gapModules.length ? (
						<>
							<div className="li-from-rows">
								{gapModules.map((m) => (
									<div key={m.code} className="li-row" style={{ gap: 8, flexWrap: "nowrap" }}>
										<ModuleMark module={m.code} small />
										<b style={{ flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}</b>
										<span className="li-status revisit"><Icon.ring />{m.ideas.length}</span>
									</div>
								))}
							</div>
							<button type="button" className="li-btn" style={{ alignSelf: "flex-start" }} onClick={() => setPanel("revisit")}>{PROGRESS_COPY.seeIdeas}<Icon.arrow /></button>
						</>
					) : null}
				</section>
			</div>

			{/* All the milestones: earned from real history, dated, and kept (V-35). */}
			{panel === "milestones" ? (
				<SidePanel title={`${PROGRESS_COPY.milestones} · ${PROGRESS_COPY.earned(ms.earned, ms.total)}`} onClose={() => setPanel(null)}>
					{(Object.keys(MILESTONE_GROUPS) as (keyof typeof MILESTONE_GROUPS)[]).map((g) => (
						<div key={g} className="li-stack" style={{ gap: 8 }}>
							<b>{MILESTONE_GROUPS[g]}</b>
							<div className="li-milestones">
								{p.milestones.filter((m) => m.group === g).map((m) => (
									<div key={m.id} className="li-milestone" data-earned={m.earnedAt ? "true" : "false"}>
										<span className="li-tickbox" data-on={m.earnedAt ? "true" : undefined} aria-hidden="true">{m.earnedAt ? <Icon.check /> : null}</span>
										<b>{m.title}</b>
										<span className="li-small">{m.earnedAt ? day(m.earnedAt) : m.how}</span>
									</div>
								))}
							</div>
						</div>
					))}
				</SidePanel>
			) : null}
			{/* Gaps by idea (V-39): module, then idea, then the questions missed. */}
			{panel === "revisit" ? (
				<SidePanel title={GAP_COPY.title} onClose={() => setPanel(null)}>
					<GapsByIdea data={gaps.data ?? null} first={first} bare />
				</SidePanel>
			) : null}
		</>
	);
}
