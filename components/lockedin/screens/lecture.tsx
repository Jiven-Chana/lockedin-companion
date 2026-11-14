"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { moduleHue, type SessionKind } from "@/src/core";
import { lockedIn } from "../api";
import { ConceptMap } from "../concept-map";
import { fmtDay, fmtTime, useData } from "../hooks";
import { StatusTag } from "../icons";
import { Prose } from "../prose";
import { Tint, useLockedIn } from "../root";

type Tab = "map" | "slides" | "revisit";

export function LectureScreen({ lectureId }: { lectureId: string }) {
	const router = useRouter();
	const { now } = useLockedIn();
	const [tab, setTab] = useState<Tab>("map");
	const [selected, setSelected] = useState<string | null>(null);
	const [openSlide, setOpenSlide] = useState<number | null>(null);
	const [busy, setBusy] = useState(false);
	const lectures = useData(() => lockedIn.lectures());
	const slides = useData(() => lockedIn.slides(lectureId), [lectureId]);
	const map = useData(() => lockedIn.map(lectureId), [lectureId]);
	const misses = useData(() => lockedIn.misses(lectureId), [lectureId]);

	const lecture = lectures.data?.find((l) => l.id === lectureId);
	if (lectures.data && !lecture) return <div className="li-card li-empty">That lecture isn&apos;t in your timetable. <Link href="/app/library">Back to the Library</Link></div>;
	if (!lecture) return <div className="li-card li-empty">Loading…</div>;

	async function start(kind: SessionKind) {
		setBusy(true);
		try {
			const { sessionId } = await lockedIn.startSession({ kind, lectureId });
			router.push(`/app/session/${sessionId}`);
		} finally {
			setBusy(false);
		}
	}

	const node = map.data?.nodes.find((n) => n.id === selected) ?? null;
	const gaps = (map.data?.nodes ?? []).filter((n) => n.status === "revisit" || n.status === "shaky").length;
	const openMisses = misses.data ?? [];

	return (
		<Tint hue={moduleHue(lecture.module)}>
			<div className="li-stack" style={{ gap: 24 }}>
				<header className="li-row" style={{ alignItems: "flex-end", paddingRight: 420 }}>
					<div style={{ display: "flex", flexDirection: "column", gap: 4, flexGrow: 1 }}>
						<Link href="/app/library" className="li-eyebrow">‹ Library · {lecture.module} · Week {lecture.week}</Link>
						<h1 className="li-h1">{lecture.title}</h1>
						<span className="li-muted">{fmtDay(lecture.start, now)} {fmtTime(lecture.start)}–{fmtTime(lecture.end)}{lecture.attended === false ? " · you weren't there" : ""}</span>
					</div>
				</header>
				<div className="li-row">
					<button type="button" className="li-btn primary big" disabled={!lecture.hasMaterials || busy} onClick={() => start(lecture.attended === false ? "missed-lecture" : "post-lecture")}>{lecture.attended === false ? "Show me this lecture" : "Quiz me"}</button>
					<button type="button" className="li-btn" disabled={openMisses.length === 0 || busy} onClick={() => start("retest")}>Revisit what I missed{openMisses.length ? ` (${openMisses.length})` : ""}</button>
					<button type="button" className="li-btn ghost" onClick={async () => { await lockedIn.missed(lectureId, lecture.attended !== false); void lectures.reload(); }}>{lecture.attended === false ? "Actually, I was there" : "I wasn't there"}</button>
				</div>

				<div role="tablist" aria-label="Lecture" className="li-seg" style={{ alignSelf: "flex-start" }}>
					{([["map", "Concept map"], ["slides", `Slides (${slides.data?.length ?? 0})`], ["revisit", `Ideas to revisit (${openMisses.length})`]] as [Tab, string][]).map(([k, label]) => (
						<button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{label}</button>
					))}
				</div>

				{tab === "map" ? (
					<div className="li-grid-2">
						<div className="li-stack">
							<span className="li-small li-muted">✓ solid · ◐ shaky · ○ to revisit · · not yet. From your answers, never your attendance.{map.data?.source === "headings" ? " This starter map follows the slide headings; your first teaching session refines it." : ""}</span>
							{map.data ? <ConceptMap data={map.data} selected={selected} onSelect={setSelected} /> : <div className="li-card li-empty">{map.error ? "No map for this lecture yet." : "Loading the map…"}</div>}
						</div>
						<aside className="li-card" style={{ position: "sticky", top: 24 }}>
							{node ? (
								<div className="li-stack" style={{ gap: 12 }}>
									<span><StatusTag status={node.status} /></span>
									<h2 className="li-h2" style={{ fontSize: "1.5em" }}>{node.title}</h2>
									<span className="li-small li-muted">
										{(() => {
											const needs = (map.data?.edges ?? []).filter((e) => e.to === node.id).map((e) => map.data?.nodes.find((n) => n.id === e.from)?.title).filter(Boolean);
											const leads = (map.data?.edges ?? []).filter((e) => e.from === node.id).map((e) => map.data?.nodes.find((n) => n.id === e.to)?.title).filter(Boolean);
											return `${needs.length ? `Needs: ${needs.join(", ")}. ` : ""}${leads.length ? `Leads to: ${leads.join(", ")}.` : ""}`;
										})()}
									</span>
									<span>{node.answers ? `${node.answers} ${node.answers === 1 ? "answer" : "answers"} landed here.` : "You haven't been asked about this yet."}</span>
									<div className="li-row">
										<button type="button" className="li-btn primary" disabled={busy || !lecture.hasMaterials} onClick={() => start(node.status === "revisit" && openMisses.length ? "retest" : "post-lecture")}>Quiz me on this</button>
										{node.slides[0] ? <button type="button" className="li-btn" onClick={() => { setOpenSlide(node.slides[0]!); setTab("slides"); }}>Open slide {node.slides[0]}</button> : null}
									</div>
								</div>
							) : (
								<div className="li-stack" style={{ gap: 10 }}>
									<h2 className="li-h2">Pick an idea</h2>
									<span className="li-muted">Click a box on the map to see where you are with it.</span>
									{gaps ? <button type="button" className="li-btn soft" style={{ alignSelf: "flex-start" }} disabled={busy} onClick={() => start(openMisses.length ? "retest" : "post-lecture")}>Quiz the gaps ({gaps})</button> : null}
								</div>
							)}
						</aside>
					</div>
				) : null}

				{tab === "slides" ? (
					<div className="li-stack" style={{ gap: 10 }}>
						{(slides.data ?? []).length === 0 ? <div className="li-card li-empty">No slides yet for this lecture.</div> : null}
						{(slides.data ?? []).map((s) => (
							<details key={s.number} className="li-card flat" open={openSlide === s.number} style={{ padding: "14px 20px" }}>
								<summary style={{ cursor: "pointer", fontWeight: 700 }}><span className="li-muted">Slide {s.number} · </span>{s.title}</summary>
								<div style={{ marginTop: 10 }}><Prose text={s.body} /></div>
							</details>
						))}
					</div>
				) : null}

				{tab === "revisit" ? (
					<div className="li-stack" style={{ gap: 10 }}>
						{openMisses.length === 0 ? <div className="li-card li-empty">Nothing to revisit here. Anything you miss shows up here, never as &quot;overdue&quot;.</div> : null}
						{openMisses.map((m) => (
							<div key={m.id} className="li-card flat li-stack" style={{ gap: 6 }}>
								<b>{m.questionText}</b>
								<span><span className="li-muted">Answer:</span> {m.correctLabels.join("; ")}</span>
								{m.explanation ? <span className="li-small li-muted"><Prose text={m.explanation} onSlide={(n) => { setOpenSlide(n); setTab("slides"); }} /></span> : null}
							</div>
						))}
					</div>
				) : null}
			</div>
		</Tint>
	);
}
