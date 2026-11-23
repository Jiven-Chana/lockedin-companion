"use client";

/**
 * Onboarding v0.1 (spec J1′, DECISIONS.md V-15 to V-17, O-3):
 *   1. Connect your AI and pick models (required)
 *   2. Connect your timetable (link, file, none, or the labelled sample)
 *   3. Your modules: found in the calendar, tick / rename / add. The first
 *      taste starts preparing here.
 *   4. Try it now: 3 questions on the bundled sample lecture.
 */

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { moduleHue, SESSION_COPY, type DetectedModule } from "@/src/core";
import { ApiError, api, lockedIn, type FirstTaste } from "../api";
import { Icon, Logo } from "../icons";
import { Tint } from "../root";
import { ConnectAi } from "./connect";

type Source = "link" | "file" | "none" | "sample";
interface ModuleRow { code: string; name: string; on: boolean }

export function WelcomeScreen() {
	const router = useRouter();
	const [step, setStep] = useState(1);
	const [aiReady, setAiReady] = useState(false);
	const [source, setSource] = useState<Source>("link");
	const [link, setLink] = useState("");
	const [file, setFile] = useState<File | null>(null);
	const [fileText, setFileText] = useState<string | null>(null);
	const [rows, setRows] = useState<ModuleRow[]>([]);
	const [newModule, setNewModule] = useState("");
	const [found, setFound] = useState<{ events: number } | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [done, setDone] = useState<{ note: string; firstTaste: FirstTaste | null } | null>(null);
	const taste = useRef<Promise<{ sessionId: string } | null> | null>(null);

	useEffect(() => { void lockedIn.event("onboarding_step", { step, flow: "v0.1" }); }, [step]);

	/** Start the first taste once, as soon as the student reaches the modules screen (J1′). */
	function prewarm() {
		taste.current ??= lockedIn.firstTaste().catch(() => null);
	}

	async function readCalendar() {
		setBusy(true);
		setError(null);
		try {
			if (source === "sample") {
				const r = await api<{ modules: { code: string; name: string }[] }>("/modules");
				setRows(r.modules.map((m) => ({ ...m, on: true })));
				setFound(null);
			} else if (source === "none") {
				setFound(null);
			} else {
				const text = source === "file" && file ? await file.text() : null;
				setFileText(text);
				const preview = await lockedIn.calendarPreview(text !== null ? { text } : { url: link.trim() });
				setFound({ events: preview.events });
				setRows(preview.modules.map((m: DetectedModule) => ({ code: m.code, name: m.name, on: m.confident })));
			}
			prewarm();
			setStep(3);
		} catch (e) {
			setError(e instanceof ApiError ? e.message : "Couldn't read that calendar. Check the link or file.");
		} finally {
			setBusy(false);
		}
	}

	function addModule() {
		const name = newModule.trim();
		if (!name) return;
		setRows((r) => [...r, { code: "", name, on: true }]);
		setNewModule("");
	}

	async function finish() {
		setBusy(true);
		setError(null);
		try {
			const calendar =
				source === "sample" ? { kind: "sample" as const }
				: source === "none" ? { kind: "none" as const }
				: source === "file" ? { kind: "file" as const, text: fileText ?? "" }
				: { kind: "link" as const, url: link.trim() };
			const modules = rows.filter((r) => r.on && r.name.trim()).map((r) => ({ name: r.name.trim(), ...(r.code ? { code: r.code } : {}) }));
			const ob = await lockedIn.onboardV1({ calendar, ...(source === "sample" ? {} : { modules }), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
			const note = ob.calendar
				? `${ob.calendar.added} events read from your calendar${ob.calendar.unmapped ? `; ${ob.calendar.unmapped} didn't match a module` : ""}.`
				: source === "sample"
					? `I read the sample timetable: ${ob.reads.lectures} lectures.`
					: `${modules.length} ${modules.length === 1 ? "module" : "modules"} added. You can connect a calendar later in Me.`;
			setDone({ note, firstTaste: ob.firstTaste });
			setStep(4);
		} catch (e) {
			setError(e instanceof ApiError ? e.message : "Something went wrong. Try again.");
		} finally {
			setBusy(false);
		}
	}

	async function tryNow() {
		if (!done?.firstTaste) return router.push("/app");
		setBusy(true);
		const warm = taste.current ? await taste.current : null;
		const sessionId = warm?.sessionId ?? (await lockedIn.startSession(done.firstTaste.spec)).sessionId;
		router.push(`/app/session/${sessionId}`);
	}

	const linkOk = /^(https?|webcal):\/\//i.test(link.trim());
	const canNext =
		step === 1 ? aiReady
		: step === 2 ? source === "sample" || source === "none" || (source === "file" && !!file) || (source === "link" && linkOk)
		: step === 3 ? source === "sample" || rows.some((r) => r.on && r.name.trim())
		: true;
	const next = () => (step === 2 ? void readCalendar() : step === 3 ? void finish() : setStep(step + 1));

	const option = (id: Source, icon: React.ReactNode, title: string, sub: string, chip?: string) => (
		<button type="button" role="radio" aria-checked={source === id} className="li-opt" onClick={() => setSource(id)}>
			<span style={{ color: "var(--li-muted)" }}>{icon}</span>
			<span style={{ display: "flex", flexDirection: "column", flexGrow: 1 }}><b>{title}</b><span className="li-small li-muted">{sub}</span></span>
			{chip ? <span className="li-chip">{chip}</span> : null}
		</button>
	);

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
								<h1 className="li-h1">Connect your AI</h1>
								<p className="li-muted" style={{ margin: 0, fontSize: "1.1em" }}>LockedIn teaches with your own ChatGPT or API key. Then pick a model for each part of the teacher, or let me choose.</p>
								<ConnectAi onReadyChange={setAiReady} />
							</>
						) : null}

						{step === 2 ? (
							<>
								<h1 className="li-h1">Connect your timetable</h1>
								<p className="li-muted" style={{ margin: 0, fontSize: "1.1em" }}>So I can find your modules and nudge you after a lecture, never during one.</p>
								<div role="radiogroup" aria-label="Timetable source" className="li-stack" style={{ gap: 12 }}>
									{option("link", <Icon.link />, "Subscribe to a calendar link", "An iCal link from your timetable, Google, Outlook or Apple calendar")}
									{source === "link" ? (
										<label className="li-stack" style={{ gap: 6, paddingLeft: 8 }}>
											<b className="li-small">Calendar link</b>
											<input className="li-input" type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://… or webcal://…" autoFocus />
										</label>
									) : null}
									{option("file", <Icon.upload />, "Upload a calendar file", "An .ics export, read once")}
									{source === "file" ? (
										<label className="li-stack" style={{ gap: 6, paddingLeft: 8 }}>
											<b className="li-small">Calendar file (.ics)</b>
											<input type="file" accept=".ics,text/calendar" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
										</label>
									) : null}
									{option("none", <Icon.check />, "No calendar, I'll type my modules", "You can connect one later in Me")}
									{option("sample", <Icon.calendar />, "Use the sample timetable", "A demo week of HCI and Game Theory, clearly labelled", "Sample")}
								</div>
							</>
						) : null}

						{step === 3 ? (
							<>
								<h1 className="li-h1">Your modules</h1>
								<p className="li-muted" style={{ margin: 0, fontSize: "1.1em" }}>
									{source === "sample"
										? "The sample week has these two modules."
										: found
											? rows.length
												? `I found these in ${found.events} calendar events. Untick anything that isn't a module, and fix any names.`
												: `I read ${found.events} events but couldn't spot any modules. Add them below.`
											: "Add the modules you're taking this term."}
								</p>
								<div className="li-stack" style={{ gap: 10 }}>
									{rows.map((r, i) => (
										<Tint key={`${r.code}-${i}`} hue={moduleHue(r.code || r.name)}>
											<div className="li-opt" style={{ borderColor: r.on ? "var(--li-accent)" : undefined, background: r.on ? "var(--li-soft)" : undefined }}>
												<input type="checkbox" aria-label={`Include ${r.name}`} checked={r.on} disabled={source === "sample"} onChange={(e) => setRows((all) => all.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))} />
												<input className="li-input" aria-label="Module name" value={r.name} disabled={source === "sample"} onChange={(e) => setRows((all) => all.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} style={{ flexGrow: 1 }} />
												{r.code ? <span className="li-small li-muted">{r.code}</span> : null}
											</div>
										</Tint>
									))}
								</div>
								{source !== "sample" ? (
									<div className="li-row" style={{ gap: 8 }}>
										<input className="li-input" style={{ flex: "1 1 260px" }} value={newModule} onChange={(e) => setNewModule(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addModule(); }} placeholder="Add a module, e.g. Organic Chemistry" />
										<button type="button" className="li-btn" onClick={addModule} disabled={!newModule.trim()}>Add</button>
									</div>
								) : null}
								<p className="li-small li-muted" style={{ margin: 0 }}>While you check these, I&apos;m writing your first 3 practice questions.</p>
							</>
						) : null}

						{step === 4 && done ? (
							<>
								<h1 className="li-h1">You&apos;re set.</h1>
								<p className="li-muted" style={{ margin: 0, fontSize: "1.1em" }}>{done.note}</p>
								{done.firstTaste ? (
									<Tint hue={moduleHue(done.firstTaste.module)}>
										<button type="button" className="li-hero" onClick={tryNow} disabled={busy}>
											<span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
												<span className="li-eyebrow" style={{ color: "inherit", opacity: 0.85 }}>Try it now · sample lecture · {done.firstTaste.module}</span>
												<span className="li-hero-title">{done.firstTaste.title}</span>
												<span style={{ opacity: 0.9 }}>{SESSION_COPY.firstTaste()}</span>
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
								{step > 1 ? <button type="button" className="li-btn" onClick={() => setStep(step - 1)} disabled={busy}>Back</button> : null}
								<button type="button" className="li-btn primary big" style={{ marginLeft: "auto" }} disabled={!canNext || busy} onClick={next}>
									{busy ? (step === 2 ? "Reading…" : "Setting up…") : step < 3 ? "Continue" : "Finish"}
								</button>
							</div>
						) : null}
					</section>

					<aside className="li-card flat" style={{ flex: "1 1 300px", minWidth: 0, padding: 28, borderRadius: 28, background: "var(--li-rail)", display: "flex", flexDirection: "column", gap: 12 }}>
						<h2 className="li-h2">What I&apos;ll read</h2>
						<span className="li-row" style={{ alignItems: "flex-start", gap: 10, flexWrap: "nowrap" }}><b style={{ color: "var(--li-accent-text)" }}>✓</b>Event times and titles, to find your modules, lectures and free time</span>
						<span className="li-row" style={{ alignItems: "flex-start", gap: 10, flexWrap: "nowrap" }}><b style={{ color: "var(--li-accent-text)" }}>✓</b>Your lecture slides, to write the questions</span>
						<span className="li-row" style={{ alignItems: "flex-start", gap: 10, flexWrap: "nowrap" }}><b className="li-muted">✕</b>Never your location, contacts or anything else on your laptop</span>
						<span className="li-row" style={{ alignItems: "flex-start", gap: 10, flexWrap: "nowrap" }}><b className="li-muted">✕</b>Nothing leaves this laptop except what the teacher needs, sent to the AI you connect</span>
						<span className="li-small li-muted">See exactly what was read, and delete it in one click, from Me.</span>
					</aside>
				</div>
			</div>
		</div>
	);
}
