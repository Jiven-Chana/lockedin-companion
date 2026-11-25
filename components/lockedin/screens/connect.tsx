"use client";

/**
 * Connect your AI (v0.1 F-101, V-15, V-16, B-16): onboarding screen 1 and
 * Me → AI. Step A connects ChatGPT (the engine's web sign-in) or an API
 * key; step B sets LearnHarness's three slots, each with a thinking level,
 * or "Choose for me". Re-implemented in LockedIn's styles rather than
 * importing the engine's Tailwind settings screens (spec F-101).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
	CONNECT_COPY,
	CONNECT_RULES,
	SETUP_COPY,
	KEY_PROVIDERS,
	PROVIDER_LABEL,
	SLOT_META,
	slotCandidates,
	type CatalogModel,
	type KeyProvider,
	type SlotChoices,
	type ThinkingLevel,
} from "@/src/core";
import { ApiError, lockedIn, type AiFullStatus } from "../api";

const SLOTS = ["strong", "cheap", "vision"] as const;
type Slot = (typeof SLOTS)[number];
const LOGIN_TIMEOUT_MS = 180_000;

function price(m: CatalogModel) {
	return m.cost ? ` · $${m.cost.input}/$${m.cost.output} per M tokens` : m.provider === "chatgpt" ? " · included in ChatGPT" : "";
}

/** Rejects when the check takes longer than CONNECT_RULES.statusTimeoutMs, so the screen can say so and offer another try (v1.0 D-1). */
function statusInTime(): Promise<AiFullStatus> {
	return new Promise((resolve, reject) => {
		const timer = window.setTimeout(() => reject(new ApiError(504, "status_slow", CONNECT_COPY.slow)), CONNECT_RULES.statusTimeoutMs);
		lockedIn.ai.status().then(resolve, reject).finally(() => window.clearTimeout(timer));
	});
}

export function ConnectAi({ onReadyChange, onStatus, variant = "onboarding" }: { onReadyChange?: (ready: boolean) => void; /** Every status this screen loads, so a neighbour (Me → Voice) doesn't ask again. */ onStatus?: (status: AiFullStatus) => void; /** "setup" is the first run (V-45): one button, models chosen for the student. */ variant?: "onboarding" | "settings" | "setup" }) {
	const [status, setStatus] = useState<AiFullStatus | null>(null);
	const [draft, setDraft] = useState<SlotChoices>({});
	const [busy, setBusy] = useState<string | null>(null);
	const [msg, setMsg] = useState<string | null>(null);
	const [keyProvider, setKeyProvider] = useState<KeyProvider>("anthropic");
	const [key, setKey] = useState("");
	const [showKey, setShowKey] = useState(false);
	const [missing, setMissing] = useState<string[]>([]);
	const polling = useRef<number | null>(null);
	/** The first run chooses the models once, by itself. */
	const autoChosen = useRef(false);

	const apply = useCallback((s: AiFullStatus) => {
		setStatus(s);
		setDraft(s.slots);
		onReadyChange?.(s.ready);
		onStatus?.(s);
	}, [onReadyChange, onStatus]);

	const refresh = useCallback(async () => {
		setMsg(null);
		try {
			apply(await statusInTime());
		} catch (e) {
			setMsg(e instanceof ApiError ? e.message : CONNECT_COPY.failed);
		}
	}, [apply]);

	useEffect(() => {
		void refresh();
		return () => { if (polling.current) window.clearInterval(polling.current); };
	}, [refresh]);

	async function run(label: string, fn: () => Promise<void>) {
		setBusy(label);
		setMsg(null);
		try {
			await fn();
		} catch (e) {
			setMsg(e instanceof ApiError ? e.message : "Something went wrong. Try again.");
		} finally {
			setBusy(null);
		}
	}

	function signInWithChatGPT() {
		// Reserve the tab inside the click, or the browser blocks it as a pop-up.
		const tab = window.open("about:blank", "_blank");
		void run("chatgpt", async () => {
			const r = await lockedIn.ai.chatgpt("login");
			if (!r.browserAction) {
				tab?.close();
				throw new ApiError(400, "login", r.error ?? "ChatGPT sign-in couldn't start. Try again.");
			}
			if (tab) tab.location.href = r.browserAction;
			else window.location.href = r.browserAction;
			const started = Date.now();
			await new Promise<void>((resolve) => {
				polling.current = window.setInterval(async () => {
					const s = await lockedIn.ai.status().catch(() => null);
					if (!s) return;
					const finished = s.chatgpt.connected || (!s.chatgpt.pending && Date.now() - started > 3_000) || Date.now() - started > LOGIN_TIMEOUT_MS;
					if (!finished) return;
					if (polling.current) window.clearInterval(polling.current);
					polling.current = null;
					apply(s);
					if (!s.chatgpt.connected) setMsg(s.chatgpt.error ?? "ChatGPT sign-in didn't finish. Try again.");
					resolve();
				}, 1_500);
			});
		});
	}

	const connectKey = () => run("key", async () => {
		apply(await lockedIn.ai.key(keyProvider, key));
		setKey("");
		setShowKey(false);
	});

	const chooseForMe = () => run("auto", async () => {
		const r = await lockedIn.ai.chooseForMe(status?.provider ?? undefined);
		apply(r);
		setDraft(r.slots);
		setMissing(r.missing);
		if (r.missing.length) setMsg(`Your account doesn't offer our pick for ${r.missing.map((s) => SLOT_META[s as Slot].label).join(" and ")}. Choose one below.`);
	});

	const saveModels = () => run("save", async () => {
		apply(await lockedIn.ai.setModels(draft));
		setMissing([]);
	});

	// The first run (V-45): no pickers. Once an account is connected, the models are chosen for the student.
	const needsModels = variant === "setup" && !!status && status.provider !== null && !status.modelsReady;
	useEffect(() => {
		if (!needsModels || autoChosen.current) return;
		autoChosen.current = true;
		void chooseForMe();
		// chooseForMe reads the latest status itself; this runs once per sign-in.
	}, [needsModels]);

	const disconnect = (provider: string) => run("disconnect", async () => apply(await lockedIn.ai.disconnect(provider)));
	const setBackground = (enabled: boolean) => run("consent", async () => apply((await lockedIn.ai.chatgpt("consent", enabled)).status));

	if (!status) {
		return msg
			? <div className="li-row li-note" role="alert" style={{ gap: 10 }}><span style={{ flexGrow: 1 }}>{msg}</span><button type="button" className="li-btn" onClick={() => void refresh()}>{CONNECT_COPY.tryAgain}</button></div>
			: <p className="li-muted" aria-live="polite">{CONNECT_COPY.checking}</p>;
	}

	const connected = status.provider !== null;
	const connections = [
		...(status.chatgpt.connected ? [{ id: "chatgpt", label: `ChatGPT${status.chatgpt.email ? ` (${status.chatgpt.email})` : ""}` }] : []),
		...KEY_PROVIDERS.filter((p) => status.keys[p]).map((p) => ({ id: p, label: `${PROVIDER_LABEL[p]} API key` })),
	];
	const dirty = JSON.stringify(draft) !== JSON.stringify(status.slots);
	const allPicked = SLOTS.every((s) => draft[s]);

	// The first run: one button. The pickers below appear only if the account doesn't offer the models we would pick.
	if (variant === "setup" && missing.length === 0) {
		const needsConsent = status.chatgpt.connected && !status.chatgpt.allowBackgroundUse;
		return (
			<div className="li-stack" style={{ gap: 14 }}>
				{connections.map((c) => (
					<div key={c.id} className="li-row li-note" style={{ gap: 10 }}>
						<span style={{ color: "var(--li-accent-text)" }}>✓</span>
						<span style={{ flexGrow: 1 }}>Connected: {c.label}</span>
						<button type="button" className="li-link li-small" onClick={() => disconnect(c.id)} disabled={!!busy}>Disconnect</button>
					</div>
				))}
				{!connected ? (
					<button type="button" className="li-btn primary big" style={{ alignSelf: "flex-start" }} onClick={signInWithChatGPT} disabled={!!busy || !status.chatgpt.available}>
						{busy === "chatgpt" ? SETUP_COPY.signIn.waiting : SETUP_COPY.signIn.button}
					</button>
				) : null}
				{busy === "chatgpt" ? <button type="button" className="li-link li-small" style={{ alignSelf: "flex-start" }} onClick={() => void lockedIn.ai.chatgpt("cancel")}>Cancel sign-in</button> : null}
				{!status.chatgpt.available && !connected ? <span className="li-small li-muted">ChatGPT sign-in isn&apos;t available in this build yet. Use another AI account.</span> : null}
				{busy === "auto" ? <span className="li-small li-muted" aria-live="polite">{SETUP_COPY.signIn.choosing}</span> : null}
				{needsConsent ? (
					<div className="li-row li-note" style={{ gap: 12 }}>
						<span style={{ flexGrow: 1 }}>{SETUP_COPY.signIn.background}</span>
						<button type="button" className="li-btn primary" onClick={() => setBackground(true)} disabled={!!busy}>{SETUP_COPY.signIn.allow}</button>
					</div>
				) : null}
				{!connected && !showKey && busy !== "chatgpt" ? <button type="button" className="li-link li-small" style={{ alignSelf: "flex-start" }} onClick={() => setShowKey(true)}>{SETUP_COPY.signIn.other}</button> : null}
				{!connected && showKey ? (
					<div className="li-row" style={{ gap: 8, alignItems: "flex-end" }}>
						<label className="li-stack" style={{ gap: 4 }}>
							<span className="li-small">Provider</span>
							<select className="li-input" value={keyProvider} onChange={(e) => setKeyProvider(e.target.value as KeyProvider)}>
								{KEY_PROVIDERS.map((p) => <option key={p} value={p}>{PROVIDER_LABEL[p]}</option>)}
							</select>
						</label>
						<label className="li-stack" style={{ gap: 4, flex: "1 1 240px" }}>
							<span className="li-small">API key</span>
							<input className="li-input" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste your key" />
						</label>
						<button type="button" className="li-btn primary" onClick={connectKey} disabled={!key.trim() || !!busy}>{busy === "key" ? "Checking…" : "Save"}</button>
						<button type="button" className="li-btn" onClick={() => setShowKey(false)}>Cancel</button>
					</div>
				) : null}
				{msg ? <div className="li-note" role="alert">{msg}</div> : null}
			</div>
		);
	}

	return (
		<div className="li-stack" style={{ gap: 20 }}>
			{/* Step A: connect */}
			<div className="li-stack" style={{ gap: 12 }}>
				{variant === "onboarding" ? <b>1. Connect</b> : <b>Connection</b>}
				{connections.map((c) => (
					<div key={c.id} className="li-row li-note" style={{ gap: 10 }}>
						<span style={{ color: "var(--li-accent-text)" }}>✓</span>
						<span style={{ flexGrow: 1 }}>Connected: {c.label}</span>
						<button type="button" className="li-btn" onClick={() => disconnect(c.id)} disabled={!!busy}>Disconnect</button>
					</div>
				))}
				{!status.chatgpt.connected ? (
					<button type="button" className={`li-btn big${connected ? "" : " primary"}`} style={{ alignSelf: "flex-start" }} onClick={signInWithChatGPT} disabled={!!busy || !status.chatgpt.available}>
						{busy === "chatgpt" ? "Waiting for ChatGPT… finish signing in in the new tab" : "Sign in with ChatGPT"}
						{!connected ? <span className="li-chip" style={{ marginLeft: 10 }}>Recommended</span> : null}
					</button>
				) : null}
				{!status.chatgpt.available && !status.chatgpt.connected ? <span className="li-small li-muted">ChatGPT sign-in isn&apos;t available in this build yet. Use an API key.</span> : null}
				{busy === "chatgpt" ? <button type="button" className="li-btn" style={{ alignSelf: "flex-start" }} onClick={() => void lockedIn.ai.chatgpt("cancel")}>Cancel sign-in</button> : null}

				{status.chatgpt.connected ? (
					<label className="li-row" style={{ gap: 10, alignItems: "flex-start" }}>
						<input type="checkbox" checked={status.chatgpt.allowBackgroundUse} onChange={(e) => setBackground(e.target.checked)} disabled={!!busy} style={{ marginTop: 4 }} />
						<span className="li-stack" style={{ gap: 2 }}>
							<b>Allow background use for all ChatGPT accounts</b>
							<span className="li-small li-muted">LockedIn prepares your questions in the background, so this needs to be on.</span>
						</span>
					</label>
				) : null}

				{!showKey ? (
					<button type="button" className="li-btn" style={{ alignSelf: "flex-start" }} onClick={() => setShowKey(true)}>Use an API key</button>
				) : (
					<div className="li-row" style={{ gap: 8, alignItems: "flex-end" }}>
						<label className="li-stack" style={{ gap: 4 }}>
							<span className="li-small">Provider</span>
							<select className="li-input" value={keyProvider} onChange={(e) => setKeyProvider(e.target.value as KeyProvider)}>
								{KEY_PROVIDERS.map((p) => <option key={p} value={p}>{PROVIDER_LABEL[p]}</option>)}
							</select>
						</label>
						<label className="li-stack" style={{ gap: 4, flex: "1 1 240px" }}>
							<span className="li-small">API key</span>
							<input className="li-input" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste your key" />
						</label>
						<button type="button" className="li-btn primary" onClick={connectKey} disabled={!key.trim() || !!busy}>{busy === "key" ? "Checking…" : "Save"}</button>
						<button type="button" className="li-btn" onClick={() => setShowKey(false)}>Cancel</button>
					</div>
				)}
			</div>

			{/* Step B: models */}
			{connected ? (
				<div className="li-stack" style={{ gap: 14 }}>
					<div className="li-row" style={{ gap: 10 }}>
						<b style={{ flexGrow: 1 }}>{variant === "onboarding" ? "2. Pick your models" : "Models"}</b>
						<button type="button" className="li-btn primary" onClick={chooseForMe} disabled={!!busy}>{busy === "auto" ? "Choosing…" : "Choose for me"}</button>
					</div>
					{SLOTS.map((slot) => {
						const options = slotCandidates(slot, status.catalog);
						const choice = draft[slot];
						const model = choice ? status.catalog.find((m) => m.provider === choice.model.provider && m.id === choice.model.id) : undefined;
						const levels = model?.reasoning ? model.supportedLevels : [];
						return (
							<div key={slot} className="li-card flat" style={{ padding: 14, borderRadius: 16, borderColor: missing.includes(slot) ? "var(--li-accent)" : undefined }}>
								<div className="li-stack" style={{ gap: 2, marginBottom: 8 }}>
									<b>{SLOT_META[slot].label}</b>
									<span className="li-small li-muted">{SLOT_META[slot].roster} ({SLOT_META[slot].agents.toLowerCase()})</span>
								</div>
								<div className="li-row" style={{ gap: 8 }}>
									<select
										className="li-input"
										style={{ flex: "1 1 260px" }}
										aria-label={`${SLOT_META[slot].label} model`}
										value={choice ? `${choice.model.provider}/${choice.model.id}` : ""}
										onChange={(e) => {
											const m = options.find((o) => `${o.provider}/${o.id}` === e.target.value);
											setDraft((d) => ({ ...d, [slot]: m ? { model: { provider: m.provider, id: m.id } } : undefined }));
										}}
									>
										<option value="">Pick a model…</option>
										{options.map((m) => <option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>{m.name}{connections.length > 1 ? ` (${PROVIDER_LABEL[m.provider as keyof typeof PROVIDER_LABEL] ?? m.provider})` : ""}{price(m)}</option>)}
									</select>
									<select
										className="li-input"
										style={{ flex: "0 1 160px" }}
										aria-label={`${SLOT_META[slot].label} thinking level`}
										value={choice?.thinkingLevel ?? ""}
										disabled={levels.length === 0}
										onChange={(e) => setDraft((d) => (d[slot] ? { ...d, [slot]: { ...d[slot]!, ...(e.target.value ? { thinkingLevel: e.target.value as ThinkingLevel } : { thinkingLevel: undefined }) } } : d))}
									>
										<option value="">Thinking: default</option>
										{levels.map((l) => <option key={l} value={l}>Thinking: {l}</option>)}
									</select>
								</div>
							</div>
						);
					})}
					{dirty ? <button type="button" className="li-btn primary" style={{ alignSelf: "flex-start" }} onClick={saveModels} disabled={!allPicked || !!busy}>{busy === "save" ? "Saving…" : "Save models"}</button> : null}
				</div>
			) : null}

			{status.ready ? <div className="li-note" role="status">✓ Ready. Your sessions run on {PROVIDER_LABEL[status.provider!]}.</div> : connected && status.blocker ? <div className="li-note" role="status">{status.blocker}</div> : null}
			{msg ? <div className="li-note" role="alert">{msg}</div> : null}
		</div>
	);
}
