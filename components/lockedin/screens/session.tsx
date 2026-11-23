"use client";

/**
 * The session in focus mode (mvp1-plan F-05): the question column and the
 * slide panel side by side. Every SessionView state is designed: preparing,
 * question, thinking, feedback, done, error. Polls only while the engine is
 * working. Keyboard: 1–9 pick, Enter check, H hint, S show me first, Esc stop.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { CONFIDENCE_STOPS, moduleHue, type SessionQuestion, type SessionView } from "@/src/core";
import { ApiError, lockedIn, type SlideSection } from "../api";
import { useLocalFlag, usePoll } from "../hooks";
import { FocusRing } from "../icons";
import { Prose } from "../prose";
import { Tint } from "../root";

const DONT_KNOW = -1;

interface Answered {
	question: SessionQuestion;
	picked: number;
	why: string;
}

export function SessionScreen({ id }: { id: string }) {
	const router = useRouter();
	const [view, setView] = useState<SessionView | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [picked, setPicked] = useState<number | null>(null);
	const [conf, setConf] = useState(50);
	const [why, setWhy] = useState("");
	const [hint, setHint] = useState<string | null>(null);
	const [busy, setBusy] = useState<string | null>(null);
	const [answered, setAnswered] = useState<Answered | null>(null);
	const [slides, setSlides] = useState<SlideSection[]>([]);
	const [slide, setSlide] = useState<number | null>(null);
	const [notify, setNotify] = useLocalFlag("li-notify");
	const qRef = useRef<HTMLHeadingElement>(null);

	const load = useCallback(async () => {
		try {
			const v = await lockedIn.session(id);
			setView(v);
			setError(null);
		} catch (e) {
			setError(e instanceof ApiError ? e.message : "Couldn't reach the app");
		}
	}, [id]);
	useEffect(() => { void load(); }, [load]);
	usePoll(() => void load(), 750, !view || view.status === "preparing" || view.status === "thinking");

	const lectureId = view?.lecture.id;
	useEffect(() => {
		if (lectureId) lockedIn.slides(lectureId).then(setSlides).catch(() => setSlides([]));
	}, [lectureId]);

	// The panel follows the slide the teacher cites, unless the student picked one.
	const cited = view?.feedback?.slideRefs[0] ?? view?.slideRefs[0];
	const current = slide ?? cited ?? 1;
	const reviewing = !!answered && !!view?.feedback && view.feedback.questionId === answered.question.id;
	const showQuestion = view?.status === "question" && view.question && !reviewing;

	useEffect(() => {
		if (showQuestion) {
			setPicked(null);
			setConf(50);
			setWhy("");
			setHint(null);
			qRef.current?.focus();
		}
	}, [showQuestion, view?.question?.id]);

	async function check() {
		if (!view?.question || picked === null || busy) return;
		setBusy("check");
		const q = view.question;
		try {
			await lockedIn.answer(id, picked === DONT_KNOW ? { questionId: q.id, dontKnow: true, why: why || undefined } : { questionId: q.id, indices: [picked], confidence: conf, why: why || undefined });
			setAnswered({ question: q, picked, why });
			setSlide(null);
			await load();
		} catch (e) {
			setError(e instanceof ApiError ? e.message : "That answer didn't go through");
		} finally {
			setBusy(null);
		}
	}
	async function askHint() {
		if (!view?.question || busy) return;
		setBusy("hint");
		try {
			setHint((await lockedIn.hint(id, view.question.id)).text);
		} catch (e) {
			setHint(e instanceof ApiError ? `No hint this time: ${e.message}` : "No hint this time.");
		} finally {
			setBusy(null);
		}
	}
	async function showMe() {
		if (!view?.question || busy) return;
		setBusy("show");
		try {
			await lockedIn.showMe(id, view.question.id);
			await load();
		} finally {
			setBusy(null);
		}
	}
	async function stop() {
		await lockedIn.stop(id).catch(() => undefined);
		router.push("/app");
	}
	async function keepGoing() {
		setBusy("more");
		try {
			await lockedIn.more(id);
			setAnswered(null);
			await load();
		} finally {
			setBusy(null);
		}
	}

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
			if (e.key === "Escape") { void stop(); return; }
			if (!showQuestion || !view?.question) return;
			const n = Number(e.key);
			if (Number.isInteger(n) && n >= 1 && n <= view.question.options.length) setPicked(n);
			else if (e.key === "Enter") void check();
			else if (e.key.toLowerCase() === "h" && view.canHint) void askHint();
			else if (e.key.toLowerCase() === "s") void showMe();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	});

	if (!view) {
		return (
			<div className="li-focus" style={{ alignItems: "center", justifyContent: "center", color: "var(--li-deep-ink)" }}>
				{error ? <div className="li-qcard" style={{ maxWidth: 520 }}><b>We couldn&apos;t open this session.</b><span className="li-muted">{error}</span><Link className="li-btn" href="/app">Back to Today</Link></div> : <div className="li-activity" style={{ color: "var(--li-deep-muted)" }}><span className="li-pulse" />Opening your session…</div>}
			</div>
		);
	}

	const s = slides.find((x) => x.number === current);
	const total = slides.length;
	const fb = view.feedback;

	return (
		<Tint hue={moduleHue(view.lecture.module)}>
			<div className="li-focus">
				<div className="li-focus-top">
					<button type="button" className="li-x" aria-label="Stop for now" onClick={stop}>✕</button>
					<span style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 }}>
						<b className="li-display" style={{ fontSize: "1.25em" }}>{view.lecture.module} · {view.lecture.title}</b>
						<span className="li-small" style={{ color: "var(--li-deep-muted)" }}>{view.goal}{view.engine === "scripted" ? " · scripted questions" : ""} · stop any time, nothing is lost</span>
					</span>
					<FocusRing done={view.answered} total={view.budget} />
					<b style={{ fontSize: "1.1em", minWidth: 60 }}>{view.answered} of {view.budget}</b>
				</div>

				<div className="li-panes">
					<section className="li-qcard" aria-label="Question">
						{view.status === "error" ? (
							<>
								<h2 className="li-q-stem">Something got stuck.</h2>
								<p className="li-muted" style={{ margin: 0 }}>{friendlyError(view.error)}</p>
								<div className="li-row">
									<button type="button" className="li-btn primary" onClick={async () => { await lockedIn.retry(id).catch(() => undefined); await load(); }}>Try again</button>
									<Link className="li-btn" href="/app">Back to Today</Link>
								</div>
							</>
						) : null}

						{view.status === "preparing" ? (
							<div className="li-activity" aria-live="polite"><span className="li-pulse" />{view.activity ?? "Writing question 1…"}</div>
						) : null}

						{reviewing && fb && answered ? (
							<>
								<p className="li-muted" style={{ margin: 0 }}>You answered</p>
								<h2 className="li-q-stem" style={{ fontSize: "1.35em" }}>{answered.question.stem}</h2>
								<div className="li-stack" style={{ gap: 8 }}>
									{answered.question.options.map((o) => {
										const isAnswer = fb.correctLabels.includes(o.label);
										const isMiss = answered.picked === o.index && !isAnswer;
										return (
											<div key={o.index} className={`li-opt ${isAnswer ? "is-answer" : isMiss ? "is-miss" : ""}`} style={{ cursor: "default" }}>
												<span style={{ flexGrow: 1 }}>{o.label}</span>
												{isAnswer ? <b className="li-small">✓ Answer</b> : isMiss ? <b className="li-small">Your pick</b> : null}
											</div>
										);
									})}
								</div>
								<div className={`li-feedback ${fb.correct ? "right" : "miss"}`} aria-live="polite">
									<span className="li-fb-title">{fb.shown ? "Here's how it works" : fb.correct ? "Right" : answered.picked === DONT_KNOW ? "Here's the answer" : "Not quite"}</span>
									{fb.explanation ? <Prose text={fb.explanation} onSlide={setSlide} /> : null}
									{answered.why ? <span className="li-small"><b>Your why:</b> {answered.why}</span> : null}
								</div>
								<div className="li-row">
									<span className="li-small li-muted" style={{ flexGrow: 1 }}>{fb.correct ? (conf <= 30 ? "Right, but you weren't sure: it'll come back in a short retest." : "Nice.") : "This one comes back in a short retest in a day or two."}</span>
									{view.status === "thinking" ? (
										<span className="li-activity" style={{ padding: 0 }}><span className="li-pulse" />{view.activity}</span>
									) : (
										<button type="button" className="li-btn primary big" autoFocus onClick={() => setAnswered(null)}>{view.status === "done" ? "See summary" : "Next question →"}</button>
									)}
								</div>
							</>
						) : null}

						{!reviewing && view.status === "thinking" ? (
							<div className="li-activity" aria-live="polite"><span className="li-pulse" />{view.activity ?? "Writing the next question…"}</div>
						) : null}

						{showQuestion && view.question ? (
							<>
								{view.prose ? <Prose text={view.prose} onSlide={setSlide} /> : null}
								<h2 className="li-q-stem" tabIndex={-1} ref={qRef}>{view.question.stem}</h2>
								{view.question.context ? <p className="li-muted" style={{ margin: 0 }}>{view.question.context}</p> : null}
								<div role="radiogroup" aria-label="Answers" className="li-stack" style={{ gap: 10 }}>
									{view.question.options.map((o) => (
										<button key={o.index} type="button" role="radio" aria-checked={picked === o.index} className="li-opt" onClick={() => setPicked(o.index)}>
											<span className="li-kbd">{o.index}</span><span style={{ flexGrow: 1 }}>{o.label}</span>
										</button>
									))}
									{view.question.kind === "quiz" ? (
										<button type="button" role="radio" aria-checked={picked === DONT_KNOW} className="li-opt" onClick={() => setPicked(DONT_KNOW)}>
											<span className="li-kbd">?</span><span style={{ flexGrow: 1 }}>I don&apos;t know</span>
										</button>
									) : null}
								</div>
								{picked !== DONT_KNOW && view.question.kind === "quiz" ? (
									<div className="li-stack" style={{ gap: 8 }}>
										<b>How sure are you?</b>
										<div role="radiogroup" aria-label="Confidence" className="li-stops">
											{CONFIDENCE_STOPS.map((v) => <button key={v} type="button" role="radio" aria-checked={conf === v} onClick={() => setConf(v)}>{v}%</button>)}
										</div>
									</div>
								) : null}
								<label className="li-stack" style={{ gap: 6 }}>
									<b>Why? <span className="li-muted" style={{ fontWeight: 400 }}>(optional, it helps the feedback)</span></b>
									<textarea className="li-input" rows={2} value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Because…" />
								</label>
								{hint ? <div className="li-note" role="note"><b>Hint:</b> {hint}</div> : null}
								{error ? <div className="li-note" role="alert">{error}</div> : null}
								<div className="li-row">
									{view.canHint ? <button type="button" className="li-btn" onClick={askHint} disabled={!!busy || !!hint}>{busy === "hint" ? "Thinking…" : "Hint"} <span className="li-kbd">H</span></button> : null}
									<button type="button" className="li-btn" onClick={showMe} disabled={!!busy}>{busy === "show" ? "Getting it…" : "Show me first"} <span className="li-kbd">S</span></button>
									<button type="button" className="li-btn primary big" style={{ marginLeft: "auto" }} onClick={check} disabled={picked === null || !!busy}>{busy === "check" ? "Checking…" : "Check"} <span className="li-kbd" style={{ color: "inherit", borderColor: "currentColor" }}>↵</span></button>
								</div>
							</>
						) : null}

						{view.status === "done" && !reviewing ? (
							<>
								<span className="li-eyebrow">Session done</span>
								<h2 className="li-q-stem">{view.answered} of {view.budget} answered{view.endedEarly ? ", and the teacher wrapped up" : ""}.</h2>
								{view.prose ? <Prose text={view.prose} onSlide={setSlide} /> : <p className="li-muted" style={{ margin: 0 }}>Anything you missed comes back later in a short retest. Nothing is ever overdue.</p>}
								{!notify && typeof Notification !== "undefined" && Notification.permission !== "denied" ? (
									<div className="li-note li-row">
										<span style={{ flexGrow: 1 }}>Want a desktop notification when the next one is ready?</span>
										<button type="button" className="li-btn soft" onClick={async () => { const p = await Notification.requestPermission(); setNotify(p === "granted"); void lockedIn.event("settings_changed", { changed: ["notifications"], granted: p === "granted" }); }}>Turn on</button>
									</div>
								) : null}
								<div className="li-row">
									<button type="button" className="li-btn" onClick={keepGoing} disabled={!!busy}>{busy === "more" ? "Adding…" : "Keep going (+3)"}</button>
									<Link className="li-btn primary big" href="/app">Done</Link>
								</div>
							</>
						) : null}
					</section>

					<aside className="li-slides" aria-label="Slides">
						<div className="li-row" style={{ gap: 8 }}>
							<b style={{ flexGrow: 1 }}>{total ? `Slide ${current} of ${total}` : "Slides"}</b>
							<button type="button" className="li-icon-btn" aria-label="Previous slide" onClick={() => setSlide(Math.max(1, current - 1))} disabled={current <= 1}>‹</button>
							<button type="button" className="li-icon-btn" aria-label="Next slide" onClick={() => setSlide(Math.min(total || 1, current + 1))} disabled={current >= total}>›</button>
						</div>
						<div className="li-slide">
							<span className="li-eyebrow li-slide-muted">{view.lecture.module} · {view.lecture.title}</span>
							{s ? (<><h3>{s.title}</h3><Prose text={s.body} /></>) : <p className="li-slide-muted" style={{ margin: 0 }}>No material for this yet. Add it from the Library with "Add course material".</p>}
						</div>
						{total ? <div className="li-dots" aria-hidden="true">{slides.map((x) => <span key={x.number} data-on={x.number === current ? "true" : "false"} />)}</div> : null}
						<span className="li-small" style={{ color: "var(--li-deep-muted)" }}>The panel follows the slide the explanation cites. Click any slide chip to open it here.</span>
					</aside>
				</div>
			</div>
		</Tint>
	);
}

function friendlyError(code?: string): string {
	if (!code) return "The engine didn't answer. Try again, or come back to it later.";
	if (code === "models_not_configured" || code === "provider_key_missing") return "The teaching engine isn't set up on this laptop yet (no model or key). The facilitator can switch to scripted questions.";
	if (code === "timeout") return "Writing the question took too long. Try again.";
	if (code === "no_scripted_set") return "There are no scripted questions for this lecture yet.";
	return `The engine reported "${code}". Try again, or come back to it later.`;
}
