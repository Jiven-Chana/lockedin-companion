"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AI_COPY, HANDOFF_COPY, PLAN_COPY, PRACTISE_COPY, SESSION_BUDGETS, SESSION_COPY, sessionKindForNudge, type SessionSpec } from "@/src/core";
import { lockedIn } from "../api";
import { fmtDay, fmtTime, useData, useLocalFlag, usePoll } from "../hooks";
import { Icon, ModuleMark, StatusTag } from "../icons";
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

	/** Start today's study block (V-44): it is marked started, and its session opens when there is material to open. */
	async function startBlock(blockId: string, study?: "learn" | "practise") {
		setBusy(true);
		try {
			const { sessionId } = await lockedIn.startBlock(blockId, study);
			if (sessionId) router.push(`/app/session/${sessionId}`);
			else void today.reload();
		} finally {
			setBusy(false);
		}
	}
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
		if (r.href) router.push(r.href);
		else if (r.sessionId) router.push(`/app/session/${r.sessionId}`);
	}

	const lectures = t?.lectures ?? [];
	const lectureTitle = (id: string) => lectures.find((l) => l.id === id)?.title;

	// The next step, as one large panel in its module's colour (v3.0, Blocks). `module` is null when it belongs to no module.
	let hero: { module: string | null; eyebrow: string; title: string; sub: string; cta: string; done: number; total: number; go: () => void } | null = null;
	if (t?.banner && t.banner.sessionId) {
		const b = t.banner;
		hero = { module: t.bannerModule, eyebrow: b.ready ? HANDOFF_COPY.ready(b.startsAt) : "Getting it ready", title: lectureTitle(b.lectureId ?? "") ?? "Your session", sub: b.text, cta: "Open", done: b.startsAt - 1, total: SESSION_BUDGETS[sessionKindForNudge(b.type)].questions, go: () => void openNudge(b.id) };
	} else if (t?.resume) {
		// A session you left (R-5): where it was saved, and how much is left. Opening it is what resumes it.
		const r = t.resume;
		hero = { module: r.module, eyebrow: `${r.module} · pick up where you left off`, title: r.title, sub: r.text, cta: "Continue", done: r.answered, total: r.budget, go: () => router.push(`/app/session/${r.sessionId}`) };
	} else if (t?.welcomeBack) {
		const wb = t.welcomeBack;
		hero = { module: null, eyebrow: "Welcome back", title: SESSION_COPY.welcomeBackQuestion(), sub: "Nothing has gone anywhere. Start small.", cta: "Start", done: 0, total: wb.spec.budget.questions, go: () => void start(wb.spec) };
	} else if (t?.tryNow) {
		const tn = t.tryNow;
		hero = { module: tn.module, eyebrow: `${tn.module} · try it now`, title: tn.title, sub: SESSION_COPY.tryNow(), cta: "Try it", done: 0, total: tn.spec.budget.questions, go: () => void start(tn.spec) };
	} else {
		const l = lectures.find((x) => x.hasMaterials) ?? null;
		if (l) hero = { module: l.module, eyebrow: `${l.module} · today's lecture`, title: l.title, sub: SESSION_COPY.quizMe(), cta: PRACTISE_COPY.mode, done: 0, total: SESSION_BUDGETS["post-lecture"].questions, go: () => void start({ kind: "post-lecture", lectureId: l.id, study: "practise" }) };
	}
	const nb = t?.nextBlock ?? null;
	const nbLive = !!nb && (nb.canStart || nb.status === "started");
	const revisit = t?.readyToRevisit ?? 0;

	return (
		<>
			{/* Today is one screen (v3.0.1): the next step takes the room the rest leaves, and nothing is cut off at the bottom of the window. */}
			<span className="li-fit li-fill" hidden />
			<div className="li-row" style={{ alignItems: "flex-end", justifyContent: "space-between" }}>
				<PageHead eyebrow={now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })} icon={<Icon.today />} title={greeting(now)} clock />
				<Link href="/app/me#look" className="li-btn"><Icon.palette />Make it yours</Link>
			</div>
			{ai.data && !ai.data.ready ? (
				<div className="li-note li-row" role="status" style={{ gap: 12 }}>
					<span style={{ flexGrow: 1 }}>{ai.data.blocker && ai.data.provider ? ai.data.blocker : AI_COPY.fallback}</span>
					<Link href="/app/me#ai" className="li-btn ghost">{AI_COPY.fallbackAction}</Link>
				</div>
			) : null}
			{today.error ? <div className="li-card">Couldn&apos;t load today: {today.error.message}</div> : null}
			{/* What was done on the phone today (v2.3 part D): one quiet line, never a score. */}
			{t?.onPhone ? <p className="li-row" role="status" style={{ margin: 0, gap: 8 }}><Icon.phone />{t.onPhone}</p> : null}
			<StarterCards phone={!!t?.phoneAvailable && !t.phonePaired} />

			{/* The next step, and the next study block beside it. */}
			<div className="li-grid-2 li-today-top">
				{hero ? (
					<Tint module={hero.module} style={{ display: "flex" }}>
						<section className={hero.module ? "li-hero" : "li-hero plain"} style={{ alignItems: "stretch" }} aria-label="Your next step">
							<span style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0, flex: "1 1 auto", alignItems: "flex-start" }}>
								<span className="li-eyebrow">{hero.module ? <ModuleMark module={hero.module} onColour /> : null}{hero.eyebrow}</span>
								<span className="li-hero-title">{hero.title}</span>
								<span style={{ maxWidth: "46ch" }}>{hero.sub}</span>
								<button type="button" className="li-btn primary big" onClick={hero.go} disabled={busy} style={{ marginTop: "auto" }}>{busy ? "Starting…" : hero.cta}<Icon.arrow /></button>
							</span>
							<Tower done={hero.done} total={hero.total} />
						</section>
					</Tint>
				) : today.loading ? <div className="li-card li-empty">Loading…</div> : <div className="li-card li-empty">Nothing is waiting. Add your slides in the Library and your first session appears here.</div>}

				<Tint module={nb?.module} style={{ display: "flex" }}>
					<section className={nb?.module ? "li-panel li-stack" : "li-card li-stack"} style={{ width: "100%", gap: 12 }} aria-labelledby="nb-h">
						<h2 id="nb-h" className="li-eyebrow" style={{ margin: 0 }}>{nb?.module ? <ModuleMark module={nb.module} onColour /> : <Icon.calendar />}Next study block</h2>
						{nb ? (
							<>
								<span className="li-numeral" style={{ fontSize: "2.9em" }}>{fmtDay(nb.start, now)} {fmtTime(nb.start)}</span>
								<b>{[nb.module, nb.minutes ? `${nb.minutes} min` : null, nb.status === "started" ? PLAN_COPY.startedNote : null].filter(Boolean).join(" · ")}</b>
								{nb.firstStep ? <span className="li-card li-row" style={{ padding: "10px 14px", borderRadius: 14, gap: 10 }}><Icon.slide />{nb.firstStep}</span> : null}
								<span style={{ flexGrow: 1 }} />
								{/* Today's block is started here, or from its notification (V-44). Both ways on look pressable: a tester missed the quiet one. */}
								{nbLive ? <button type="button" className="li-btn" onClick={() => void startBlock(nb.blockId, nb.mode?.study)}>{nb.mode?.study === "practise" ? <Icon.practise /> : <Icon.learn />}{nb.mode?.label ?? (nb.status === "started" ? "Open" : PLAN_COPY.start)}</button> : null}
								{nbLive && nb.mode?.other ? <button type="button" className="li-btn" onClick={() => void startBlock(nb.blockId, nb.mode!.other!.study)}>{nb.mode.other.study === "practise" ? <Icon.practise /> : <Icon.learn />}{nb.mode.other.label}</button> : null}
								{!nbLive ? <Link href="/app/plan" className="li-btn"><Icon.calendar />See your week</Link> : null}
							</>
						) : (
							<>
								<p className="li-muted" style={{ margin: 0 }}>None yet. Plan your week and your study blocks appear here.</p>
								<span style={{ flexGrow: 1 }} />
								<Link href="/app/plan" className="li-btn"><Icon.calendar />Plan your week</Link>
							</>
						)}
					</section>
				</Tint>
			</div>

			{/* Today's lectures, what is ready to revisit, and the week so far. */}
			<div className="li-today-three">
				<section className="li-card" aria-labelledby="today-h">
					<h2 id="today-h" className="li-h2" style={{ marginBottom: 6 }}>Today</h2>
					{lectures.length === 0 ? <p className="li-muted" style={{ margin: 0 }}>No lectures today. A good day to revisit something, or to rest.</p> : null}
					{lectures.map((l) => {
						if (!l.start || !l.end) return null;
						const ended = new Date(l.end) <= now;
						return (
							<div key={l.id} className="li-tl">
								<ModuleMark module={l.module} />
								<span style={{ flexGrow: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
									<span className="li-tl-time">{fmtTime(l.start)}–{fmtTime(l.end)}</span>
									<Link href={`/app/library/${l.id}`} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.module} · {l.kind === "event" ? l.title : "Lecture"}</Link>
								</span>
								{l.kind !== "event" && l.status !== "not-started" ? <StatusTag status={l.status === "revisit" ? "revisit" : "answered"} /> : null}
								<span className="li-chip">{l.kind === "event" ? "timetabled" : ended ? (l.attended === false ? "you weren't there" : "ended") : "coming up"}</span>
								{l.kind !== "event" && ended ? (
									<button type="button" className="li-btn ghost" onClick={async () => { await lockedIn.missed(l.id, l.attended !== false); void today.reload(); }}>
										{l.attended === false ? "Actually, I was there" : "I wasn't there"}
									</button>
								) : null}
							</div>
						);
					})}
				</section>

				<Link href="/app/progress" className="li-card li-stack" style={{ gap: 12 }} aria-label={revisit ? `${revisit} ideas ready to revisit` : "Nothing to revisit yet"}>
					<span className="li-row" style={{ alignItems: "flex-end", gap: 12, flexWrap: "nowrap" }}>
						<span className="li-numeral li-today-num">{revisit}</span>
						<span className="li-h2" style={{ paddingBottom: 6 }}>{revisit === 1 ? "idea ready to revisit" : "ideas ready to revisit"}</span>
					</span>
					{/* Blocks you can count: lilac is "to revisit", everywhere. */}
					{revisit ? <span className="li-count" aria-hidden="true">{Array.from({ length: Math.min(revisit, 24) }, (_, i) => <i key={i} />)}</span> : null}
					<span className="li-tall-only">{revisit ? "They come back in a short retest. No rush." : "What you get wrong shows up here, never as \"overdue\"."}</span>
				</Link>

				<section className="li-panel ink li-stack" style={{ gap: 14 }} aria-labelledby="week-h">
					<h2 id="week-h" className="li-h2">This week</h2>
					<div className="li-row" style={{ gap: 28, alignItems: "flex-start", flexWrap: "nowrap" }}>
						<span style={{ display: "flex", flexDirection: "column", gap: 8 }}><b className="li-numeral li-today-num">{progress.data?.week.sessions ?? "–"}</b><b>sessions</b></span>
						<span style={{ display: "flex", flexDirection: "column", gap: 8 }}><b className="li-numeral li-today-num">{progress.data?.week.questionsAnswered ?? "–"}</b><b>questions answered</b></span>
					</div>
				</section>
			</div>
		</>
	);
}

/**
 * How far through: a tower of blocks, one per question or idea. The ones
 * done are solid with a tick; the ones to come are dashed. Shape, not colour.
 */
function Tower({ done, total }: { done: number; total: number }) {
	const n = Math.max(0, Math.min(6, total));
	if (n === 0) return null;
	const filled = Math.round((Math.min(done, total) / total) * n);
	return (
		<span className="li-tower" role="img" aria-label={`${done} of ${total} done`}>
			{Array.from({ length: n }, (_, i) => {
				const on = i >= n - filled;
				return <i key={i} data-on={String(on)} style={{ marginLeft: i % 2 ? 0 : 18 }}>{on ? <Icon.check /> : null}</i>;
			})}
		</span>
	);
}

/**
 * Optional next steps after the first taste (spec J1′ step 5), each one
 * dismissible. "Get questions on your phone" joins when the phone app ships
 * (F-112).
 */
function StarterCards({ phone }: { phone: boolean }) {
	const [hideSlides, setHideSlides] = useLocalFlag("li-card-slides");
	const [hidePlan, setHidePlan] = useLocalFlag("li-card-plan");
	const [hidePhone, setHidePhone] = useLocalFlag("li-card-phone");
	const cards = [
		!hideSlides && { key: "slides", title: "Add your slides", sub: "Lectures, a week or a whole semester. I'll write the questions.", href: "/app/library", dismiss: () => setHideSlides(true) },
		!hidePlan && { key: "plan", title: "Plan my week with me (2 min)", sub: "A few quick questions, then study blocks in your free time.", href: "/app/plan/chat", dismiss: () => setHidePlan(true) },
		phone && !hidePhone && { key: "phone", title: "Get questions on your phone", sub: "One question after a lecture, even with this laptop closed.", href: "/app/me#phone", dismiss: () => setHidePhone(true) },
	].filter(Boolean) as { key: string; title: string; sub: string; href: string; dismiss: () => void }[];
	if (!cards.length) return null;
	return (
		<div className="li-row" style={{ gap: 12, alignItems: "stretch" }} aria-label="Next steps">
			{cards.map((c) => (
				<div key={c.key} className="li-card li-row" style={{ flex: "1 1 280px", gap: 10, padding: "14px 18px", flexWrap: "nowrap" }}>
					<Link href={c.href} style={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
						<b>{c.title}</b>
						<span className="li-small li-muted li-tall-only">{c.sub}</span>
					</Link>
					<Link href={c.href} className="li-btn ghost" aria-label={c.title}><Icon.arrow /></Link>
					<button type="button" className="li-btn ghost" onClick={c.dismiss} aria-label={`Dismiss ${c.title}`}><Icon.close /></button>
				</div>
			))}
		</div>
	);
}
