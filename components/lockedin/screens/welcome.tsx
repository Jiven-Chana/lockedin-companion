"use client";

/**
 * Onboarding (plan §7.8): three decisions, then "What I read", then a
 * real session. No account, no key, no model choice (AE2-1, AE2-P14).
 */

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { DEFAULT_PREFS, moduleHue, SESSION_COPY } from "@/src/core";
import { ApiError, api, lockedIn, type TodayData } from "../api";
import { Icon, Logo } from "../icons";
import { Tint } from "../root";

type Source = "sample" | "file" | "link";

export function WelcomeScreen() {
	const router = useRouter();
	const [step, setStep] = useState(1);
	const [modules, setModules] = useState<{ code: string; name: string }[]>([]);
	const [picked, setPicked] = useState<string[]>([]);
	const [source, setSource] = useState<Source>("sample");
	const [link, setLink] = useState("");
	const [file, setFile] = useState<File | null>(null);
	const [perDay, setPerDay] = useState<1 | 2>(1);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [done, setDone] = useState<{ reads: Awaited<ReturnType<typeof lockedIn.reads>>; tryNow: TodayData["tryNow"]; note?: string } | null>(null);

	useEffect(() => {
		api<{ modules: { code: string; name: string }[] }>("/modules").then((r) => { setModules(r.modules); setPicked(r.modules.map((m) => m.code)); }).catch(() => undefined);
	}, []);
	useEffect(() => { void lockedIn.event("onboarding_step", { step }); }, [step]);

	async function finish() {
		setBusy(true);
		setError(null);
		try {
			const ob = await lockedIn.onboard({ modules: picked, timetableSource: source === "sample" ? "sample" : "ics", nudgesPerDay: perDay });
			let note: string | undefined;
			if (source === "file" && file) {
				const r = await lockedIn.importIcs(await file.text());
				note = `${r.added} events read from ${file.name}${r.unmapped.length ? `; ${r.unmapped.length} didn't match a module` : ""}.`;
			} else if (source === "link" && link.trim()) {
				const r = await lockedIn.subscribe(link.trim());
				note = `${r.added} events read from your calendar link${r.unmapped.length ? `; ${r.unmapped.length} didn't match a module` : ""}. It refreshes when you open the app.`;
			}
			setDone({ reads: await lockedIn.reads(), tryNow: ob.tryNow, note });
			setStep(4);
		} catch (e) {
			setError(e instanceof ApiError ? e.message : "Something went wrong. Try again.");
		} finally {
			setBusy(false);
		}
	}

	async function tryNow() {
		if (!done?.tryNow) return router.push("/app");
		setBusy(true);
		const { sessionId } = await lockedIn.startSession(done.tryNow.spec);
		router.push(`/app/session/${sessionId}`);
	}

	const canNext = step === 1 ? picked.length > 0 : step === 2 ? source === "sample" || (source === "file" && !!file) || (source === "link" && /^(https?|webcal):\/\//i.test(link.trim())) : true;

	return (
		<div style={{ minHeight: "100vh", display: "flex", justifyContent: "center", padding: "48px 32px" }}>
			<div style={{ width: "100%", maxWidth: 1080, display: "flex", flexDirection: "column", gap: 28 }}>
				<div className="li-row">
					<span className="li-row" style={{ gap: 10, flexGrow: 1 }}><Logo /><b className="li-display" style={{ fontSize: 20 }}>LockedIn</b></span>
					{step <= 3 ? (
						<>
							<span className="li-small li-muted">Step {step} of 3</span>
							<span aria-hidden="true" className="li-row" style={{ gap: 6 }}>{[1, 2, 3].map((n) => <span key={n} style={{ width: 40, height: 6, borderRadius: 3, background: n <= step ? "var(--li-accent)" : "var(--li-line)" }} />)}</span>
						</>
					) : null}
				</div>

				<div className="li-row" style={{ alignItems: "flex-start", gap: 28 }}>
					<section className="li-card" style={{ flex: "999 1 560px", minWidth: 0, padding: 36, borderRadius: 28, display: "flex", flexDirection: "column", gap: 20 }}>
						{step === 1 ? (
							<>
								<h1 className="li-h1">What are you studying?</h1>
								<p className="li-muted" style={{ margin: 0, fontSize: "1.1em" }}>Pick your modules. Each one gets its own colour.</p>
								<div className="li-row" style={{ gap: 12 }}>
									{modules.map((m) => {
										const on = picked.includes(m.code);
										return (
											<Tint key={m.code} hue={moduleHue(m.code)}>
												<button type="button" aria-pressed={on} onClick={() => setPicked((p) => (on ? p.filter((x) => x !== m.code) : [...p, m.code]))} className="li-opt" style={{ width: "auto", minWidth: 260, borderColor: on ? "var(--li-accent)" : undefined, background: on ? "var(--li-soft)" : undefined }}>
													<span style={{ width: 32, height: 32, borderRadius: 10, background: "var(--li-accent)", flexShrink: 0 }} />
													<span style={{ display: "flex", flexDirection: "column" }}><b>{m.name}</b><span className="li-small li-muted">{m.code}</span></span>
													{on ? <span style={{ marginLeft: "auto", color: "var(--li-accent-text)" }}><Icon.check /></span> : null}
												</button>
											</Tint>
										);
									})}
								</div>
							</>
						) : null}

						{step === 2 ? (
							<>
								<h1 className="li-h1">Connect your calendar</h1>
								<p className="li-muted" style={{ margin: 0, fontSize: "1.1em" }}>So I can nudge you after a lecture, never during one.</p>
								<div role="radiogroup" aria-label="Calendar source" className="li-stack" style={{ gap: 12 }}>
									<button type="button" role="radio" aria-checked={source === "link"} className="li-opt" onClick={() => setSource("link")} style={{ alignItems: "flex-start" }}>
										<span style={{ color: "var(--li-accent-text)", marginTop: 2 }}><Icon.link /></span>
										<span style={{ display: "flex", flexDirection: "column", gap: 4, flexGrow: 1 }}>
											<b>Subscribe to a calendar link</b>
											<span className="li-small li-muted">University timetables, Google, Outlook and Apple calendars all give you an iCal link.</span>
										</span>
									</button>
									{source === "link" ? (
										<label className="li-stack" style={{ gap: 6, paddingLeft: 8 }}>
											<b className="li-small">Calendar link</b>
											<input className="li-input" type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://… or webcal://…" autoFocus />
										</label>
									) : null}
									<button type="button" role="radio" aria-checked={source === "file"} className="li-opt" onClick={() => setSource("file")}>
										<span style={{ color: "var(--li-muted)" }}><Icon.upload /></span>
										<span style={{ display: "flex", flexDirection: "column", flexGrow: 1 }}><b>Upload a calendar file</b><span className="li-small li-muted">An .ics export, read once</span></span>
									</button>
									{source === "file" ? (
										<label className="li-stack" style={{ gap: 6, paddingLeft: 8 }}>
											<b className="li-small">Calendar file (.ics)</b>
											<input type="file" accept=".ics,text/calendar" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
										</label>
									) : null}
									<button type="button" role="radio" aria-checked={source === "sample"} className="li-opt" onClick={() => setSource("sample")}>
										<span style={{ color: "var(--li-muted)" }}><Icon.calendar /></span>
										<span style={{ display: "flex", flexDirection: "column", flexGrow: 1 }}><b>Use the sample timetable</b><span className="li-small li-muted">A realistic week for your modules, clearly labelled as a sample</span></span>
										<span className="li-chip">Sample</span>
									</button>
								</div>
							</>
						) : null}

						{step === 3 ? (
							<>
								<h1 className="li-h1">How often can I nudge you?</h1>
								<p className="li-muted" style={{ margin: 0, fontSize: "1.1em" }}>Each nudge brings a session with a goal and question 1 ready. {SESSION_COPY.nudgeLimits(DEFAULT_PREFS.quietHours)}</p>
								<div role="radiogroup" aria-label="Nudges per day" className="li-row" style={{ gap: 12 }}>
									{([1, 2] as const).map((n) => (
										<button key={n} type="button" role="radio" aria-checked={perDay === n} className="li-opt" style={{ width: "auto", minWidth: 240 }} onClick={() => setPerDay(n)}>
											<span style={{ display: "flex", flexDirection: "column" }}><b>{n === 1 ? "Once a day" : "Twice a day"}</b><span className="li-small li-muted">{n === 1 ? "Recommended. Usually after a lecture." : "If one isn't enough."}</span></span>
										</button>
									))}
								</div>
								<p className="li-small li-muted" style={{ margin: 0 }}>Quiet hours and everything else can be changed later in Me.</p>
							</>
						) : null}

						{step === 4 && done ? (
							<>
								<h1 className="li-h1">You&apos;re set.</h1>
								<p className="li-muted" style={{ margin: 0, fontSize: "1.1em" }}>{done.note ?? `I read the ${done.reads.label.toLowerCase()}: ${done.reads.lectures} lectures across ${done.reads.modules.join(" and ")}.`}</p>
								{done.tryNow ? (
									<Tint hue={moduleHue(done.tryNow.module)}>
										<button type="button" className="li-hero" onClick={tryNow} disabled={busy}>
											<span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
												<span className="li-eyebrow" style={{ color: "inherit", opacity: 0.85 }}>Try it now · {done.tryNow.module}</span>
												<span className="li-hero-title">{done.tryNow.title}</span>
												<span style={{ opacity: 0.9 }}>{SESSION_COPY.tryNow()}</span>
											</span>
											<span className="li-hero-cta">{busy ? "Starting…" : "Start"}</span>
										</button>
									</Tint>
								) : null}
								<button type="button" className="li-btn" style={{ alignSelf: "flex-start" }} onClick={() => router.push("/app")}>Go to Today</button>
							</>
						) : null}

						{error ? <div className="li-note" role="alert">{error}</div> : null}
						{step <= 3 ? (
							<div className="li-row">
								{step > 1 ? <button type="button" className="li-btn" onClick={() => setStep(step - 1)}>Back</button> : null}
								<button type="button" className="li-btn primary big" style={{ marginLeft: "auto" }} disabled={!canNext || busy} onClick={() => (step < 3 ? setStep(step + 1) : void finish())}>{step < 3 ? "Continue" : busy ? "Setting up…" : "Finish"}</button>
							</div>
						) : null}
					</section>

					<aside className="li-card flat" style={{ flex: "1 1 300px", minWidth: 0, padding: 28, borderRadius: 28, background: "var(--li-rail)", display: "flex", flexDirection: "column", gap: 12 }}>
						<h2 className="li-h2">What I&apos;ll read</h2>
						<span className="li-row" style={{ alignItems: "flex-start", gap: 10, flexWrap: "nowrap" }}><b style={{ color: "var(--li-accent-text)" }}>✓</b>Event times and titles, to find your lectures and free time</span>
						<span className="li-row" style={{ alignItems: "flex-start", gap: 10, flexWrap: "nowrap" }}><b style={{ color: "var(--li-accent-text)" }}>✓</b>Your lecture slides, to write the questions</span>
						<span className="li-row" style={{ alignItems: "flex-start", gap: 10, flexWrap: "nowrap" }}><b className="li-muted">✕</b>Never your location, contacts or anything else on your laptop</span>
						<span className="li-row" style={{ alignItems: "flex-start", gap: 10, flexWrap: "nowrap" }}><b className="li-muted">✕</b>Nothing leaves this laptop except questions to the teaching model</span>
						<span className="li-small li-muted">See exactly what was read, and delete it in one click, from Me.</span>
					</aside>
				</div>
			</div>
		</div>
	);
}
