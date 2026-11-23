"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AI_COPY, moduleHue, SESSION_BUDGETS, SESSION_COPY, sessionKindForNudge, type SessionSpec } from "@/src/core";
import { lockedIn, type SessionView } from "../api";
import { fmtDay, fmtTime, useData, useLocalFlag, usePoll } from "../hooks";
import { FocusRing, Icon, StatusTag } from "../icons";
import { Tint, useLockedIn } from "../root";
import { PageHead } from "../shell";

function greeting(d: Date) {
	const h = d.getHours();
	return h < 5 ? "Still up?" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : h < 22 ? "Good evening" : "Good night";
}

export function TodayScreen() {
	const router = useRouter();
	const { now } = useLockedIn();
	const today = useData(() => lockedIn.today());
	const progress = useData(() => lockedIn.progress());
	const ai = useData(() => lockedIn.ai.status());
	const [active, setActive] = useState<SessionView | null>(null);
	const [busy, setBusy] = useState(false);

	const reloadToday = today.reload;
	const reloadProgress = progress.reload;
	useEffect(() => {
		const r = () => { void reloadToday(); void reloadProgress(); };
		window.addEventListener("li:refresh", r);
		window.addEventListener("li:clock", r);
		return () => { window.removeEventListener("li:refresh", r); window.removeEventListener("li:clock", r); };
	}, [reloadToday, reloadProgress]);
	usePoll(() => void today.reload(), 30_000, true);

	const t = today.data;
	useEffect(() => {
		if (t?.activeSession) lockedIn.session(t.activeSession).then(setActive).catch(() => setActive(null));
		else setActive(null);
	}, [t?.activeSession]);

	async function start(spec: Partial<SessionSpec> & { kind: SessionSpec["kind"]; lectureId: string }) {
		setBusy(true);
		try {
			const { sessionId } = await lockedIn.startSession(spec);
			router.push(`/app/session/${sessionId}`);
		} finally {
			setBusy(false);
		}
	}
	async function openNudge(id: string) {
		const r = await lockedIn.nudge(id, "open");
		if (r.sessionId) router.push(`/app/session/${r.sessionId}`);
	}

	const lectures = t?.lectures ?? [];
	const lectureTitle = (id: string) => lectures.find((l) => l.id === id)?.title;

	let hero: { hue: number; eyebrow: string; title: string; sub: string; cta: string; done: number; total: number; go: () => void } | null = null;
	if (t?.banner && t.banner.sessionId) {
		const b = t.banner;
		hero = { hue: moduleHue(b.lectureId?.split("-")[0] ?? "HCI"), eyebrow: b.ready ? "Ready now · question 1 is waiting" : "Getting it ready", title: lectureTitle(b.lectureId ?? "") ?? "Your session", sub: b.text, cta: "Open", done: 0, total: SESSION_BUDGETS[sessionKindForNudge(b.type)].questions, go: () => void openNudge(b.id) };
	} else if (active && active.status !== "done") {
		hero = { hue: moduleHue(active.lecture.module), eyebrow: `${active.lecture.module} · pick up where you left off`, title: active.lecture.title, sub: `${Math.max(0, active.budget - active.answered)} questions left`, cta: "Continue", done: active.answered, total: active.budget, go: () => router.push(`/app/session/${active.id}`) };
	} else if (t?.welcomeBack) {
		const wb = t.welcomeBack;
		hero = { hue: 285, eyebrow: "Welcome back", title: SESSION_COPY.welcomeBackQuestion(), sub: "Nothing has gone anywhere. Start small.", cta: "Start", done: 0, total: wb.spec.budget.questions, go: () => void start(wb.spec) };
	} else if (t?.tryNow) {
		const tn = t.tryNow;
		hero = { hue: moduleHue(tn.module), eyebrow: `${tn.module} · try it now`, title: tn.title, sub: SESSION_COPY.tryNow(), cta: "Try it", done: 0, total: tn.spec.budget.questions, go: () => void start(tn.spec) };
	} else {
		const l = lectures.find((x) => x.hasMaterials) ?? null;
		if (l) hero = { hue: moduleHue(l.module), eyebrow: `${l.module} · today's lecture`, title: l.title, sub: SESSION_COPY.quizMe(), cta: "Quiz me", done: 0, total: SESSION_BUDGETS["post-lecture"].questions, go: () => void start({ kind: "post-lecture", lectureId: l.id }) };
	}

	return (
		<>
			<PageHead eyebrow={now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })} title={greeting(now)} />
			{ai.data && !ai.data.ready ? (
				<div className="li-note li-row" role="status" style={{ gap: 12 }}>
					<span style={{ flexGrow: 1 }}>{ai.data.blocker && ai.data.provider ? ai.data.blocker : AI_COPY.fallback}</span>
					<Link href="/app/me#ai" className="li-btn">{AI_COPY.fallbackAction}</Link>
				</div>
			) : null}
			{today.error ? <div className="li-card">Couldn&apos;t load today: {today.error.message}</div> : null}
			<StarterCards />
			<div className="li-grid-2">
				<div className="li-stack" style={{ gap: 24 }}>
					{hero ? (
						<Tint hue={hero.hue}>
							<button type="button" className="li-hero" onClick={hero.go} disabled={busy}>
								<span style={{ position: "relative", display: "inline-flex" }}>
									<FocusRing done={hero.done} total={hero.total} size={84} stroke="#ffffff" track="rgba(255,255,255,0.25)" label={`${hero.done} of ${hero.total}`} />
									<span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}><Icon.play /></span>
								</span>
								<span style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
									<span className="li-eyebrow" style={{ color: "inherit", opacity: 0.85 }}>{hero.eyebrow}</span>
									<span className="li-hero-title">{hero.title}</span>
									<span style={{ opacity: 0.9 }}>{hero.sub}</span>
								</span>
								<span className="li-hero-cta">{busy ? "Starting…" : hero.cta}</span>
							</button>
						</Tint>
					) : today.loading ? <div className="li-card li-empty">Loading…</div> : null}

					<section className="li-card" aria-labelledby="today-h">
						<h2 id="today-h" className="li-h2" style={{ marginBottom: 8 }}>Today</h2>
						{lectures.length === 0 ? <p className="li-muted" style={{ margin: 0 }}>No lectures today. A good day to revisit something, or to rest.</p> : null}
						{lectures.map((l) => {
							if (!l.start || !l.end) return null;
							const ended = new Date(l.end) <= now;
							return (
								<div key={l.id} className="li-tl">
									<span className="li-tl-time">{fmtTime(l.start)}–{fmtTime(l.end)}</span>
									<Tint hue={moduleHue(l.module)}><span className="li-dot" style={{ display: "block", background: "var(--li-accent)" }} /></Tint>
									<span style={{ flexGrow: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
										<Link href={`/app/library/${l.id}`}><b>{l.module} · {l.title}</b></Link>
										<span className="li-small li-muted">{l.kind === "event" ? "Timetabled" : ended ? (l.attended === false ? "You weren't there · it'll be offered this evening" : "Lecture · ended") : "Lecture · coming up"}</span>
									</span>
									{l.kind !== "event" && l.status !== "not-started" ? <StatusTag status={l.status === "revisit" ? "revisit" : "answered"} /> : null}
									{l.kind !== "event" && ended ? (
										<button type="button" className="li-btn ghost li-small" onClick={async () => { await lockedIn.missed(l.id, l.attended !== false); void today.reload(); }}>
											{l.attended === false ? "Actually, I was there" : "I wasn't there"}
										</button>
									) : null}
								</div>
							);
						})}
					</section>
				</div>

				<div className="li-stack">
					<Link href="/app/progress" className="li-card flat" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
						<h2 className="li-h2" style={{ fontSize: "1.1em" }}>{t?.readyToRevisit ? `${t.readyToRevisit} ${t.readyToRevisit === 1 ? "idea" : "ideas"} ready to revisit` : "Nothing to revisit yet"}</h2>
						<span className="li-small li-muted">{t?.readyToRevisit ? "They come back in a short retest. No rush." : "Misses from your sessions show up here, never as \"overdue\"."}</span>
					</Link>
					<section className="li-card flat" aria-labelledby="week-h">
						<h2 id="week-h" className="li-h2" style={{ fontSize: "1.1em", marginBottom: 8 }}>This week</h2>
						<div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
							<span style={{ display: "flex", flexDirection: "column" }}><b className="li-display" style={{ fontSize: "1.8em" }}>{progress.data?.week.sessions ?? "–"}</b><span className="li-small li-muted">sessions</span></span>
							<span style={{ display: "flex", flexDirection: "column" }}><b className="li-display" style={{ fontSize: "1.8em" }}>{progress.data?.week.questionsAnswered ?? "–"}</b><span className="li-small li-muted">questions answered</span></span>
						</div>
					</section>
					<Link href="/app/plan" className="li-card flat li-row" style={{ background: "var(--li-soft)", borderColor: "transparent" }}>
						<span style={{ color: "var(--li-accent-text)" }}><Icon.calendar /></span>
						<span style={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
							<b>Next study block</b>
							<span className="li-small li-muted">{t?.nextBlock ? `${fmtDay(t.nextBlock.start, now)} ${fmtTime(t.nextBlock.start)}` : "None yet. Plan your week."}</span>
						</span>
					</Link>
					<Link href="/app/me" className="li-btn" style={{ alignSelf: "flex-start" }}>
						<span aria-hidden="true" style={{ width: 16, height: 16, borderRadius: 999, background: "conic-gradient(oklch(0.6 0.16 0), oklch(0.6 0.16 120), oklch(0.6 0.16 240), oklch(0.6 0.16 360))" }} />
						Make it yours
					</Link>
				</div>
			</div>
		</>
	);
}

/**
 * Optional next steps after the first taste (spec J1′ step 5), each one
 * dismissible. "Get questions on your phone" joins when the phone app ships
 * (F-112).
 */
function StarterCards() {
	const [hideSlides, setHideSlides] = useLocalFlag("li-card-slides");
	const [hidePlan, setHidePlan] = useLocalFlag("li-card-plan");
	const cards = [
		!hideSlides && { key: "slides", title: "Add your slides", sub: "Lectures, a week or a whole semester. I'll write the questions.", href: "/app/library", dismiss: () => setHideSlides(true) },
		!hidePlan && { key: "plan", title: "Plan my week with me (2 min)", sub: "A few quick questions, then study blocks in your free time.", href: "/app/plan/chat", dismiss: () => setHidePlan(true) },
	].filter(Boolean) as { key: string; title: string; sub: string; href: string; dismiss: () => void }[];
	if (!cards.length) return null;
	return (
		<div className="li-row" style={{ gap: 12, alignItems: "stretch" }} aria-label="Next steps">
			{cards.map((c) => (
				<div key={c.key} className="li-card flat li-row" style={{ flex: "1 1 280px", gap: 10 }}>
					<Link href={c.href} style={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
						<b>{c.title}</b>
						<span className="li-small li-muted">{c.sub}</span>
					</Link>
					<button type="button" className="li-btn ghost" onClick={c.dismiss} aria-label={`Dismiss ${c.title}`}>✕</button>
				</div>
			))}
		</div>
	);
}
