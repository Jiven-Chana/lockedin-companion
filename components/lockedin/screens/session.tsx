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
import { BLOCK_RULES, CONFIDENCE_TAPS, PRACTISE_COPY, KEEP_GOING_QUESTIONS, MATERIALS_RULES, questionNumber, SESSION_COPY, moduleHue, SESSION_FAILURE_ACTIONS, sessionFailure, slidePosition, slidePositionLabel, type SessionQuestion, type SessionView } from "@/src/core";
import { ApiError, lockedIn, type SlideSection } from "../api";
import { fmtDay, fmtTime, useLocalFlag, usePoll } from "../hooks";
import { FocusRing } from "../icons";
import { MicButton, useMic } from "../mic";
import { Prose } from "../prose";
import { Tint } from "../root";
import { SlidePage } from "../slide-page";

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
	// How sure you are: four taps, none preselected, and it can be left out (design log 23 Nov).
	const [conf, setConf] = useState<number | null>(null);
	const [why, setWhyState] = useState("");
	// The submit reads the box through a ref so it sees words dictation adds as it finishes.
	const whyRef = useRef("");
	const setWhy = useCallback((v: string) => { whyRef.current = v; setWhyState(v); }, []);
	const mic = useMic(useCallback((text: string) => setWhy(whyRef.current ? `${whyRef.current.trimEnd()} ${text}` : text), [setWhy]), "why");
	const [hint, setHint] = useState<string | null>(null);
	const [busy, setBusy] = useState<string | null>(null);
	const [answered, setAnswered] = useState<Answered | null>(null);
	const [slides, setSlides] = useState<SlideSection[]>([]);
	const [hasPdf, setHasPdf] = useState(false);
	const [slide, setSlide] = useState<number | null>(null);
	const [notify, setNotify] = useLocalFlag("li-notify");
	const [onBreak, setOnBreak] = useState<number | null>(null);
	const [breakOver, setBreakOver] = useState(false);
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

	// A Practise round mixes units, so the panel follows the unit of the question on screen (V-40).
	const lectureId = view?.question?.lectureId ?? view?.lecture.id;
	useEffect(() => {
		if (lectureId) lockedIn.slides(lectureId).then((r) => { setSlides(r.slides); setHasPdf(r.hasPdf); }).catch(() => { setSlides([]); setHasPdf(false); });
	}, [lectureId]);

	// The panel follows the slide the teacher cites, unless the student picked one.
	// A unit keeps its file's page numbers (18 to 38, say), so the panel moves through those (S-1).
	const reviewing = !!answered && !!view?.feedback && view.feedback.questionId === answered.question.id;
	const showQuestion = view?.status === "question" && view.question && !reviewing;
	// While a question is being answered the panel shows that question's own slide (lo-fi task 1).
	const cited = (showQuestion ? view?.question?.slides?.[0] : undefined) ?? view?.feedback?.slideRefs[0] ?? view?.slideRefs[0];
	const pos = slidePosition(slides.map((x) => x.number), slide ?? cited);

	useEffect(() => {
		if (showQuestion) {
			setPicked(null);
			setConf(null);
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
			// Speaking when you press Check: wait for the last words, so nothing said is lost.
			await mic.dictation.finish().catch(() => undefined);
			const why = whyRef.current.trim();
			await lockedIn.answer(id, picked === DONT_KNOW ? { questionId: q.id, dontKnow: true, why: why || undefined } : { questionId: q.id, indices: [picked], ...(conf === null ? {} : { confidence: conf }), why: why || undefined });
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
	async function retry() {
		setBusy("retry");
		const problem = await lockedIn.retry(id).then(() => null, (e: unknown) => (e instanceof ApiError ? e.message : "Couldn't reach the app"));
		await load();
		if (problem) setError(problem);
		setBusy(null);
	}
	async function practiseInstead() {
		setBusy("practice");
		try {
			const { sessionId } = await lockedIn.practiceInstead(id);
			router.replace(`/app/session/${sessionId}`);
		} catch (e) {
			setError(e instanceof ApiError ? e.message : "Couldn't reach the app");
		} finally {
			setBusy(null);
		}
	}
	useEffect(() => {
		if (onBreak === null || breakOver) return;
		const t = setTimeout(() => endBreak(true), Math.max(0, onBreak - Date.now()));
		return () => clearTimeout(t);
	}, [onBreak, breakOver]);
	// A break is offered only at the end of a set (INT-03-c, S-69). One buzz when it is over; taking longer loses nothing.
	function startBreak() {
		setBreakOver(false);
		setOnBreak(Date.now() + BLOCK_RULES.breakMinutes * 60_000);
		void lockedIn.event("break_started", { sessionId: id, minutes: BLOCK_RULES.breakMinutes });
	}
	function endBreak(natural: boolean) {
		void lockedIn.event("break_ended", { sessionId: id, natural });
		if (natural) {
			setBreakOver(true);
			try { navigator.vibrate?.(200); } catch { /* no buzz on this device */ }
			if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification("LockedIn", { body: SESSION_COPY.breakEnded });
		} else {
			setOnBreak(null);
			setBreakOver(false);
		}
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
			// Esc while speaking drops what was said (the engine's rule), not the whole session.
			if (e.key === "Escape" && mic.dictation.active) { mic.dictation.cancel(); return; }
			if (e.key === "Escape") { void stop(); return; }
			if (!showQuestion || !view?.question) return;
			const n = Number(e.key);
			if (Number.isInteger(n) && n >= 1 && n <= view.question.options.length) setPicked(n);
			else if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement)) void check();
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

	const failure = sessionFailure(view.error);
	const s = slides.find((x) => x.number === pos.number);
	const fb = view.feedback;

	const practising = view.study === "practise";
	const at = questionNumber({ answered: view.answered, budget: view.budget, done: view.status === "done", reviewing });
	return (
		<Tint hue={moduleHue(view.lecture.module)}>
			<div className="li-focus">
				<div className="li-focus-top">
					<button type="button" className="li-x" aria-label="Stop for now" onClick={stop}>✕</button>
					<span style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 }}>
						{/* The mode has a name (V-40, V-50): Practise, or Learn. */}
						<b className="li-display" style={{ fontSize: "1.25em" }}><span className="li-mode" data-study={practising ? "practise" : "learn"}>{practising ? PRACTISE_COPY.mode : PRACTISE_COPY.learnMode}</span> {view.practiseOf ?? `${view.lecture.module} · ${view.lecture.title}`}</b>
						<span className="li-small" style={{ color: "var(--li-deep-muted)" }}>{view.goal} · stop any time, nothing is lost</span>
					</span>
					<span className="li-qdots" aria-hidden="true">{at.dots.map((d, i) => <i key={i} data-state={d} />)}</span>
					<b style={{ fontSize: "1.1em" }}>{view.status === "done" ? SESSION_COPY.setFinishedShort : SESSION_COPY.position(at.current, at.total)}</b>
				</div>

				<div className="li-panes">
					<section className="li-qcard" aria-label="Question">
						{view.status === "error" ? (
							<>
								<h2 className="li-q-stem">{failure.says}</h2>
								{error ? <div className="li-note" role="alert">{error}</div> : null}
								<div className="li-row">
									{failure.action === "connect"
										? <Link className="li-btn primary" href="/app/me#ai">{SESSION_FAILURE_ACTIONS.connect}</Link>
										: <button type="button" className="li-btn primary" onClick={retry} disabled={!!busy}>{busy === "retry" ? "Trying…" : SESSION_FAILURE_ACTIONS.retry}</button>}
									{view.practiceAvailable ? <button type="button" className="li-btn" onClick={practiseInstead} disabled={!!busy}>{SESSION_FAILURE_ACTIONS.practice}</button> : null}
									<Link className="li-btn" href="/app/library">{SESSION_FAILURE_ACTIONS.another}</Link>
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
									<span className="li-fb-title">{fb.correct && !fb.shown ? <><span className="li-check" aria-hidden="true">✓</span> </> : null}{fb.shown ? "Here's how it works" : fb.correct ? "Right" : answered.picked === DONT_KNOW ? "Here's the answer" : "Not quite"}</span>
									{fb.explanation ? <Prose text={fb.explanation} onSlide={setSlide} /> : null}
									{answered.why ? <span className="li-small"><b>Your why:</b> {answered.why}</span> : null}
								</div>
								<div className="li-row">
									<span className="li-small li-muted" style={{ flexGrow: 1 }}>{fb.correct ? (conf !== null && conf <= 30 ? "Right, but you weren't sure: it'll come back in a short retest." : "Nice.") : "This one comes back in a short retest in a day or two."}</span>
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
										<b>{SESSION_COPY.confidenceAsk}</b>
										<div role="radiogroup" aria-label="How sure you are" className="li-stops">
											{CONFIDENCE_TAPS.map((c) => <button key={c.value} type="button" role="radio" aria-checked={conf === c.value} onClick={() => setConf(conf === c.value ? null : c.value)}>{c.label}</button>)}
										</div>
										{view.kind === "retest" ? <span className="li-small li-muted">{SESSION_COPY.confidenceRevisitHint}</span> : null}
									</div>
								) : null}
								{/* Saying why belongs to Learn, where the tutor reads it. Practise asks for an answer and how sure you are (V-51). */}
								{practising ? null : (
									<>
										<label className="li-stack" style={{ gap: 6 }}>
											<b>Why? <span className="li-muted" style={{ fontWeight: 400 }}>(optional, it helps the feedback)</span></b>
											<textarea className="li-input" rows={2} value={why} onChange={(e) => setWhy(e.target.value)} placeholder={mic.available ? "Because… (or press Speak)" : "Because…"} />
										</label>
										<MicButton mic={mic} />
									</>
								)}
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
								{onBreak ? (
									<>
										<span className="li-eyebrow">On a break</span>
										<h2 className="li-q-stem">{breakOver ? SESSION_COPY.breakEnded : SESSION_COPY.onBreak(fmtTime(new Date(onBreak)))}</h2>
										{breakOver ? null : <p className="li-muted" style={{ margin: 0 }}>{SESSION_COPY.breakNote}</p>}
										<div className="li-row">
											<button type="button" className="li-btn primary big" onClick={() => endBreak(false)}>{SESSION_COPY.breakOverButton}</button>
										</div>
									</>
								) : (
									<>
										<span className="li-eyebrow">{SESSION_COPY.setFinished}</span>
										<h2 className="li-q-stem">{SESSION_COPY.doneTitle(view.answered, view.lecture.title)}{view.endedEarly ? " The teacher wrapped up." : ""}</h2>
										{view.prose ? <Prose text={view.prose} onSlide={setSlide} /> : null}
										{/* No score (R-6): what comes back, and what is next. */}
										<p style={{ margin: 0 }}>{SESSION_COPY.comingBack(view.comingBack ?? [])}</p>
										{view.nextBlockAt ? <p className="li-note" style={{ margin: 0 }}>{SESSION_COPY.nextBlock(`${fmtDay(view.nextBlockAt, new Date())} ${fmtTime(view.nextBlockAt)}`)}</p> : null}
										<p className="li-small li-muted" style={{ margin: 0 }}>{SESSION_COPY.noScore} {SESSION_COPY.breakRule}</p>
										{!notify && typeof Notification !== "undefined" && Notification.permission !== "denied" ? (
											<div className="li-note li-row">
												<span style={{ flexGrow: 1 }}>Want a desktop notification when the next one is ready?</span>
												<button type="button" className="li-btn soft" onClick={async () => { const p = await Notification.requestPermission(); setNotify(p === "granted"); void lockedIn.event("settings_changed", { changed: ["notifications"], granted: p === "granted" }); }}>Turn on</button>
											</div>
										) : null}
										<div className="li-row" style={{ flexWrap: "wrap" }}>
											<button type="button" className="li-btn" onClick={startBreak}>{SESSION_COPY.takeBreak(BLOCK_RULES.breakMinutes)}</button>
											<button type="button" className="li-btn" onClick={keepGoing} disabled={!!busy}>{busy === "more" ? "Adding…" : SESSION_COPY.moreQuestions(KEEP_GOING_QUESTIONS)}</button>
											<Link className="li-btn primary big" href="/app">{SESSION_COPY.finish}</Link>
										</div>
									</>
								)}
							</>
						) : null}
					</section>

					<aside className="li-slides" aria-label="Slides">
						<div className="li-row" style={{ gap: 8 }}>
							<b style={{ flexGrow: 1 }}>{slidePositionLabel(pos, hasPdf)}</b>
							<button type="button" className="li-icon-btn" aria-label={hasPdf ? "Previous page" : "Previous slide"} onClick={() => setSlide(pos.prev)} disabled={pos.prev === null}>‹</button>
							<button type="button" className="li-icon-btn" aria-label={hasPdf ? "Next page" : "Next slide"} onClick={() => setSlide(pos.next)} disabled={pos.next === null}>›</button>
						</div>
						<div className="li-slide" data-page={s && hasPdf ? "true" : "false"}>
							{s && hasPdf ? null : <span className="li-eyebrow li-slide-muted">{view.practiseOf ?? `${view.lecture.module} · ${view.lecture.title}`}</span>}
							{s ? <SlidePage lectureId={view.lecture.id} slide={s} hasPdf={hasPdf} /> : <p className="li-slide-muted" style={{ margin: 0 }}>No material for this yet. Add it from the Library with "Add course material".</p>}
						</div>
						{pos.total > 0 && pos.total <= MATERIALS_RULES.maxSlideDots ? <div className="li-dots" aria-hidden="true">{slides.map((x) => <span key={x.number} data-on={x.number === pos.number ? "true" : "false"} />)}</div> : null}
						<span className="li-small" style={{ color: "var(--li-deep-muted)" }}>The panel follows the slide the explanation cites. Click any slide chip to open it here.</span>
					</aside>
				</div>
			</div>
		</Tint>
	);
}
