"use client";

/**
 * Learn (v2.0 step 5; V-47, V-54): the tutor teaching, in focus. One column
 * and one step at a time: everything since your last answer, then the
 * question. No chat log and no side panel unless you open one (AE-5, AFF-C,
 * AE2-3). "Plan" and "Slide" open a panel on demand; a slide reference in
 * the text opens that slide (INT-01-g). One line at the bottom to type or
 * speak, at any moment.
 *
 * Keyboard: 1–9 pick, Enter check or send, Esc stop for now.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SvgImage } from "@/components/artifacts/svg-image";
import { CONFIDENCE_TAPS, LEARN_COPY, learnDemoDoc, learnDemoHeight, MATERIALS_RULES, SESSION_COPY, SESSION_FAILURE_ACTIONS, sessionFailure, slidePosition, slidePositionLabel, type LearnItem, type SessionView } from "@/src/core";
import { ApiError, lockedIn, type SlideSection } from "../api";
import { fmtDay, fmtTime, usePoll } from "../hooks";
import { LearnPlan } from "../learn-plan";
import { MicButton, useMic } from "../mic";
import { InlineProse, Prose } from "../prose";
import { Tint } from "../root";
import { SlidePage } from "../slide-page";

type Panel = "plan" | "slide" | null;

/** A demo the tutor built, in a frame that can run scripts and reach nothing else. */
function Demo({ title, html }: { title: string; html: string }) {
	const frame = useRef<HTMLIFrameElement>(null);
	const [height, setHeight] = useState(320);
	const doc = useMemo(() => learnDemoDoc(html), [html]);
	useEffect(() => {
		const onMessage = (e: MessageEvent) => {
			if (!frame.current || e.source !== frame.current.contentWindow) return;
			const h = learnDemoHeight(e.data);
			if (h) setHeight(h);
		};
		window.addEventListener("message", onMessage);
		return () => window.removeEventListener("message", onMessage);
	}, []);
	return <iframe ref={frame} title={title || "Something to try"} sandbox="allow-scripts" srcDoc={doc} style={{ height }} />;
}

function Item({ item, plan, onSlide }: { item: LearnItem; plan: SessionView["learn"]; onSlide: (n: number) => void }) {
	switch (item.type) {
		case "tutor":
			return <Prose text={item.text} onSlide={onSlide} />;
		case "you":
			return <div className="li-you"><b>{LEARN_COPY.you}:</b> {item.text}</div>;
		case "aside":
			return (
				<div className="li-stack" style={{ gap: 8 }}>
					<div className="li-you"><b>{LEARN_COPY.you}:</b> {item.ask}</div>
					<Prose text={item.answer} onSlide={onSlide} />
				</div>
			);
		case "plan":
			return plan?.plan ? (
				<div className="li-answered">
					<span className="li-eyebrow">{LEARN_COPY.planTitle}</span>
					<LearnPlan plan={plan.plan} />
				</div>
			) : null;
		case "making":
			return <div className="li-making" role="status"><span className="li-pulse" />{LEARN_COPY.making[item.kind]}</div>;
		case "failed":
			return <div className="li-note li-muted">{LEARN_COPY.failed[item.kind]}</div>;
		case "visual":
			return (
				<figure className="li-artifact" style={{ margin: 0 }}>
					<SvgImage svg={item.svg} />
					<figcaption className="li-small li-muted">{item.notes ? `${item.notes} · ` : ""}{LEARN_COPY.madeBy}</figcaption>
				</figure>
			);
		case "demo":
			return (
				<figure className="li-artifact" style={{ margin: 0 }}>
					{item.title ? <b>{item.title}</b> : null}
					<Demo title={item.title} html={item.html} />
					<figcaption className="li-small li-muted">{LEARN_COPY.madeBy}</figcaption>
				</figure>
			);
		case "research":
			return (
				<div className="li-artifact">
					<Prose text={item.brief} onSlide={onSlide} />
					{item.sources.length ? (
						<span className="li-small li-muted">{LEARN_COPY.sources}: {item.sources.map((s, i) => <span key={s.url}>{i > 0 ? " · " : ""}<a href={s.url} target="_blank" rel="noreferrer noopener">{s.title}</a></span>)}</span>
					) : null}
				</div>
			);
		case "answered": {
			// A guess is never marked (V-47): it shows the guess and the answer, with no right or wrong.
			const title = item.guess ? null : item.correct === true ? "Right" : item.correct === false ? (item.dontKnow ? "Here's the answer" : "Not quite") : null;
			return (
				<div className={`li-answered${item.correct === true ? " li-feedback right" : item.correct === false ? " li-feedback miss" : ""}`}>
					{item.stem.includes("\n") ? <div className="li-small"><Prose text={item.stem} /></div> : <span className="li-small"><b><InlineProse text={item.stem} /></b></span>}
					{item.options.length ? (
						<ul>
							{item.options.filter((o) => o.picked || o.answer).map((o) => (
								<li key={o.label} data-answer={o.answer ? "true" : "false"}>
									<span style={{ flexGrow: 1 }}><InlineProse text={o.label} /></span>
									<span className="li-tag">{o.picked && o.answer ? (item.guess ? `${LEARN_COPY.guessed} · ${LEARN_COPY.guessAnswer.toLowerCase()}` : "Your answer ✓") : o.picked ? (item.guess ? LEARN_COPY.guessed : "Your answer") : LEARN_COPY.guessAnswer}</span>
								</li>
							))}
						</ul>
					) : null}
					{item.written ? <div className="li-you"><b>{LEARN_COPY.you}:</b> {item.written}</div> : null}
					{title ? <span className="li-fb-title" style={{ fontSize: "1.15em" }}>{title}</span> : null}
					{item.explanation ? <Prose text={item.explanation} onSlide={onSlide} /> : null}
					{item.why ? <span className="li-small"><b>Your why:</b> {item.why}</span> : null}
				</div>
			);
		}
	}
}

/** The student is typing in a text box: the keyboard stays where it is. */
function isTyping(): boolean {
	const a = document.activeElement;
	return a instanceof HTMLTextAreaElement || (a instanceof HTMLInputElement && a.type !== "checkbox" && a.type !== "radio");
}

export function LearnScreen({ id, view, reload, loadError }: { id: string; view: SessionView; reload: () => Promise<void>; loadError: string | null }) {
	const router = useRouter();
	const learn = view.learn!;
	const q = view.status === "question" ? view.question : undefined;
	const [panel, setPanel] = useState<Panel>(null);
	const [slide, setSlide] = useState<number | null>(null);
	const [slides, setSlides] = useState<SlideSection[]>([]);
	const [hasPdf, setHasPdf] = useState(false);
	const [picked, setPicked] = useState<number[]>([]);
	const [dontKnow, setDontKnow] = useState(false);
	const [conf, setConf] = useState<number | null>(null);
	const [why, setWhy] = useState("");
	const [written, setWritten] = useState("");
	const [say, setSay] = useState("");
	const [sent, setSent] = useState(false);
	const [hint, setHint] = useState<string | null>(null);
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [earlier, setEarlier] = useState<LearnItem[][] | null>(null);
	const [, setTick] = useState(0);
	const stem = useRef<HTMLHeadingElement & HTMLDivElement>(null);

	// One microphone, for whichever box you are in: the line at the bottom, or your written answer.
	const target = useRef<"say" | "written" | "why">("say");
	const mic = useMic(useCallback((t: string) => {
		const add = (v: string) => (v ? `${v.trimEnd()} ${t}` : t);
		if (target.current === "written") setWritten(add);
		else if (target.current === "why") setWhy(add);
		else setSay(add);
	}, []), "learn");

	// The slides beside the lesson: this lecture's, or in a week session the unit the current idea belongs to.
	const unitId = learn.unit?.id ?? view.lecture.id;
	useEffect(() => {
		setSlide(null);
		lockedIn.slides(unitId).then((r) => { setSlides(r.slides); setHasPdf(r.hasPdf); }).catch(() => { setSlides([]); setHasPdf(false); });
	}, [unitId]);

	// Something is being made in the background: look again now and then, so it appears when it lands.
	const making = learn.step.some((i) => i.type === "making");
	usePoll(() => void reload(), 3_000, making && view.status !== "thinking" && view.status !== "preparing");
	// The clock in the header.
	useEffect(() => {
		const t = setInterval(() => setTick((n) => n + 1), 30_000);
		return () => clearInterval(t);
	}, []);

	// A new question: a clean slate, and the keyboard lands on it. Never while the student is typing: the
	// tutor's next question often arrives mid-sentence, and the rest of the sentence must not be lost.
	useEffect(() => {
		setPicked([]); setDontKnow(false); setConf(null); setWhy(""); setWritten(""); setHint(null); setError(null);
		if (q && !isTyping()) stem.current?.focus();
	}, [q?.id]);
	// The tutor has spoken and waits: the keyboard lands on "Carry on", unless the student is typing.
	const carryOn = useRef<HTMLButtonElement>(null);
	const waiting = view.status === "reply" && !learn.finished;
	useEffect(() => { if (waiting && !isTyping()) carryOn.current?.focus(); }, [waiting, learn.phase]);
	// A new step starts at its top; something added to the step is brought into view.
	const stepKey = learn.step[0]?.type === "answered" ? learn.step[0].id : "first";
	useEffect(() => { window.scrollTo({ top: 0 }); }, [stepKey]);
	useEffect(() => { if (view.status === "thinking") setSent(false); }, [view.status, learn.step.length]);

	const openSlide = useCallback((n: number) => { setSlide(n); setPanel("slide"); }, []);
	const fail = (e: unknown, fallback: string) => setError(e instanceof ApiError ? e.message : fallback);

	async function submit() {
		if (!q || busy) return;
		const body = q.kind === "write" ? { questionId: q.id, text: written }
			: dontKnow ? { questionId: q.id, dontKnow: true, why: why.trim() || undefined }
			: { questionId: q.id, ...(picked.length ? { indices: picked } : {}), ...(q.kind === "ask" && written.trim() ? { text: written } : {}), ...(conf === null ? {} : { confidence: conf }), why: why.trim() || undefined };
		setBusy("answer");
		try {
			await mic.dictation.finish().catch(() => undefined);
			await lockedIn.answer(id, body);
			await reload();
		} catch (e) {
			fail(e, "That answer didn't go through");
		} finally {
			setBusy(null);
		}
	}
	async function tell(body: Parameters<typeof lockedIn.say>[1], clear = false) {
		if (busy) return;
		setBusy("say");
		setError(null);
		try {
			await mic.dictation.finish().catch(() => undefined);
			const r = await lockedIn.say(id, body);
			if (clear) setSay("");
			setSent(r.queued);
			await reload();
		} catch (e) {
			fail(e, "That didn't reach your tutor");
		} finally {
			setBusy(null);
		}
	}
	const sendSay = () => (say.trim() ? tell(q ? { text: say.trim(), questionId: q.id } : { text: say.trim() }, true) : undefined);
	async function askHint() {
		if (!q || busy) return;
		setBusy("hint");
		try {
			setHint((await lockedIn.hint(id, q.id)).text);
		} catch (e) {
			setHint(e instanceof ApiError ? `No hint this time: ${e.message}` : "No hint this time.");
		} finally {
			setBusy(null);
		}
	}
	async function showMe() {
		if (!q || busy) return;
		setBusy("show");
		try {
			await lockedIn.showMe(id, q.id);
			await reload();
		} catch (e) {
			fail(e, "Couldn't reach your tutor");
		} finally {
			setBusy(null);
		}
	}
	async function stop() {
		await lockedIn.stop(id).catch(() => undefined);
		router.push("/app");
	}
	async function finish() {
		setBusy("finish");
		await lockedIn.finish(id).catch(() => undefined);
		await reload();
		setBusy(null);
	}
	async function retry() {
		setBusy("retry");
		const problem = await lockedIn.retry(id).then(() => null, (e: unknown) => (e instanceof ApiError ? e.message : "Couldn't reach the app"));
		await reload();
		if (problem) setError(problem);
		setBusy(null);
	}
	async function practiseInstead() {
		setBusy("practise");
		try {
			router.replace(`/app/session/${(await lockedIn.practiceInstead(id)).sessionId}`);
		} catch (e) {
			fail(e, "Couldn't reach the app");
		} finally {
			setBusy(null);
		}
	}
	async function toggleEarlier() {
		if (earlier) return setEarlier(null);
		setEarlier((await lockedIn.steps(id).catch(() => [])).slice(0, -1));
	}

	const canSubmit = !!q && (q.kind === "write" ? !!written.trim() : dontKnow || picked.length > 0 || (q.kind === "ask" && !!written.trim()));
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
			if (e.key === "Escape" && mic.dictation.active) return mic.dictation.cancel();
			if (e.key === "Escape") return void stop();
			if (!q || q.kind === "write") return;
			const n = Number(e.key);
			if (Number.isInteger(n) && n >= 1 && n <= q.options.length) pick(n);
			else if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement) && canSubmit) void submit();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	});
	function pick(n: number) {
		setDontKnow(false);
		setPicked((p) => (q?.multi ? (p.includes(n) ? p.filter((x) => x !== n) : [...p, n]) : [n]));
	}

	const failure = sessionFailure(view.error);
	const plan = learn.plan;
	const where = learn.phase === "probe" ? LEARN_COPY.finding : plan && plan.index > 0 && plan.current ? LEARN_COPY.position(plan.index, plan.total, plan.current, plan.next) : plan ? LEARN_COPY.before(plan.total) : view.goal;
	const left = learn.endsAt ? Math.max(0, Math.ceil((new Date(learn.endsAt).getTime() - Date.now()) / 60_000)) : null;
	const timeUp = learn.timeUp || left === 0;
	const cited = q?.slides?.[0] ?? view.slideRefs[0];
	const pos = slidePosition(slides.map((x) => x.number), slide ?? cited);
	const s = slides.find((x) => x.number === pos.number);
	const items = learn.step.filter((i) => i.type !== "aside");
	const asides = learn.step.filter((i) => i.type === "aside");
	const talking = view.status === "question" || view.status === "reply" || view.status === "thinking";
	const label = !q ? null : q.guess ? LEARN_COPY.guess : q.kind === "write" ? LEARN_COPY.yourTurn : q.kind === "quiz" ? LEARN_COPY.check : null;

	return (
		<Tint module={view.lecture.module}>
			<div className="li-focus li-learn">
				<div className="li-focus-top">
					<button type="button" className="li-x" aria-label="Stop for now" title="Stop for now. It is saved with its plan." onClick={stop}>✕</button>
					<span style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 }}>
						<b className="li-display" style={{ fontSize: "1.25em" }}><span className="li-mode" data-study="learn">{LEARN_COPY.moduleButton}</span> {view.lecture.module} · {view.lecture.title}</b>
						<span className="li-small" style={{ color: "var(--li-deep-muted)" }}>{view.status === "done" ? SESSION_COPY.setFinishedShort : timeUp ? `${where} · ${LEARN_COPY.timeUp(learn.minutes)}` : where}</span>
					</span>
					{plan ? <button type="button" className="li-learn-tool" aria-pressed={panel === "plan"} onClick={() => setPanel(panel === "plan" ? null : "plan")}>{LEARN_COPY.planTab}</button> : null}
					<button type="button" className="li-learn-tool" aria-pressed={panel === "slide"} onClick={() => setPanel(panel === "slide" ? null : "slide")}>{LEARN_COPY.slideTab}</button>
					{left !== null && !timeUp && view.status !== "done" ? <b aria-label={`${left} minutes left`}>{LEARN_COPY.minutesLeft(left)}</b> : null}
				</div>

				<div className="li-panes" data-panel={panel ? "open" : "closed"}>
					<section className="li-qcard" aria-label="Your tutor">
						{view.status === "error" ? (
							<>
								<h2 className="li-q-stem">{failure.says}</h2>
								{error ?? loadError ? <div className="li-note" role="alert">{error ?? loadError}</div> : null}
								<div className="li-row">
									{failure.action === "connect"
										? <Link className="li-btn primary" href="/app/me#ai">{SESSION_FAILURE_ACTIONS.connect}</Link>
										: <button type="button" className="li-btn primary" onClick={retry} disabled={!!busy}>{busy === "retry" ? "Trying…" : SESSION_FAILURE_ACTIONS.retry}</button>}
									{view.practiceAvailable ? <button type="button" className="li-btn" onClick={practiseInstead} disabled={!!busy}>{SESSION_FAILURE_ACTIONS.practice}</button> : null}
									<Link className="li-btn" href="/app/library">{SESSION_FAILURE_ACTIONS.another}</Link>
								</div>
							</>
						) : null}

						{view.status === "preparing" ? <div className="li-activity" aria-live="polite"><span className="li-pulse" />{view.activity ?? LEARN_COPY.reading(view.lecture.module)}</div> : null}

						{view.status !== "error" && view.status !== "preparing" ? (
							<>
								{learn.earlier > 0 ? <button type="button" className="li-btn ghost" style={{ alignSelf: "flex-start" }} aria-expanded={!!earlier} onClick={() => void toggleEarlier()}>{LEARN_COPY.earlier(learn.earlier)}</button> : null}
								{earlier ? earlier.map((st, i) => <div key={i} className="li-step" style={{ opacity: 0.8, borderBottom: "1px solid var(--li-line)", paddingBottom: 14 }}>{st.map((it) => <Item key={`${it.type}-${it.id}`} item={it} plan={learn} onSlide={openSlide} />)}</div>) : null}

								<div className="li-step" aria-live="polite">
									{items.map((it) => <Item key={`${it.type}-${it.id}`} item={it} plan={learn} onSlide={openSlide} />)}
								</div>

								{view.status === "done" ? (
									<>
										<span className="li-eyebrow">{SESSION_COPY.setFinishedShort}</span>
										<h2 className="li-q-stem">{LEARN_COPY.doneTitle(view.lecture.title)}</h2>
										<p style={{ margin: 0 }}>{LEARN_COPY.covered(learn.covered ?? [])}</p>
										<p style={{ margin: 0 }}>{SESSION_COPY.comingBack(view.comingBack ?? [])}</p>
										{view.nextBlockAt ? <p className="li-note" style={{ margin: 0 }}>{SESSION_COPY.nextBlock(`${fmtDay(view.nextBlockAt, new Date())} ${fmtTime(view.nextBlockAt)}`)}</p> : null}
										<p className="li-small li-muted" style={{ margin: 0 }}>{SESSION_COPY.noScore}</p>
										<div className="li-row"><Link className="li-btn primary big" href="/app">{SESSION_COPY.finish}</Link></div>
									</>
								) : null}

								{q ? (
									<>
										{label ? <span className="li-eyebrow">{label}</span> : null}
										{/* A question is one line, or (a table, a worked set-up) several blocks. */}
										{q.stem.includes("\n")
											? <div className="li-q-stem" style={{ fontSize: "1.15em", fontWeight: 400 }} tabIndex={-1} ref={stem}><Prose text={q.stem} onSlide={openSlide} /></div>
											: <h2 className="li-q-stem" style={{ fontSize: "1.45em" }} tabIndex={-1} ref={stem}><InlineProse text={q.stem} onSlide={openSlide} /></h2>}
										{q.context ? <p className="li-muted" style={{ margin: 0 }}><InlineProse text={q.context} onSlide={openSlide} /></p> : null}
										{q.kind !== "write" ? (
											<div role={q.multi ? "group" : "radiogroup"} aria-label="Answers" className="li-stack" style={{ gap: 10 }}>
												{q.options.map((o) => (
													<button key={o.index} type="button" role={q.multi ? "checkbox" : "radio"} aria-checked={picked.includes(o.index)} className="li-opt" onClick={() => pick(o.index)}>
														<span className="li-kbd">{o.index}</span><span style={{ flexGrow: 1 }}><InlineProse text={o.label} /></span>
													</button>
												))}
												{q.kind === "quiz" ? (
													<button type="button" role={q.multi ? "checkbox" : "radio"} aria-checked={dontKnow} className="li-opt" onClick={() => { setDontKnow(true); setPicked([]); }}>
														<span className="li-kbd">?</span><span style={{ flexGrow: 1 }}>I don&apos;t know</span>
													</button>
												) : null}
											</div>
										) : null}
										{q.kind === "write" || q.other ? (
											<div className="li-row" style={{ alignItems: "flex-end", gap: 8 }}>
												<textarea className="li-input" rows={q.kind === "write" ? 3 : 1} value={written} onFocus={() => { target.current = "written"; }} onChange={(e) => setWritten(e.target.value)} placeholder={q.kind === "write" ? "Type or speak your answer…" : "Something else…"} aria-label={q.kind === "write" ? "Your answer" : "Something else"} />
												<span onPointerDown={() => { target.current = "written"; }}><MicButton mic={mic} /></span>
											</div>
										) : null}
										{/* How sure, and why, belong to a Check. A guess stays light: nothing is marked. */}
										{q.kind === "quiz" && !q.guess && !dontKnow && picked.length > 0 ? (
											<>
												<div className="li-stack" style={{ gap: 8 }}>
													<b>{SESSION_COPY.confidenceAsk}</b>
													<div role="radiogroup" aria-label="How sure you are" className="li-stops">
														{CONFIDENCE_TAPS.map((c) => <button key={c.value} type="button" role="radio" aria-checked={conf === c.value} onClick={() => setConf(conf === c.value ? null : c.value)}>{c.label}</button>)}
													</div>
												</div>
												<label className="li-stack" style={{ gap: 6 }}>
													<b>{SESSION_COPY.reasoning} <span className="li-muted" style={{ fontWeight: 400 }}>{SESSION_COPY.reasoningOptional}</span></b>
													<input className="li-input" value={why} onFocus={() => { target.current = "why"; }} onChange={(e) => setWhy(e.target.value)} placeholder={SESSION_COPY.reasoningSkip("tutor")} />
												</label>
											</>
										) : null}
										{hint ? <div className="li-note" role="note"><b>Hint:</b> {hint}</div> : null}
										{asides.map((it) => <Item key={it.id} item={it} plan={learn} onSlide={openSlide} />)}
										<div className="li-row">
											{view.canHint ? <button type="button" className="li-btn" onClick={askHint} disabled={!!busy || !!hint}>{busy === "hint" ? "Thinking…" : "Hint"}</button> : null}
											{q.kind === "quiz" && learn.phase !== "probe" ? <button type="button" className="li-btn" onClick={showMe} disabled={!!busy}>{busy === "show" ? "Getting it…" : "Show me first"}</button> : null}
											{learn.phase === "probe" ? <button type="button" className="li-btn" onClick={() => void tell({ say: "skipProbe" })} disabled={!!busy}>{LEARN_COPY.skipProbe}</button> : null}
											<button type="button" className="li-btn primary big" style={{ marginLeft: "auto" }} onClick={submit} disabled={!canSubmit || !!busy}>{busy === "answer" ? "Sending…" : q.kind === "quiz" && !q.guess ? "Check" : q.guess ? "That's my guess" : "Send"}</button>
										</div>
									</>
								) : null}

								{view.status === "thinking" ? <div className="li-activity" style={{ padding: "8px 0" }} aria-live="polite"><span className="li-pulse" />{view.activity ?? LEARN_COPY.writing}</div> : null}
								{sent ? <div className="li-note li-small" role="status">{LEARN_COPY.sent}</div> : null}

								{view.status === "reply" ? (
									<div className="li-row">
										{learn.phase === "probe" ? <button type="button" className="li-btn" onClick={() => void tell({ say: "skipProbe" })} disabled={!!busy}>{LEARN_COPY.skipProbe}</button> : null}
										{learn.finished ? <button type="button" className="li-btn primary big" onClick={finish} disabled={!!busy}>{LEARN_COPY.finish}</button> : null}
										<button type="button" ref={carryOn} className={`li-btn${learn.finished ? "" : " primary big"}`} onClick={() => void tell({ say: learn.phase === "plan" ? "planOk" : "carryOn" })} disabled={!!busy}>{learn.phase === "plan" ? LEARN_COPY.planOk : LEARN_COPY.carryOn}</button>
									</div>
								) : null}

								{error ? <div className="li-note" role="alert">{error}</div> : null}

								{talking ? (
									<form className="li-say" onSubmit={(e) => { e.preventDefault(); void sendSay(); }}>
										<textarea className="li-input" rows={1} value={say} aria-label="Ask or say something to your tutor" placeholder={mic.available ? LEARN_COPY.saySpeak : LEARN_COPY.say}
											onFocus={() => { target.current = "say"; }} onChange={(e) => setSay(e.target.value)}
											onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendSay(); } }} />
										<span onPointerDown={() => { target.current = "say"; }}><MicButton mic={mic} /></span>
										<button type="submit" className="li-btn" disabled={!say.trim() || !!busy}>{busy === "say" ? "Sending…" : "Send"}</button>
									</form>
								) : null}
							</>
						) : null}
					</section>

					{panel ? (
						<aside className="li-slides" aria-label={panel === "plan" ? "Plan" : "Slides"}>
							<div className="li-row" style={{ gap: 8 }}>
								<span className="li-tabs" role="tablist" style={{ flexGrow: 1 }}>
									{plan ? <button type="button" role="tab" aria-selected={panel === "plan"} onClick={() => setPanel("plan")}>{LEARN_COPY.planTab}</button> : null}
									<button type="button" role="tab" aria-selected={panel === "slide"} onClick={() => setPanel("slide")}>{LEARN_COPY.slideTab}</button>
								</span>
								<button type="button" className="li-icon-btn" aria-label="Close" onClick={() => setPanel(null)}>✕</button>
							</div>
							{panel === "plan" && plan ? <LearnPlan plan={plan} /> : null}
							{panel === "slide" ? (
								<>
									<div className="li-row" style={{ gap: 8 }}>
										<b style={{ flexGrow: 1 }}>{learn.unit ? `${learn.unit.title} · ` : ""}{slidePositionLabel(pos, hasPdf)}</b>
										<button type="button" className="li-icon-btn" aria-label={hasPdf ? "Previous page" : "Previous slide"} onClick={() => setSlide(pos.prev)} disabled={pos.prev === null}>‹</button>
										<button type="button" className="li-icon-btn" aria-label={hasPdf ? "Next page" : "Next slide"} onClick={() => setSlide(pos.next)} disabled={pos.next === null}>›</button>
									</div>
									<div className="li-slide" data-page={s && hasPdf ? "true" : "false"}>
										{s ? <SlidePage lectureId={unitId} slide={s} hasPdf={hasPdf} /> : <p className="li-slide-muted" style={{ margin: 0 }}>No slides for this yet.</p>}
									</div>
									{pos.total > 0 && pos.total <= MATERIALS_RULES.maxSlideDots ? <div className="li-dots" aria-hidden="true">{slides.map((x) => <span key={x.number} data-on={x.number === pos.number ? "true" : "false"} />)}</div> : null}
								</>
							) : null}
						</aside>
					) : null}
				</div>
			</div>
		</Tint>
	);
}
