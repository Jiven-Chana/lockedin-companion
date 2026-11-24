"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { moduleHue, weekLabel } from "@/src/core";
import { lockedIn } from "../api";
import { useData } from "../hooks";
import { StatusTag } from "../icons";
import { Tint } from "../root";
import { PageHead } from "../shell";

/** Progress (F-08): plain numbers, ideas to revisit, the roadmap. Never "overdue", never a streak (R-6). */
export function ProgressScreen() {
	const router = useRouter();
	const progress = useData(() => lockedIn.progress());
	const misses = useData(() => lockedIn.misses());
	const p = progress.data;

	async function start(kind: "retest" | "try-now", lectureId: string, spec?: object) {
		const { sessionId } = await lockedIn.startSession({ ...(spec ?? {}), kind, lectureId });
		router.push(`/app/session/${sessionId}`);
	}

	const byLecture = new Map<string, NonNullable<typeof misses.data>>();
	for (const m of misses.data ?? []) byLecture.set(m.lectureId, [...(byLecture.get(m.lectureId) ?? []), m]);

	return (
		<>
			<PageHead eyebrow="Progress" title="Where you are" />
			{p?.welcomeBack ? (
				<Tint hue={285}>
					<button type="button" className="li-hero" onClick={() => start("try-now", p.welcomeBack!.spec.lectureId, p.welcomeBack!.spec)}>
						<span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
							<span className="li-eyebrow" style={{ color: "inherit", opacity: 0.85 }}>Welcome back</span>
							<span className="li-hero-title">{p.welcomeBack.text}</span>
							<span style={{ opacity: 0.9 }}>Nothing has gone anywhere.</span>
						</span>
						<span className="li-hero-cta">Start</span>
					</button>
				</Tint>
			) : null}
			<div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 16 }}>
				{[["sessions this week", p?.week.sessions], ["questions answered", p?.week.questionsAnswered], ["ideas ready to revisit", p?.week.readyToRevisit]].map(([label, n]) => (
					<div key={String(label)} className="li-card flat"><b className="li-display" style={{ fontSize: "2.4em", display: "block" }}>{n ?? "–"}</b><span className="li-muted">{label}</span></div>
				))}
			</div>

			<section className="li-stack" aria-labelledby="rv">
				<h2 id="rv" className="li-h2">Ideas to revisit</h2>
				{(misses.data ?? []).length === 0 ? <div className="li-card flat li-muted">Nothing yet. Anything you get wrong, or right but unsure, comes back here in a short retest a day or two later.</div> : null}
				{/* Every card on this page is the same neutral card; the module's colour is only the dot (v1.0 V-1). */}
				{[...byLecture.entries()].map(([lectureId, list]) => (
					<div key={lectureId} className="li-card li-stack" style={{ gap: 10 }}>
						<div className="li-row">
							<ModuleDot code={list[0]!.module || "HCI"} />
							<b style={{ flexGrow: 1 }}>{list[0]!.module} · {list[0]!.lectureTitle}</b>
							<button type="button" className="li-btn primary" onClick={() => start("retest", lectureId)}>Revisit now</button>
						</div>
						{list.map((m) => (
							<div key={m.id} className="li-row" style={{ alignItems: "flex-start", flexWrap: "nowrap" }}>
								<StatusTag status="revisit" />
								<span style={{ display: "flex", flexDirection: "column" }}><span>{m.questionText}</span><span className="li-small li-muted">Answer: {m.correctLabels.join("; ")}</span></span>
							</div>
						))}
					</div>
				))}
			</section>

			<section className="li-stack" aria-labelledby="rm">
				<h2 id="rm" className="li-h2">Roadmap</h2>
				<div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 16 }}>
					{Object.entries(p?.roadmap ?? {}).map(([code, list]) => (
						<div key={code} className="li-card li-stack" style={{ gap: 8 }}>
							<div className="li-row" style={{ gap: 8 }}><ModuleDot code={code} /><b className="li-display" style={{ fontSize: "1.2em" }}>{code}</b></div>
							{list.map((l) => (
								<Link key={l.id} href={`/app/library/${l.id}`} className="li-row" style={{ flexWrap: "nowrap" }}>
									<span className="li-small li-muted li-week-label">{weekLabel(l.week)}</span>
									<span style={{ flexGrow: 1, minWidth: 0 }}>{l.title}</span>
									<StatusTag status={l.status === "revisit" ? "revisit" : l.status === "answered" ? "answered" : "notyet"} />
								</Link>
							))}
						</div>
					))}
				</div>
			</section>
		</>
	);
}

/** The module's colour as a dot: the only tinted thing on a Progress card. */
function ModuleDot({ code }: { code: string }) {
	return <Tint hue={moduleHue(code)} style={{ display: "inline-flex" }}><span className="li-dot" style={{ background: "var(--li-accent)" }} /></Tint>;
}
