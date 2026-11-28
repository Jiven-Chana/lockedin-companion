"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LEARN_COPY, PACK_COPY, PRACTISE_COPY, packStatusLine, weekLabel, MATERIALS_RULES } from "@/src/core";
import { ApiError, lockedIn, type PackData, type SlideSection } from "../api";
import { ConceptMap } from "../concept-map";
import { ExplainerCard } from "../explainer-card";
import { fmtDay, fmtTime, useData, usePoll } from "../hooks";
import { StatusTag } from "../icons";
import { Prose } from "../prose";
import { Tint, useLockedIn } from "../root";
import { SetWeek } from "../set-week";
import { SlidePage } from "../slide-page";

type Tab = "map" | "explainers" | "slides" | "revisit";

export function LectureScreen({ lectureId }: { lectureId: string }) {
	const router = useRouter();
	const { now } = useLockedIn();
	const [tab, setTab] = useState<Tab>("map");
	const [selected, setSelected] = useState<string | null>(null);
	const [openSlide, setOpenSlide] = useState<number | null>(null);
	const [busy, setBusy] = useState(false);
	const [msg, setMsg] = useState<string | null>(null);
	const [confirmRemove, setConfirmRemove] = useState(false);
	const lectures = useData(() => lockedIn.lectures());
	const slides = useData(() => lockedIn.slides(lectureId), [lectureId]);
	const map = useData(() => lockedIn.map(lectureId), [lectureId]);
	const misses = useData(() => lockedIn.misses(lectureId), [lectureId]);
	const pack = useData(() => lockedIn.pack(lectureId).catch(() => null), [lectureId]);
	const packRunning = !!pack.data?.running;
	usePoll(() => {
		void pack.reload();
		if (pack.data?.meta?.stages.map === "running") void map.reload();
	}, 2_000, packRunning);

	const lecture = lectures.data?.find((l) => l.id === lectureId);
	if (lectures.data && !lecture) return <div className="li-card li-empty">That isn&apos;t in your course any more. <Link href="/app/library">Back to the Library</Link></div>;
	if (!lecture) return <div className="li-card li-empty">Loading…</div>;

	// Two ways to study (V-40): Learn is the tutor, Practise is quick questions from the bank.
	async function go(start: () => Promise<{ sessionId: string }>) {
		setBusy(true);
		setMsg(null);
		try {
			router.push(`/app/session/${(await start()).sessionId}`);
		} catch (e) {
			setMsg(e instanceof ApiError ? e.message : "Couldn't start that");
		} finally {
			setBusy(false);
		}
	}
	const learn = (nodes?: string[]) => go(() => lockedIn.startLearn({ lectureId, ...(nodes?.length ? { nodes } : {}) }));
	const practise = (kind: "post-lecture" | "retest" = "post-lecture") => go(() => lockedIn.startSession({ kind, lectureId, study: "practise" }));

	const node = map.data?.nodes.find((n) => n.id === selected) ?? null;
	const gaps = (map.data?.nodes ?? []).filter((n) => n.status === "revisit" || n.status === "shaky").length;
	const openMisses = misses.data ?? [];

	return (
		<Tint module={lecture.module}>
			<div className="li-stack" style={{ gap: 24 }}>
				<header className="li-row" style={{ alignItems: "flex-end", paddingRight: 420 }}>
					<div style={{ display: "flex", flexDirection: "column", gap: 4, flexGrow: 1 }}>
						<Link href="/app/library" className="li-eyebrow">‹ Library · {lecture.module}{lecture.week > 0 ? ` · ${weekLabel(lecture.week)}` : ""}</Link>
						<h1 className="li-h1">{lecture.title}</h1>
						<span className="li-muted li-row" style={{ gap: 8 }}>
							{lecture.start && lecture.end ? `${fmtDay(lecture.start, now)} ${fmtTime(lecture.start)}–${fmtTime(lecture.end)}` : `${weekLabel(lecture.week)} · from your course material`}{lecture.attended === false ? " · you weren't there" : ""}
							{!lecture.start && !(lecture.week > 0) ? <SetWeek lectureId={lecture.id} title={lecture.title} onSaved={() => void lectures.reload()} /> : null}
						</span>
					</div>
				</header>
				<div className="li-row">
					<button type="button" className="li-btn primary big" disabled={!lecture.hasMaterials || busy} onClick={() => void learn()}>{LEARN_COPY.button}</button>
					<button type="button" className="li-btn big" disabled={!lecture.hasMaterials || busy} onClick={() => void practise()}>{PRACTISE_COPY.thisButton}</button>
					<button type="button" className="li-btn" disabled={openMisses.length === 0 || busy} onClick={() => void practise("retest")}>Revisit what I missed{openMisses.length ? ` (${openMisses.length})` : ""}</button>
					{lecture.start ? <button type="button" className="li-btn ghost" onClick={async () => { await lockedIn.missed(lectureId, lecture.attended !== false); void lectures.reload(); }}>{lecture.attended === false ? "Actually, I was there" : "I wasn't there"}</button> : null}
					<label className="li-btn ghost" style={{ cursor: "pointer" }}>
						{lecture.hasMaterials ? "Replace material" : "Add slides or notes"}
						<input type="file" accept={MATERIALS_RULES.accept} className="li-sr" onChange={async (e) => {
							const f = e.target.files?.[0];
							if (!f) return;
							setMsg("Reading your slides…");
							try {
								const r = await lockedIn.replaceMaterials(lectureId, f);
								setMsg(`${r.slideCount} slides added${r.needsCaption.length ? `; no text found on ${r.needsCaption.length}` : ""}.`);
								void lectures.reload(); void slides.reload(); void map.reload();
							} catch (err) {
								setMsg(err instanceof ApiError ? err.message : "Couldn't read that file");
							}
						}} />
					</label>
					{lecture.hasMaterials ? (
						confirmRemove ? (
							<span className="li-row" style={{ gap: 8 }}>
								<b>{lecture.start ? "Remove the slides you added?" : "Remove this unit?"}</b>
								<button type="button" className="li-btn primary" onClick={async () => { await lockedIn.removeMaterials(lectureId); setConfirmRemove(false); if (!lecture.start) router.push("/app/library"); else { void lectures.reload(); void slides.reload(); } }}>Remove</button>
								<button type="button" className="li-btn" onClick={() => setConfirmRemove(false)}>Keep</button>
							</span>
						) : <button type="button" className="li-btn ghost" onClick={() => setConfirmRemove(true)}>Remove</button>
					) : null}
				</div>
				{msg ? <div className="li-note" role="status">{msg}</div> : null}
				{lecture.hasMaterials ? (
					<PackProgress
						data={pack.data ?? null}
						onStart={async (fresh) => {
							try {
								await lockedIn.startPack(lectureId, fresh);
								void pack.reload();
							} catch (e) {
								setMsg(e instanceof ApiError ? e.message : "Couldn't start the study pack");
							}
						}}
						onCancel={async () => { await lockedIn.cancelPack(lectureId); void pack.reload(); }}
					/>
				) : null}

				<div role="tablist" aria-label="Lecture" className="li-seg" style={{ alignSelf: "flex-start" }}>
					{([["map", "Concept map"], ["explainers", `Explainers (${pack.data?.explainers.length ?? 0})`], ["slides", `Slides (${slides.data?.slides.length ?? 0})`], ["revisit", `Ideas to revisit (${openMisses.length})`]] as [Tab, string][]).map(([k, label]) => (
						<button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{label}</button>
					))}
				</div>

				{tab === "map" ? (
					<div className="li-grid-2">
						<div className="li-stack">
							<span className="li-row li-small" style={{ gap: 8 }}><StatusTag status="solid" /><StatusTag status="shaky" /><StatusTag status="revisit" /><StatusTag status="notyet" /><span className="li-muted">From your answers, never your attendance.{map.data?.source === "headings" ? " This starter map follows the slide headings; your first teaching session refines it." : ""}</span></span>
							{map.data ? <div className="li-card" style={{ padding: 18 }}><ConceptMap data={map.data} selected={selected} onSelect={(node) => { setSelected(node); void lockedIn.event("map_node_clicked", { lectureId, node }); }} /></div> : <div className="li-card li-empty">{map.error ? "No map for this lecture yet." : "Loading the map…"}</div>}
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
									{(() => {
										const ex = pack.data?.explainers.find((e) => e.node === node.id);
										return ex ? <ExplainerCard explainer={ex} onSlide={(n) => { setOpenSlide(n); setTab("slides"); }} /> : null;
									})()}
									<div className="li-row">
										<button type="button" className="li-btn primary" disabled={busy || !lecture.hasMaterials} onClick={() => void learn([node.id])}>{LEARN_COPY.ideaButton}</button>
										{node.slides[0] ? <button type="button" className="li-btn" onClick={() => { setOpenSlide(node.slides[0]!); setTab("slides"); }}>Open slide {node.slides[0]}</button> : null}
									</div>
								</div>
							) : (
								<div className="li-stack" style={{ gap: 10 }}>
									<h2 className="li-h2">Pick an idea</h2>
									<span className="li-muted">Click a box on the map to see where you are with it.</span>
									{gaps ? <button type="button" className="li-btn soft" style={{ alignSelf: "flex-start" }} disabled={busy} onClick={() => void practise(openMisses.length ? "retest" : "post-lecture")}>Practise the gaps ({gaps})</button> : null}
								</div>
							)}
						</aside>
					</div>
				) : null}

				{tab === "explainers" ? (
					<div className="li-stack" style={{ gap: 14 }}>
						{(pack.data?.explainers ?? []).length === 0 ? <div className="li-card li-empty">{packRunning ? "Your explainers are being written…" : "No explainers yet. They come with the study pack."}</div> : null}
						{(pack.data?.explainers ?? []).map((e) => (
							<ExplainerCard
								key={e.id}
								explainer={e}
								busy={busy}
								onSlide={(n) => { setOpenSlide(n); setTab("slides"); }}
								onTry={() => { void lockedIn.event("explainer_opened", { lectureId, node: e.node, via: "try" }); void learn([e.node]); }}
							/>
						))}
					</div>
				) : null}

				{tab === "slides" ? (
					<div className="li-stack" style={{ gap: 10 }}>
						{(slides.data?.slides ?? []).length === 0 ? <div className="li-card li-empty">No slides yet for this lecture.</div> : null}
						{(slides.data?.slides ?? []).map((s) => (
							<SlideRow key={s.number} lectureId={lectureId} slide={s} hasPdf={slides.data?.hasPdf ?? false} open={openSlide === s.number} />
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

const PACK_ORDER = ["read", "map", "bank", "explainers"] as const;
const STAGE_LABEL: Record<(typeof PACK_ORDER)[number], string> = { read: "Reading your slides", map: "drawing the map", bank: "writing questions", explainers: "writing explainers" };

/** The study pack's work, shown as it happens (AE2-2: never a bare spinner). */
function PackProgress({ data, onStart, onCancel }: { data: PackData | null; onStart: (fresh: boolean) => void; onCancel: () => void }) {
	const meta = data?.meta;
	if (!meta) {
		return (
			<div className="li-row li-note" style={{ gap: 10 }}>
				<span style={{ flexGrow: 1 }}>No study pack yet: a concept map, short explainers and practice questions written from these slides.</span>
				<button type="button" className="li-btn primary" onClick={() => onStart(false)}>Write the study pack</button>
			</div>
		);
	}
	const line = packStatusLine(meta);
	return (
		<div className="li-row li-note" style={{ gap: 10 }} role="status" aria-live="polite">
			<span style={{ flexGrow: 1 }}>
				{PACK_ORDER.map((s, i) => {
					const st = meta.stages[s];
					const mark = st === "done" || st === "skipped" ? " ✓" : st === "running" ? "…" : st === "failed" ? " ✕" : "";
					return (
						<span key={s} className="li-pack-stage" data-state={st}>
							{i ? " → " : ""}
							{STAGE_LABEL[s]}
							{mark ? <span key={st} className={st === "done" || st === "skipped" ? "li-tick" : undefined}>{mark}</span> : null}
						</span>
					);
				})}
				{meta.state === "ready" && meta.counts ? <span className="li-small li-muted"> · {meta.counts.questions} {meta.counts.questions === 1 ? "question" : "questions"}, {meta.counts.explainers} {meta.counts.explainers === 1 ? "explainer" : "explainers"}{meta.costUsd ? ` · $${meta.costUsd.toFixed(3)}` : ""}</span> : null}
				{line ? <span className="li-small"> · {line}</span> : null}
				{meta.state === "cancelled" ? <span className="li-small"> · paused</span> : null}
			</span>
			{data?.running ? <button type="button" className="li-btn" onClick={onCancel}>Cancel</button> : null}
			{!data?.running && meta.state === "cancelled" ? <button type="button" className="li-btn primary" onClick={() => onStart(false)}>Resume</button> : null}
			{/* Trying again only helps when the AI didn't answer: a unit with too little in it needs more material. */}
			{!data?.running && meta.state === "failed" && (meta.failure ?? "no_answer") === "no_answer" ? <button type="button" className="li-btn primary" onClick={() => onStart(false)}>{PACK_COPY.tryAgain}</button> : null}
			{!data?.running && meta.state === "ready" ? <button type="button" className="li-btn ghost" onClick={() => onStart(true)}>Regenerate</button> : null}
		</div>
	);
}

/** One slide in the lecture's list. Its page picture is only asked for once the row is open, so a long deck isn't drawn all at once. */
function SlideRow({ lectureId, slide, hasPdf, open }: { lectureId: string; slide: SlideSection; hasPdf: boolean; open: boolean }) {
	const [isOpen, setIsOpen] = useState(open);
	useEffect(() => setIsOpen(open), [open]);
	return (
		<details className="li-card flat" open={isOpen} onToggle={(e) => setIsOpen(e.currentTarget.open)} style={{ padding: "14px 20px" }}>
			<summary style={{ cursor: "pointer", fontWeight: 700 }}><span className="li-muted">{hasPdf ? "Page" : "Slide"} {slide.number} · </span>{slide.title}</summary>
			{isOpen ? <div className="li-slide-row" style={{ marginTop: 10 }}>{hasPdf ? <SlidePage lectureId={lectureId} slide={slide} hasPdf /> : <Prose text={slide.body} />}</div> : null}
		</details>
	);
}
