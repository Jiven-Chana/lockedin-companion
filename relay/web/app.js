/* LockedIn phone app (v0.1 F-112, J2′, J9). Plain JS, no build.
 * Screens: pair · question → result → hand-off · this week (+ Sunday check-in) · settings-lite.
 * No other learning on the phone (R-8): sessions happen on the laptop.
 * Wording: spec Appendix A.
 */

const COPY = {
	right: (exp) => `✓ Right. ${exp}`,
	wrong: (opt, exp) => `It's ${opt}. ${exp}`,
	more: (n) => `${n} more on your laptop`,
	done: "Done for now",
	holds: "Lecture names and times, your phone's questions and answers, your study block times. Never your location, slides, notes or AI key.",
	offline: "Can't reach LockedIn right now. Your answers are saved and will be sent when you're back online.",
	// The guided install on an iPhone (v1.0 P-1, V-29).
	install: {
		title: "Add LockedIn to your Home Screen",
		why: "iPhones only allow notifications from apps on the Home Screen. It takes three taps.",
		share: "Tap the Share button",
		shareWhere: "the square with an arrow, at the bottom of Safari",
		shareWhereOther: "the square with an arrow, next to the address at the top",
		add: "Scroll down and tap “Add to Home Screen”",
		open: "Tap Add, then open LockedIn from your Home Screen",
		openNote: "It opens already paired with your laptop.",
		installed: "✓ Installed",
		allow: "Now tap Allow notifications.",
		tryTitle: "Try one now",
		tryNote: "A sample question. Nothing you tap here is sent to your laptop.",
		tried: "That's how a question looks. Yours arrive after your lectures, once LockedIn is on your Home Screen.",
	},
};
/** The sample on the install screen: the bundled HCI "Personas" lecture's first question, cut to three options. */
const SAMPLE = {
	title: "Sample · HCI",
	stem: "Which is the main purpose of a persona?",
	options: ["To focus design decisions on specific users' goals", "To record the demographic average of all users", "To replace user research when time is short"],
	correct: 0,
	explanation: "A persona keeps specific users' goals in view, so decisions are made for someone concrete.",
};
/** Pictures for the install steps: iOS's own Share and Add to Home Screen glyphs, redrawn. Static markup only. */
const ICONS = {
	share: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3.5"/><path d="M8 7l4-4 4 4"/><path d="M8.5 10H6.5A1.5 1.5 0 0 0 5 11.5v8A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 17.5 10h-2"/></svg>',
	add: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8.5v7M8.5 12h7"/></svg>',
};
const FEELINGS = { "too-much": "Too much", "about-right": "About right", "too-little": "Too little" };
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const $app = document.getElementById("app");
const h = (tag, attrs = {}, ...kids) => {
	const el = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
		else if (v !== false && v != null) el.setAttribute(k, v === true ? "" : v);
	}
	for (const k of kids.flat()) if (k != null && k !== false) el.append(k.nodeType ? k : String(k));
	return el;
};
const show = (...nodes) => $app.replaceChildren(...nodes);
/** A static SVG from ICONS as a node. Never called with anything a server sent. */
const icon = (name) => {
	const t = document.createElement("template");
	t.innerHTML = ICONS[name];
	return t.content.firstChild;
};

// ─── storage shared with the service worker (Cache Storage) ────────────────
async function kv(key, value) {
	const c = await caches.open("lockedin-data-v1");
	if (value === undefined) {
		const r = await c.match(`/kv/${key}`);
		return r ? r.json() : null;
	}
	if (value === null) return c.delete(`/kv/${key}`);
	await c.put(`/kv/${key}`, new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } }));
}
const local = {
	get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
	set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// ─── relay calls ────────────────────────────────────────────────────────────
let PAIR = null;
const api = (path, opts = {}) =>
	fetch(`/v1/pairs/${PAIR.pairId}${path}`, { ...opts, headers: { authorization: `Bearer ${PAIR.token}`, "content-type": "application/json", ...(opts.headers || {}) } });

async function schedule(fresh = true) {
	if (fresh) {
		try {
			const res = await api("/schedule");
			if (res.status === 401) return { unpaired: true };
			if (res.ok) {
				const s = await res.json();
				await kv("schedule", s);
				return s;
			}
		} catch {}
	}
	return (await kv("schedule")) || { nudges: [], blocks: [], offline: true };
}

/** Events are queued and sent in order; a retry is harmless (idempotent ids, spec §5.2). */
function uuid() {
	return crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 14)}`;
}
async function event(type, nudgeId, payload = {}) {
	const queue = local.get("queue", []);
	queue.push({ id: uuid(), at: new Date().toISOString(), type, ...(nudgeId ? { nudgeId } : {}), payload });
	local.set("queue", queue);
	return flush();
}
async function flush() {
	const queue = local.get("queue", []);
	if (!queue.length || !PAIR) return true;
	try {
		const res = await api("/events", { method: "POST", body: JSON.stringify(queue.slice(0, 50)) });
		if (!res.ok) return false;
		local.set("queue", local.get("queue", []).slice(Math.min(50, queue.length)));
		return local.get("queue", []).length ? flush() : true;
	} catch {
		return false;
	}
}
window.addEventListener("online", () => void flush());

// ─── pairing (J9) ───────────────────────────────────────────────────────────
const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

function b64ToBytes(s) {
	const b = atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "="));
	return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

async function enablePush() {
	if (!("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("This browser can't receive notifications from a web app.");
	const perm = await Notification.requestPermission();
	if (perm !== "granted") throw new Error("Notifications are blocked. Allow them for LockedIn in your phone's settings.");
	const { publicKey } = await (await fetch("/v1/vapid")).json();
	if (!publicKey) throw new Error("The relay has no push key yet (VAPID).");
	const reg = await navigator.serviceWorker.ready;
	const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) }));
	const res = await api("/subscriptions", { method: "POST", body: JSON.stringify({ endpoint: sub.endpoint }) });
	if (!res.ok) throw new Error("Couldn't register this phone with LockedIn.");
}

function nextQuestionText(s) {
	const n = (s.nudges || []).find((x) => x.kind === "N-1" && !x.sentAt);
	if (!n) return "Your next question comes after your next lecture.";
	const moduleName = n.module || (n.title || "").split(" just finished")[0] || "your next lecture";
	const d = new Date(n.fireAt);
	const today = new Date();
	const day = d.toDateString() === today.toDateString() ? "today" : `on ${DAYS[d.getDay()]}`;
	return `Your next question comes after ${moduleName} ${day}.`;
}

/**
 * An iPhone gives a Home Screen app its own storage, so a pairing saved in
 * Safari is gone once LockedIn is installed. The manifest decides the
 * address the installed app opens at: point it at this pair's own manifest,
 * whose start address carries the pairing (v1.0 P-1).
 */
function usePairManifest() {
	const link = document.querySelector('link[rel="manifest"]');
	if (link && PAIR) link.setAttribute("href", `/v1/manifest?pair=${PAIR.pairId}.${PAIR.token}`);
}

/** The sample question on the install screen. It sends no events: the laptop replays those as real answers. */
function sampleQuestion() {
	const box = h("section", { class: "card" }, h("p", { class: "eyebrow" }, `${COPY.install.tryTitle} · ${SAMPLE.title}`), h("h2", {}, SAMPLE.stem));
	const options = h("div", { class: "options", role: "group", "aria-label": "Answers" }, SAMPLE.options.map((o, i) => h("button", { class: "btn option", onclick: () => {
		const right = i === SAMPLE.correct;
		options.replaceWith(h("p", { class: right ? "result right" : "result" }, right ? COPY.right(SAMPLE.explanation) : COPY.wrong(SAMPLE.options[SAMPLE.correct], SAMPLE.explanation)), h("p", { class: "muted small" }, COPY.install.tried));
	} }, o)));
	box.append(options, h("p", { class: "muted small" }, COPY.install.tryNote));
	return box;
}

/** iPhone, in the browser: the three taps to the Home Screen, with pictures, and a question to try meanwhile. */
function installGuide() {
	usePairManifest();
	// Tells the relay this phone opened the link, so the laptop stops saying "Waiting for your phone…".
	void schedule();
	const otherBrowser = /crios|fxios|edgios/i.test(navigator.userAgent);
	const step = (picture, text, note) => h("li", { class: "step" }, h("span", { class: "step-icon" }, picture), h("span", {}, h("b", {}, text), note ? h("span", { class: "muted small step-note" }, note) : null));
	show(
		h("main", {},
			h("h1", {}, COPY.install.title),
			h("p", {}, COPY.install.why),
			h("ol", { class: "steps" },
				step(icon("share"), COPY.install.share, otherBrowser ? COPY.install.shareWhereOther : COPY.install.shareWhere),
				step(icon("add"), COPY.install.add),
				step(h("img", { src: "/icon-192.png", width: "28", height: "28", alt: "" }), COPY.install.open, COPY.install.openNote),
			),
			sampleQuestion(),
		),
	);
}

async function pairScreen() {
	const msg = h("p", { class: "muted", role: "status" });
	const btn = h("button", { class: "btn primary", onclick: async () => {
		btn.disabled = true;
		msg.textContent = "Setting up…";
		try {
			await enablePush();
			local.set("pushOn", true);
			const s = await schedule();
			show(h("main", {}, h("h1", {}, "Paired with your laptop."), h("p", {}, nextQuestionText(s)), h("button", { class: "btn", onclick: () => render() }, "OK")));
		} catch (e) {
			msg.textContent = e.message;
			btn.disabled = false;
		}
	} }, "Allow notifications");
	if (isIos && !standalone) return installGuide();
	// Opened from the Home Screen: say the install worked, then the one thing left.
	if (isIos && standalone) return show(h("main", {}, h("h1", {}, COPY.install.installed), h("p", {}, COPY.install.allow), btn, msg));
	show(h("main", {}, h("h1", {}, "Get questions on your phone"), h("p", {}, "One question after a lecture, never more than you chose. Answering here is the first step; your laptop continues."), btn, msg));
}

// ─── the question (J2′) ─────────────────────────────────────────────────────
function questionScreen(n, s) {
	const q = n.question;
	void event("opened", n.id, { kind: n.kind });
	if (!q) {
		// No question in this nudge (the v1 fallback): the laptop is where it continues.
		return show(h("main", {}, h("p", { class: "eyebrow" }, n.title), h("h1", {}, n.body), h("p", { class: "muted" }, n.why ? `Why now: ${n.why}` : ""), handoff(n, null)));
	}
	const choose = (i) => {
		const right = i === q.correct;
		const exp = /\(Slides? \d/.test(q.explanation) ? q.explanation : `${q.explanation}${q.slides?.length ? ` (Slide ${q.slides[0]})` : ""}`;
		void event("answered", n.id, { questionId: q.id, lectureId: q.lectureId, choice: i, correct: right });
		const done = local.get("answered", []);
		done.push(n.id);
		local.set("answered", done.slice(-200));
		show(h("main", {}, h("p", { class: "eyebrow" }, n.title), h("h1", {}, q.stem), h("p", { class: right ? "result right" : "result" }, right ? COPY.right(exp) : COPY.wrong(q.options[q.correct], exp)), handoff(n, { questionId: q.id, choice: i, correct: right })));
	};
	show(
		h("main", {},
			h("p", { class: "eyebrow" }, n.title),
			h("h1", {}, q.stem),
			h("div", { class: "options", role: "group", "aria-label": "Answers" }, q.options.map((o, i) => h("button", { class: "btn option", onclick: () => choose(i) }, o))),
			h("p", { class: "muted small" }, n.why ? `Why now: ${n.why}` : ""),
			h("button", { class: "btn ghost", onclick: () => { void event("snoozed", n.id); render(); } }, "Later"),
		),
	);
}

function handoff(n, answer) {
	const more = n.more ?? 4;
	return h("div", { class: "row" },
		h("button", { class: "btn primary", onclick: async () => {
			await event("handover", n.id, { ...(answer || {}), lectureId: n.lectureId });
			show(h("main", {}, h("h1", {}, "It's waiting on your laptop."), h("p", {}, "Open LockedIn on your laptop: your answer is already there."), h("button", { class: "btn", onclick: () => render() }, "OK")));
		} }, COPY.more(more)),
		h("button", { class: "btn", onclick: async () => { await event("done_for_now", n.id); render(); } }, COPY.done),
	);
}

// ─── this week, the Sunday check-in, settings-lite ─────────────────────────
function checkinCard(n) {
	const c = n.checkin;
	if (!c) return null;
	const box = h("section", { class: "card" }, h("h2", {}, "Your week"), h("p", {}, c.text));
	const feelings = h("div", { class: "row" }, Object.entries(FEELINGS).map(([k, label]) => h("button", { class: "btn", onclick: () => {
		const proposed = c.options?.[k] ?? c.current;
		feelings.replaceWith(
			proposed === c.current
				? h("div", { class: "row" }, h("button", { class: "btn primary", onclick: () => finish(k, { keep: true }) }, "Same again next week"))
				: h("div", { class: "row" }, h("b", {}, c.ask?.[k] ?? `Try ${proposed} minutes next week?`), h("button", { class: "btn primary", onclick: () => finish(k, { target: proposed }) }, "Yes"), h("button", { class: "btn", onclick: () => finish(k, { keep: true }) }, c.keepLabel ?? "Keep")),
		);
	} }, label)));
	const finish = async (feeling, choice) => {
		await event("checkin", n.id, { feeling });
		await event("target_confirm", n.id, choice);
		const done = local.get("answered", []);
		done.push(n.id);
		local.set("answered", done);
		box.replaceChildren(h("h2", {}, "Your week"), h("p", {}, "Thanks. Your laptop will plan next week."));
	};
	box.append(feelings);
	return box;
}

function blockRow(b) {
	const row = h("li", { class: `block ${b.status}` },
		h("span", {}, `${new Date(`${b.date}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric" })} ${b.start} · ${b.minutes} min`),
		h("span", { class: "muted small" }, b.focus ? `${b.focus.module}: ${b.focus.title}` : "Free study"),
	);
	if (b.status === "proposed") {
		row.append(h("span", { class: "row" },
			h("button", { class: "btn small", onclick: async () => { await event("plan_tick", null, { blockId: b.id }); row.classList.replace("proposed", "accepted"); row.lastChild.remove(); } }, "✓ Keep"),
			h("button", { class: "btn small ghost", onclick: async () => { await event("plan_remove", null, { blockId: b.id }); row.remove(); } }, "✕"),
		));
	}
	return row;
}

async function home() {
	const s = await schedule();
	if (s.unpaired) {
		await kv("pair", null);
		PAIR = null;
		return show(h("main", {}, h("h1", {}, "Not paired"), h("p", {}, "Pair again from your laptop: Me → Phone.")));
	}
	const answered = new Set(local.get("answered", []));
	const now = Date.now();
	const pending = (s.nudges || []).filter((n) => n.sentAt && Date.parse(n.expiresAt) > now && !answered.has(n.id));
	const question = pending.find((n) => n.kind === "N-1" || n.opens === "question");
	const checkin = pending.find((n) => n.kind === "N-5");
	const blocks = (s.blocks || []).filter((b) => b.status !== "removed");
	show(
		h("main", {},
			s.offline ? h("p", { class: "note" }, COPY.offline) : null,
			h("h1", {}, "LockedIn"),
			question ? h("section", { class: "card" }, h("p", { class: "eyebrow" }, question.title), h("p", {}, question.body), h("button", { class: "btn primary", onclick: () => questionScreen(question, s) }, "Next question")) : h("p", { class: "muted" }, nextQuestionText(s)),
			checkin ? checkinCard(checkin) : null,
			h("section", { class: "card" }, h("h2", {}, "This week"), blocks.length ? h("ul", { class: "blocks" }, blocks.map(blockRow)) : h("p", { class: "muted" }, "No study blocks yet. Plan your week on your laptop.")),
			h("details", { class: "card" },
				h("summary", {}, "Settings"),
				h("p", {}, local.get("pushOn", false) ? "Notifications are on." : h("button", { class: "btn", onclick: async () => { try { await enablePush(); local.set("pushOn", true); render(); } catch (e) { alert(e.message); } } }, "Turn on notifications")),
				h("p", { class: "small" }, h("b", {}, "What the relay holds: "), COPY.holds),
				h("button", { class: "btn ghost", onclick: async () => {
					if (!confirm("Unpair this phone? Questions stop coming here.")) return;
					try { await api("", { method: "DELETE" }); } catch {}
					await kv("pair", null);
					local.set("queue", []);
					PAIR = null;
					render();
				} }, "Unpair this phone"),
			),
		),
	);
}

// ─── start ──────────────────────────────────────────────────────────────────
async function render() {
	const m = /^#([0-9a-f]{32})\.([0-9a-f]{32})$/.exec(location.hash);
	if (m) {
		PAIR = { pairId: m[1], token: m[2] };
		await kv("pair", PAIR);
		history.replaceState(null, "", "/p"); // the token never stays in the address bar
		// An installed iPhone app opens at its pairing address every time: once notifications are on, that is just the app opening.
		const ready = local.get("pushOn", false) && typeof Notification !== "undefined" && Notification.permission === "granted";
		if (!ready) return pairScreen();
	}
	PAIR = PAIR || (await kv("pair"));
	if (!PAIR) return show(h("main", {}, h("h1", {}, "LockedIn"), h("p", {}, "Open the link or QR code from your laptop: LockedIn → Me → Phone.")));
	void flush();
	const id = new URLSearchParams(location.search).get("n");
	if (id) {
		history.replaceState(null, "", "/p");
		const s = await schedule(false);
		const n = (s.nudges || []).find((x) => x.id === id) || ((await schedule()).nudges || []).find((x) => x.id === id);
		if (n) return n.kind === "N-5" ? home() : questionScreen(n, s);
	}
	return home();
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
render();
