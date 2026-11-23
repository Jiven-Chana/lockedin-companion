"use client";

/**
 * "Plan my week with me" (v0.1 F-109, J8): optional, about six turns, a
 * question and tap-chips each turn, Skip always visible. Then a summary
 * card where every field can be changed; Confirm saves the routine and
 * shows the proposed week. Nothing is saved before Confirm. The same card,
 * empty, is the plain form ("Let's do this with taps instead").
 */

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { PLAN_COPY, type Routine } from "@/src/core";
import { ApiError, lockedIn } from "../api";
import { useData } from "../hooks";
import { PageHead } from "../shell";

type Msg = { role: "assistant" | "student"; text: string };
type Draft = Partial<Routine> & { modules?: { code: string; week?: number; readingWeeks?: number[] }[] };

const DAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const ENERGY = ["morning", "afternoon", "evening"] as const;

function SummaryCard({ initial, modules, onConfirm, busy, error }: { initial: Draft; modules: { code: string; name: string }[]; onConfirm: (d: Draft, source: "chat" | "form") => void; busy: boolean; error: string | null }) {
	const [d, setD] = useState<Draft>({ energy: [], commitments: [], places: [], preferredBlockMinutes: 50, ...initial });
	const set = (patch: Draft) => setD((x) => ({ ...x, ...patch }));
	const commitments = d.commitments ?? [];
	const setC = (i: number, patch: Partial<Routine["commitments"][number]>) => set({ commitments: commitments.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
	const modWeek = (code: string) => d.modules?.find((m) => m.code === code)?.week;
	return (
		<section className="li-card li-stack" style={{ gap: 16 }} aria-labelledby="sum-h">
			<h2 id="sum-h" className="li-h2">Check your week</h2>
			<div className="li-stack" style={{ gap: 6 }}>
				<b>When you have energy</b>
				<div className="li-row" style={{ gap: 8 }}>
					{ENERGY.map((e) => {
						const on = d.energy?.includes(e) ?? false;
						return <button key={e} type="button" className="li-chip" aria-pressed={on} data-on={on ? "true" : "false"} onClick={() => set({ energy: on ? d.energy!.filter((x) => x !== e) : [...(d.energy ?? []), e] })}>{e[0]!.toUpperCase() + e.slice(1)}</button>;
					})}
				</div>
			</div>
			<div className="li-stack" style={{ gap: 6 }}>
				<b>When you&apos;re busy</b>
				{commitments.map((c, i) => (
					<div key={i} className="li-row" style={{ gap: 6, flexWrap: "wrap" }}>
						<input className="li-input" style={{ width: 140 }} value={c.label} onChange={(e) => setC(i, { label: e.target.value })} aria-label="What" />
						{DAY.map((n, k) => {
							const on = c.weekdays.includes(k + 1);
							return <button key={n} type="button" className="li-chip" aria-pressed={on} data-on={on ? "true" : "false"} onClick={() => setC(i, { weekdays: on ? c.weekdays.filter((w) => w !== k + 1) : [...c.weekdays, k + 1].sort() })}>{n}</button>;
						})}
						<input className="li-input" type="time" style={{ width: "auto" }} value={c.start} onChange={(e) => setC(i, { start: e.target.value })} aria-label="From" />
						<input className="li-input" type="time" style={{ width: "auto" }} value={c.end} onChange={(e) => setC(i, { end: e.target.value })} aria-label="Until" />
						<button type="button" className="li-btn ghost" onClick={() => set({ commitments: commitments.filter((_, j) => j !== i) })} aria-label={`Remove ${c.label}`}>✕</button>
					</div>
				))}
				<button type="button" className="li-btn" style={{ alignSelf: "flex-start" }} onClick={() => set({ commitments: [...commitments, { label: "Shift", weekdays: [], start: "09:00", end: "17:00" }] })}>+ Add something regular</button>
			</div>
			<label className="li-stack" style={{ gap: 6 }}>
				<b>Where you like to study <span className="li-muted li-small">(optional)</span></b>
				<input className="li-input" value={(d.places ?? []).join(", ")} onChange={(e) => set({ places: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} placeholder="e.g. Library, home" />
			</label>
			<div className="li-row" style={{ gap: 16, flexWrap: "wrap" }}>
				<label className="li-stack" style={{ gap: 6 }}>
					<b>Weekly target</b>
					<select className="li-input" style={{ width: "auto" }} value={d.weeklyTargetMinutes ?? ""} onChange={(e) => set({ weeklyTargetMinutes: Number(e.target.value) })}>
						<option value="" disabled>Choose…</option>
						{[120, 240, 360, 480, 600].concat(d.weeklyTargetMinutes && ![120, 240, 360, 480, 600].includes(d.weeklyTargetMinutes) ? [d.weeklyTargetMinutes] : []).sort((a, b) => a - b).map((m) => <option key={m} value={m}>{PLAN_COPY.hours(m)}</option>)}
					</select>
				</label>
				<label className="li-stack" style={{ gap: 6 }}>
					<b>Block length</b>
					<select className="li-input" style={{ width: "auto" }} value={d.preferredBlockMinutes ?? 50} onChange={(e) => set({ preferredBlockMinutes: Number(e.target.value) })}>
						{[25, 40, 50, 60, 75, 90].map((m) => <option key={m} value={m}>{m} min</option>)}
					</select>
				</label>
			</div>
			{modules.length ? (
				<div className="li-stack" style={{ gap: 6 }}>
					<b>Which week each module is in <span className="li-muted li-small">(optional)</span></b>
					{modules.map((m) => (
						<label key={m.code} className="li-row" style={{ gap: 8 }}>
							<span style={{ minWidth: 200 }}>{m.name}</span>
							<select className="li-input" style={{ width: "auto" }} value={modWeek(m.code) ?? ""} onChange={(e) => set({ modules: [...(d.modules ?? []).filter((x) => x.code !== m.code), ...(e.target.value ? [{ code: m.code, week: Number(e.target.value) }] : [])] })}>
								<option value="">Not sure</option>
								{Array.from({ length: 15 }, (_, i) => i + 1).map((w) => <option key={w} value={w}>Week {w}</option>)}
							</select>
						</label>
					))}
				</div>
			) : null}
			{error ? <div className="li-note" role="alert">{error}</div> : null}
			<button type="button" className="li-btn primary big" style={{ alignSelf: "flex-start" }} disabled={busy || !d.weeklyTargetMinutes} onClick={() => onConfirm(d, initial === EMPTY ? "form" : "chat")}>{busy ? "Planning your week…" : "Confirm"}</button>
		</section>
	);
}

const EMPTY: Draft = {};

export function SetupChatScreen() {
	const router = useRouter();
	const profile = useData(() => lockedIn.profile());
	const [messages, setMessages] = useState<Msg[]>([]);
	const [chips, setChips] = useState<string[]>([]);
	const [draft, setDraft] = useState<Draft | null>(null);
	const [form, setForm] = useState(false);
	const [text, setText] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const started = useRef(false);
	const modules = profile.data?.modules ?? [];

	async function turn(next: Msg[]) {
		setBusy(true);
		setError(null);
		try {
			const t = await lockedIn.chatTurn(next);
			if (t.fallback) {
				setMessages([...next, { role: "assistant", text: t.say }]);
				setForm(true);
				return;
			}
			setMessages([...next, { role: "assistant", text: t.say }]);
			setChips(t.chips ?? []);
			if (t.draft) setDraft((d) => ({ ...(d ?? {}), ...(t.draft as Draft) }));
			if (t.done) setForm(true);
		} catch (e) {
			setError(e instanceof ApiError ? e.message : "The chat isn't available. Use the form instead.");
			setForm(true);
		} finally {
			setBusy(false);
		}
	}

	useEffect(() => {
		if (started.current) return;
		started.current = true;
		void turn([]);
	}, []);

	const answer = (value: string) => {
		if (!value.trim() || busy) return;
		setText("");
		setChips([]);
		void turn([...messages, { role: "student", text: value.trim() }]);
	};

	async function confirm(d: Draft, source: "chat" | "form") {
		setBusy(true);
		setError(null);
		try {
			const { modules: weeks, ...routine } = d;
			await lockedIn.saveRoutine({ routine, source, ...(weeks?.length ? { modules: weeks } : {}) });
			router.push("/app/plan");
		} catch (e) {
			setError(e instanceof ApiError ? e.message : "Couldn't save that");
			setBusy(false);
		}
	}

	return (
		<>
			<PageHead eyebrow="Week" title="Plan my week with me">
				<div className="li-row" style={{ gap: 8, marginTop: 12 }}>
					<span className="li-muted" style={{ flexGrow: 1 }}>A few quick questions. Nothing is saved until you confirm.</span>
					{!form ? <button type="button" className="li-btn" onClick={() => setForm(true)}>That&apos;s it</button> : null}
					<button type="button" className="li-btn ghost" onClick={async () => { await lockedIn.skipChat().catch(() => undefined); router.push("/app/plan"); }}>Skip</button>
				</div>
			</PageHead>
			<div className="li-stack" style={{ gap: 10 }} aria-live="polite">
				{messages.map((m, i) => <div key={i} className="li-bubble" data-role={m.role}>{m.text}</div>)}
				{busy && !form ? <div className="li-bubble" data-role="assistant"><span className="li-muted">…</span></div> : null}
			</div>
			{!form ? (
				<div className="li-stack" style={{ gap: 10 }}>
					<div className="li-row" style={{ gap: 8 }}>{chips.map((c) => <button key={c} type="button" className="li-chip" disabled={busy} onClick={() => answer(c)}>{c}</button>)}</div>
					<form className="li-row" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); answer(text); }}>
						<input className="li-input" style={{ flex: "1 1 280px" }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Or type your answer" aria-label="Your answer" />
						<button type="submit" className="li-btn primary" disabled={busy || !text.trim()}>Send</button>
					</form>
				</div>
			) : (
				<SummaryCard key={draft ? "chat" : "form"} initial={draft ?? EMPTY} modules={modules} onConfirm={confirm} busy={busy} error={error} />
			)}
		</>
	);
}
