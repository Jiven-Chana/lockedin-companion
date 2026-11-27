/* LockedIn phone app (v0.1 F-112, J2′, J9). Plain JS, no build.
 * Screens: pair · question → result → hand-off, keep going here or save (v2.1) · this week (+ Sunday check-in) · settings-lite.
 * The phone's question starts a Practise round that can carry on here (V-46). Learn stays on the laptop (R-8).
 * Wording: spec Appendix A.
 */

const COPY = {
	app: "LockedIn",
	// After a lecture (v2.1): the lo-fi's wording (prototype/lofi, task 1).
	questionOf: (i, n) => `Question ${i} of ${n}`,
	why: (w) => `Why now: ${w}`,
	right: "✓ Right.",
	wrong: (opt) => `Not quite: ${opt}.`,
	slide: (unit, n) => (unit ? `${unit} · slide ${n}` : `Slide ${n}`),
	more: (n) => `${n} more on your laptop`,
	keepGoing: "Keep going here",
	done: "Done for now",
	finished: "Done",
	doneOf: (d, n) => `${d} of ${n} done`,
	upToYou: (d, n) => `${d} of ${n} done. Up to you.`,
	another: "Another one",
	saveRest: "Save the rest for later",
	thatsAll: (n) => `That's all ${n}`,
	saved: "Saved.",
	savedLine: (k) => (k === 1 ? "The other question waits for your next free gap. Nothing is overdue." : `The other ${k} questions wait for your next free gap. Nothing is overdue.`),
	savedCard: (k) => (k === 1 ? "1 question saved" : `${k} questions saved`),
	carryOn: "Carry on",
	// The study block (v2.1 part B): the lo-fi's wording (task 2, without focus). The goal and the steps come from the laptop.
	block: {
		title: "Study block",
		goal: "Goal:",
		firstStep: "First step:",
		take: "Take the first step",
		notNow: "Not now",
		left: (m) => `${m} min left`,
		phoneDown: "Put your phone face down.",
		openLaptop: "Open on my laptop",
		end: "End block",
		ended: "Block ended.",
		endedLine: "Nothing is lost: the session waits on your laptop.",
		when: "When suits you better?",
		whenLine: "The rest of the block moves there. Nothing is marked missed.",
		pickForMe: "Pick for me: next free gap",
		moved: (to) => `Moved to ${to}.`,
		movedLine: "LockedIn will notify you then, and not before.",
		noGap: "No free gap is left this week.",
		nudgeTitle: (day, start) => `${day} ${start} · your study block`,
	},
	// Your week and Settings (v2.1 part C): the lo-fi's wording (task 3), with "notification" for "nudge" (v2.2, LF-11).
	week: {
		title: "Your week",
		count: (n) => (n === 0 ? "No study blocks this week. That's fine too." : n === 1 ? "One suggested block in your free gaps. Tap one to move or remove it." : `${n} suggested blocks in your free gaps. Tap one to move or remove it.`),
		moved: "moved",
		move: "Move",
		remove: "Remove",
		moveTo: "Move to a free gap:",
		cancel: "Cancel",
		removed: (day) => `Removed ${day} block ·`,
		undo: "Undo",
		add: "Add a block",
		looksGood: "Looks good",
		set: "Your week is set.",
		setCount: (n) => (n === 0 ? "No study blocks this week." : n === 1 ? "One study block." : `${n} study blocks.`),
		willNudge: "LockedIn will notify you when each one starts.",
		nudgesOff: "Notifications are off, so LockedIn won't buzz. Your blocks are still here.",
		changeAnyTime: "You can change them any time.",
	},
	settings: {
		title: "Settings",
		nudges: "Notifications per day",
		nudgeLine: ["LockedIn won't buzz. Your blocks stay in your week.", "One a day, and it's the first question.", "Up to two a day. Never repeated."],
		uses: "What LockedIn uses",
		usesLines: ["Timetable: yes", "Lecture slides: yes", "Location: never."],
		done: "Done",
	},
	onLaptop: "It's waiting on your laptop.",
	onLaptopNote: "Open LockedIn on your laptop: your answers are already there.",
	holds: "Lecture names and times, your phone's questions and answers, your study block times. Never your location, slides, notes or AI key.",
	offline: "Can't reach LockedIn right now. Your answers are saved and will be sent when you're back online.",
	// Pairing an iPhone (v1.0.3): add LockedIn to the Home Screen, then type the code the laptop shows.
	install: {
		title: "Add LockedIn to your Home Screen",
		why: "iPhones only allow notifications from apps on the Home Screen. It takes three taps.",
		share: "Tap the Share button",
		shareWhere: "the square with an arrow, at the bottom of Safari",
		shareWhereOther: "the square with an arrow, next to the address at the top",
		add: "Scroll down and tap “Add to Home Screen”",
		open: "Tap Add, then open LockedIn from your Home Screen",
		openNote: "It will ask for the 6-digit code on your laptop.",
		tryTitle: "Try a sample question while you're here",
		tryNote: "A sample. Nothing you tap here is sent to your laptop.",
		tried: "That's how a question looks. Yours arrive after your lectures.",
	},
	code: {
		title: "Enter the code on your laptop",
		label: "The 6-digit code",
		where: "It's on your laptop, under Me → Phone.",
		pair: "Pair",
		checking: "Checking…",
		wrong: "That code isn't right. Check your laptop and try again.",
		expired: "That code has run out. Your laptop is showing a new one.",
		wait: "Too many tries. Wait a minute, then try again.",
		offline: "Can't reach LockedIn. Check your connection and try again.",
	},
	paired: {
		title: "✓ Paired with your laptop",
		allow: "One last step: allow notifications, so your questions can reach you.",
		done: "You're all set.",
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

/** The sample question on the install screen, folded away under its title. It sends no events: the laptop replays those as real answers. */
function sampleQuestion() {
	const box = h("details", { class: "card" }, h("summary", {}, COPY.install.tryTitle), h("p", { class: "eyebrow" }, SAMPLE.title), h("h2", {}, SAMPLE.stem));
	const options = h("div", { class: "options", role: "group", "aria-label": "Answers" }, SAMPLE.options.map((o, i) => h("button", { class: "btn option", onclick: () => {
		const right = i === SAMPLE.correct;
		options.replaceWith(h("p", { class: right ? "result right" : "result" }, h("b", {}, right ? COPY.right : COPY.wrong(SAMPLE.options[SAMPLE.correct])), " ", SAMPLE.explanation), h("p", { class: "muted small" }, COPY.install.tried));
	} }, o)));
	box.append(options, h("p", { class: "muted small" }, COPY.install.tryNote));
	return box;
}

/** iPhone, in the browser: the three taps to the Home Screen, with pictures. Pairing happens in the installed app, with the code. */
function installGuide() {
	// Tells the relay this phone opened the link, so the laptop stops saying "Waiting for your phone…".
	if (PAIR) void schedule();
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

/**
 * No pairing on this phone: type the 6 digits the laptop shows (v1.0.3). This is how every
 * iPhone pairs (its Home Screen app can't see what Safari stored), and the way back in for any
 * phone whose pairing is gone.
 */
function codeScreen() {
	const msg = h("p", { class: "muted", role: "status" });
	const box = h("input", { class: "code", type: "text", inputmode: "numeric", autocomplete: "one-time-code", maxlength: "7", placeholder: "000 000", "aria-label": COPY.code.label });
	const digits = () => (box.value || "").replace(/\D/g, "").slice(0, 6);
	let busy = false;
	const claim = async () => {
		const code = digits();
		if (busy || code.length !== 6) return;
		busy = true;
		btn.disabled = true;
		msg.textContent = COPY.code.checking;
		try {
			const res = await fetch("/v1/claim", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
			if (res.ok) {
				const p = await res.json();
				PAIR = { pairId: p.pairId, token: p.token };
				await kv("pair", PAIR);
				return pairScreen(true);
			}
			msg.textContent = res.status === 410 ? COPY.code.expired : res.status === 429 ? COPY.code.wait : COPY.code.wrong;
		} catch {
			msg.textContent = COPY.code.offline;
		}
		busy = false;
		btn.disabled = false;
	};
	const btn = h("button", { class: "btn primary", disabled: true, onclick: claim }, COPY.code.pair);
	box.addEventListener("input", () => {
		const d = digits();
		box.value = d.length > 3 ? `${d.slice(0, 3)} ${d.slice(3)}` : d;
		btn.disabled = d.length !== 6;
		// The sixth digit is the tap: nothing else to press.
		if (d.length === 6) void claim();
	});
	show(h("main", {}, h("h1", {}, COPY.code.title), box, btn, msg, h("p", { class: "muted" }, COPY.code.where)));
}

/** Paired; notifications are the last step. `byCode`: this phone just typed the laptop's code. */
async function pairScreen(byCode = false) {
	const msg = h("p", { class: "muted", role: "status" });
	const btn = h("button", { class: "btn primary", onclick: async () => {
		btn.disabled = true;
		msg.textContent = "Setting up…";
		try {
			await enablePush();
			local.set("pushOn", true);
			const s = await schedule();
			show(h("main", {}, h("h1", {}, COPY.paired.done), h("p", {}, nextQuestionText(s)), h("button", { class: "btn", onclick: () => render() }, "OK")));
		} catch (e) {
			msg.textContent = e.message;
			btn.disabled = false;
		}
	} }, "Allow notifications");
	if (byCode) return show(h("main", {}, h("h1", {}, COPY.paired.title), h("p", {}, COPY.paired.allow), btn, msg));
	show(h("main", {}, h("h1", {}, "Get questions on your phone"), h("p", {}, "One question after a lecture, never more than you chose. Answering here is the first step; your laptop continues."), btn, msg));
}

// ─── the question (J2′) ─────────────────────────────────────────────────────
// ─── the question after a lecture, and its round on the phone (v2.1; lo-fi task 1, V-46) ──
/** A round is five questions at most (the lo-fi's "Question 1 of 5"; the laptop's PHONE_RULES.roundSize). */
const ROUND = 5;
const ref = (q) => ({ lectureId: q.lectureId, questionId: q.id });
const unitLabel = (q, n) => [q?.module || n?.module, q?.unit].filter(Boolean).join(" · ");
const bar = (title, sub) => h("header", { class: "bar" }, h("b", {}, title), " ", sub ? h("span", { class: "muted small" }, sub) : null);

/** The round a notification's question starts: its own question first, then what was saved on this phone, then the rest the laptop sent. */
function roundOf(n) {
	const saved = local.get("saved", null);
	const seen = new Set();
	const out = [];
	for (const q of [n.question, ...(saved?.questions || []), ...(n.round || [])]) {
		if (!q || seen.has(q.id) || out.length >= ROUND) continue;
		seen.add(q.id);
		out.push(q);
	}
	return out;
}

/** Questions no longer waiting on this phone: answered here, or taken over by the laptop. */
function unsave(ids, done) {
	const saved = local.get("saved", null);
	if (!saved) return;
	const questions = saved.questions.filter((q) => !ids.includes(q.id));
	local.set("saved", questions.length ? { ...saved, questions, ...(done !== undefined ? { done } : {}) } : null);
}

const resultBox = (q, choice) => {
	const right = choice === q.correct;
	return h("p", { class: right ? "result right" : "result" },
		h("b", {}, right ? COPY.right : COPY.wrong(q.options[q.correct])), " ", q.explanation,
		q.slides?.length ? h("span", { class: "src" }, COPY.slide(q.unit, q.slides[0])) : null,
	);
};

function questionScreen(n) {
	void event("opened", n.id, { kind: n.kind });
	if (!n.question) {
		// No question in this nudge (the v1 fallback): the laptop is where it continues.
		return show(h("main", {}, h("p", { class: "eyebrow" }, n.title), h("h1", {}, n.body), h("p", { class: "muted" }, n.why ? COPY.why(n.why) : ""), handoffOld(n, null)));
	}
	// A laptop from before v2.1 sends no round: one question here, the rest there, as it was.
	const old = !Array.isArray(n.round);
	const questions = old ? [n.question] : roundOf(n);
	ask({ nudge: n, old, questions, answers: [], total: old ? 1 + (n.more ?? 4) : questions.length, base: 0 }, true);
}

/** "Carry on" from the home card: the saved questions, counted against the round they came from. */
function carryOn() {
	const saved = local.get("saved", null);
	if (!saved?.questions?.length) return render();
	ask({ nudge: null, old: false, questions: saved.questions, answers: [], total: saved.total, base: saved.done }, false);
}

/** One question of a round. `first`: the question the notification carried ("Question 1 of 5"); after it the header counts what is done. */
function ask(r, first) {
	const q = r.questions[r.answers.length];
	const n = r.nudge;
	const done = () => r.base + r.answers.length;
	const left = () => r.questions.length - r.answers.length;
	const head = () => (first ? [bar(COPY.app, unitLabel(q, n)), h("p", { class: "muted small" }, COPY.questionOf(1, r.total))] : [bar(COPY.app, COPY.doneOf(done(), r.total)), h("p", { class: "eyebrow" }, unitLabel(q, n))]);

	const choose = (i) => {
		const answer = { questionId: q.id, lectureId: q.lectureId, choice: i, correct: i === q.correct };
		void event("answered", n?.id ?? null, answer);
		r.answers.push(answer);
		if (n) {
			const answered = local.get("answered", []);
			answered.push(n.id);
			local.set("answered", answered.slice(-200));
		}
		unsave([q.id], done());
		const next = () => ask(r, false);
		const ways = r.old
			? handoffOld(n, answer)
			: left() === 0
				? h("div", { class: "row" }, h("button", { class: "btn primary", onclick: () => { unsave(r.questions.map((x) => x.id)); render(); } }, first ? COPY.finished : COPY.thatsAll(r.total)))
				: first
					? h("div", { class: "row" },
							h("button", { class: "btn primary", onclick: () => handover(r) }, COPY.more(left())),
							h("button", { class: "btn", onclick: next }, COPY.keepGoing),
							h("button", { class: "btn", onclick: () => save(r) }, COPY.done),
						)
					: h("div", { class: "row" },
							h("button", { class: "btn primary", onclick: next }, COPY.another),
							h("button", { class: "btn", onclick: () => save(r) }, COPY.saveRest),
						);
		show(h("main", {}, ...head(), h("h1", {}, q.stem), resultBox(q, i), !first && !r.old && left() > 0 ? h("p", { class: "muted" }, COPY.upToYou(done(), r.total)) : null, ways));
	};

	show(
		h("main", {},
			...head(),
			h("h1", {}, q.stem),
			h("div", { class: "options", role: "group", "aria-label": "Answers" }, q.options.map((o, i) => h("button", { class: "btn option", onclick: () => choose(i) }, o))),
			first && n?.why ? h("p", { class: "muted small" }, COPY.why(n.why)) : null,
			first && n ? h("button", { class: "btn ghost", onclick: () => { void event("snoozed", n.id); render(); } }, "Later") : null,
		),
	);
}

/** "N more on your laptop": the laptop opens the same round, with every answer given here, at the next question. */
async function handover(r) {
	const first = r.answers[0];
	await event("handover", r.nudge?.id ?? null, {
		lectureId: r.nudge?.lectureId ?? r.questions[0].lectureId,
		round: r.questions.map(ref),
		answers: r.answers,
		// Where a laptop from before v2.1 looks for the first answer.
		...(first ? { questionId: first.questionId, choice: first.choice, correct: first.correct } : {}),
	});
	unsave(r.questions.map((q) => q.id));
	show(h("main", {}, h("h1", {}, COPY.onLaptop), " ", h("p", {}, COPY.onLaptopNote), h("button", { class: "btn", onclick: () => render() }, "OK")));
}

/** "Done for now" and "Save the rest for later": what is left waits, here and on the laptop. Nothing is overdue (R-6). */
async function save(r) {
	const rest = r.questions.slice(r.answers.length);
	local.set("saved", rest.length ? { total: r.total, done: r.base + r.answers.length, label: unitLabel(rest[0], r.nudge), questions: rest } : null);
	await event("done_for_now", r.nudge?.id ?? null, { saved: rest.map(ref) });
	show(h("main", {}, h("h1", {}, COPY.saved), " ", h("p", {}, COPY.savedLine(rest.length)), h("button", { class: "btn", onclick: () => render() }, "OK")));
}

/** The hand-off as it was before v2.1: one answer, and the laptop builds the rest. */
function handoffOld(n, answer) {
	const more = n.more ?? 4;
	return h("div", { class: "row" },
		h("button", { class: "btn primary", onclick: async () => {
			await event("handover", n.id, { ...(answer ? { questionId: answer.questionId, choice: answer.choice, correct: answer.correct } : {}), lectureId: n.lectureId });
			show(h("main", {}, h("h1", {}, COPY.onLaptop), " ", h("p", {}, COPY.onLaptopNote), h("button", { class: "btn", onclick: () => render() }, "OK")));
		} }, COPY.more(more)),
		h("button", { class: "btn", onclick: async () => { await event("done_for_now", n.id); render(); } }, COPY.done),
	);
}

// ─── the study block (v2.1 part B; lo-fi task 2, version B, without focus) ──
const hm = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const blockStart = (b) => new Date(`${b.date}T${b.start}:00`);
const shortDay = (date) => new Date(`${date}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short" });
const box = (...kids) => h("div", { class: "note" }, ...kids);
const line = (label, text) => h("p", {}, h("b", {}, label), " ", text);

/** The block's start: its goal and first step, then "Take the first step" or "Not now". */
function blockScreen(b) {
	const start = blockStart(b);
	show(
		h("main", {},
			bar(COPY.block.title, `${shortDay(b.date)} ${b.start}-${hm(new Date(start.getTime() + b.minutes * 60_000))}`),
			box(line(COPY.block.goal, b.goal), b.firstStep ? line(COPY.block.firstStep, b.firstStep) : null),
			h("div", { class: "row" },
				h("button", { class: "btn primary", onclick: () => { void event("focus_start", null, { blockId: b.id }); blockRunning(b); } }, COPY.block.take),
				h("button", { class: "btn", onclick: () => blockLater(b) }, COPY.block.notNow),
			),
		),
	);
}

/** The block running: how long is left, the step that happens on the laptop, and the phone put down. */
function blockRunning(b) {
	const end = blockStart(b).getTime() + b.minutes * 60_000;
	const left = Math.max(0, Math.min(b.minutes, Math.round((end - Date.now()) / 60_000)));
	show(
		h("main", {},
			bar(COPY.block.title),
			h("h1", {}, COPY.block.left(left)),
			b.onLaptop ? box(line(COPY.block.firstStep, b.onLaptop)) : null,
			h("p", { class: "muted" }, COPY.block.phoneDown),
			h("div", { class: "row" },
				h("button", { class: "btn primary", onclick: async () => {
					await event("handover", null, { blockId: b.id });
					show(h("main", {}, h("h1", {}, COPY.onLaptop), " ", h("button", { class: "btn", onclick: () => render() }, "OK")));
				} }, COPY.block.openLaptop),
				h("button", { class: "btn", onclick: async () => {
					await event("focus_end", null, { blockId: b.id });
					show(h("main", {}, bar(COPY.block.title, "ended"), box(h("b", {}, COPY.block.ended), " ", COPY.block.endedLine), h("button", { class: "btn", onclick: () => render() }, "OK")));
				} }, COPY.block.end),
			),
		),
	);
}

/** "Not now": the times the laptop found free. The relay moves the block's notification, laptop open or not. */
function blockLater(b) {
	const moves = b.moves || [];
	if (!moves.length) return show(h("main", {}, bar(COPY.block.title, "move it"), h("p", {}, COPY.block.noGap), h("button", { class: "btn", onclick: () => render() }, "OK")));
	const move = async (m) => {
		await event("plan_move", null, { blockId: b.id, date: m.date, start: m.start, fireAt: new Date(`${m.date}T${m.start}:00`).toISOString(), title: COPY.block.nudgeTitle(shortDay(m.date), m.start) });
		// The schedule this phone holds shows the move at once.
		const s = await kv("schedule");
		if (s?.blocks) await kv("schedule", { ...s, blocks: s.blocks.map((x) => (x.id === b.id ? { ...x, date: m.date, start: m.start, moved: true } : x)) });
		show(h("main", {}, bar(COPY.block.title, "moved"), box(h("b", {}, COPY.block.moved(m.label)), " ", COPY.block.movedLine), h("button", { class: "btn", onclick: () => render() }, "OK")));
	};
	show(
		h("main", {},
			bar(COPY.block.title, "move it"),
			h("h1", {}, COPY.block.when), " ",
			h("p", { class: "muted" }, COPY.block.whenLine),
			h("div", { class: "options" }, moves.map((m) => h("button", { class: m.kind === "next" ? "btn ghost" : "btn option", onclick: () => move(m) }, m.kind === "next" ? COPY.block.pickForMe : m.label))),
		),
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

// ─── your week and Settings (v2.1 part C; lo-fi task 3) ────────────────────
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const when = (x) => `${x.date} ${x.start}`;
const blockLabel = (b) => `Study ${b.start}${b.focus?.title ? ` · ${b.focus.title}` : ""}`;

/** The week: lectures as plain lines, blocks as buttons that open to "Move" and "Remove", then "Add a block", "Settings" and "Looks good". */
function weekSection(s) {
	const from = todayKey();
	const st = {
		blocks: (s.blocks || []).filter((b) => b.status !== "removed" && b.date >= from).map((b) => ({ ...b })),
		free: [...(s.week.free || [])],
		lectures: (s.week.lectures || []).filter((l) => l.date >= from),
		minutes: s.week.blockMinutes || 50,
		nudges: s.week.nudgesPerDay ?? 1,
		open: null, moving: false, undo: null,
	};
	const el = h("section", { class: "card" });
	const moment = (x) => new Date(`${x.date}T${x.start}:00`).toISOString();
	const title = (x) => COPY.block.nudgeTitle(shortDay(x.date), x.start);

	const move = async (b, f) => {
		await event("plan_move", null, { blockId: b.id, date: f.date, start: f.start, fireAt: moment(f), title: title(f) });
		st.free = st.free.filter((x) => when(x) !== when(f));
		Object.assign(b, { date: f.date, start: f.start, moved: true });
		Object.assign(st, { open: null, moving: false, undo: null });
		draw();
	};
	const remove = async (b) => {
		await event("plan_remove", null, { blockId: b.id });
		st.blocks = st.blocks.filter((x) => x.id !== b.id);
		Object.assign(st, { open: null, moving: false, undo: b });
		draw();
	};
	const undo = async () => {
		const b = st.undo;
		await event("plan_tick", null, { blockId: b.id, restore: true });
		st.blocks.push(b);
		st.undo = null;
		draw();
	};
	const add = async () => {
		const f = st.free[0];
		if (!f) return;
		const b = { id: `phone-${uuid().replace(/-/g, "").slice(0, 12)}`, date: f.date, start: f.start, minutes: st.minutes, status: "accepted", focus: null, moved: true };
		await event("plan_add", null, { blockId: b.id, date: b.date, start: b.start, minutes: b.minutes, fireAt: moment(b), title: title(b) });
		st.free = st.free.slice(1);
		st.blocks.push(b);
		Object.assign(st, { open: b.id, moving: false, undo: null });
		draw();
	};
	const looksGood = async () => {
		for (const b of st.blocks.filter((x) => x.status === "proposed")) {
			await event("plan_tick", null, { blockId: b.id });
			b.status = "accepted";
		}
		weekSet(st, s);
	};

	const row = (x) => {
		if (!x.id) return h("li", { class: "wk static" }, h("b", {}, shortDay(x.date)), " ", `${x.title} ${x.start}`);
		const isOpen = st.open === x.id;
		return h("li", { class: "wk" },
			h("button", { class: "btn wkrow", "aria-expanded": isOpen ? "true" : "false", onclick: () => { Object.assign(st, { open: isOpen ? null : x.id, moving: false }); draw(); } },
				h("b", {}, shortDay(x.date)), " ", blockLabel(x), x.moved ? " " : null, x.moved ? h("span", { class: "tag" }, COPY.week.moved) : null),
			x.why ? h("p", { class: "muted small" }, x.why) : null,
			isOpen && !st.moving ? h("div", { class: "row" }, h("button", { class: "btn small", onclick: () => { st.moving = true; draw(); } }, COPY.week.move), h("button", { class: "btn small", onclick: () => remove(x) }, COPY.week.remove)) : null,
			isOpen && st.moving ? h("div", { class: "stack" }, h("p", { class: "muted small" }, COPY.week.moveTo), h("div", { class: "row" },
				st.free.map((f) => h("button", { class: "btn small chip", onclick: () => move(x, f) }, `${shortDay(f.date)} ${f.start}`)),
				h("button", { class: "btn small chip dashed", onclick: () => { st.moving = false; draw(); } }, COPY.week.cancel))) : null,
		);
	};
	const draw = () => {
		const rows = [...st.lectures, ...st.blocks].sort((a, b) => when(a).localeCompare(when(b)));
		// replaceChildren writes "null" for a missing child, so the missing ones are taken out first.
		el.replaceChildren(...[
			h("h2", {}, COPY.week.title), " ",
			h("p", { class: "muted small" }, COPY.week.count(st.blocks.length)),
			rows.length ? h("ul", { class: "week" }, rows.map(row)) : null,
			st.undo ? h("p", { class: "muted small" }, COPY.week.removed(shortDay(st.undo.date)), " ", h("button", { class: "btn small", onclick: undo }, COPY.week.undo)) : null,
			h("div", { class: "row" },
				h("button", { class: "btn", onclick: add, disabled: st.free.length === 0 }, COPY.week.add),
				h("button", { class: "btn", onclick: () => settingsScreen(st, () => render()) }, COPY.settings.title),
				h("button", { class: "btn primary", onclick: looksGood }, COPY.week.looksGood),
			),
		].filter((x) => x != null));
	};
	draw();
	return el;
}

/** "Looks good": the week is set (lo-fi "tdone"). */
function weekSet(st, s) {
	const n = st.blocks.length;
	const rows = [...st.blocks].sort((a, b) => when(a).localeCompare(when(b)));
	show(
		h("main", {},
			bar(COPY.week.title, "set"),
			box(h("b", {}, COPY.week.set), " ", COPY.week.setCount(n)),
			rows.length ? h("ul", { class: "week" }, rows.map((b) => h("li", { class: "wk static" }, h("b", {}, shortDay(b.date)), " ", blockLabel(b).replace(/^Study /, "")))) : null,
			h("p", { class: "muted" }, st.nudges > 0 ? COPY.week.willNudge : COPY.week.nudgesOff, " ", COPY.week.changeAnyTime),
			h("div", { class: "row" },
				h("button", { class: "btn", onclick: () => settingsScreen(st, () => weekSet(st, s)) }, COPY.settings.title),
				h("button", { class: "btn primary", onclick: () => render() }, "OK"),
			),
		),
	);
}

/** Settings (lo-fi "set"): nudges per day, what LockedIn uses, and this phone's own switches. */
function settingsScreen(st, back) {
	const set = async (n) => {
		st.nudges = n;
		await event("prefs", null, { nudgesPerDay: n });
		settingsScreen(st, back);
	};
	show(
		h("main", {},
			bar(COPY.settings.title),
			h("b", {}, COPY.settings.nudges),
			h("div", { class: "seg", role: "group", "aria-label": COPY.settings.nudges }, [0, 1, 2].map((n) => h("button", { class: "btn small", "aria-pressed": st.nudges === n ? "true" : "false", onclick: () => set(n) }, String(n)))),
			h("p", { class: "muted small" }, COPY.settings.nudgeLine[st.nudges]),
			box(h("b", {}, COPY.settings.uses), " ", COPY.settings.usesLines.flatMap((l) => [h("span", { class: "line" }, l), " "])),
			thisPhone(),
			h("button", { class: "btn primary", onclick: back }, COPY.settings.done),
		),
	);
}

/** This phone's own switches: notifications, what the relay holds, unpair. */
function thisPhone() {
	return [
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
	];
}

/** The week as it was shown before v2.1: a list with Keep and ✕, and Settings folded away. */
function oldWeek(blocks) {
	return [
		h("section", { class: "card" }, h("h2", {}, "This week"), blocks.length ? h("ul", { class: "blocks" }, blocks.map(blockRow)) : h("p", { class: "muted" }, "No study blocks yet. Plan your week on your laptop.")),
		h("details", { class: "card" }, h("summary", {}, "Settings"), thisPhone()),
	];
}

async function home() {
	const s = await schedule();
	if (s.unpaired) {
		await kv("pair", null);
		PAIR = null;
		return isIos && !standalone ? installGuide() : codeScreen();
	}
	const answered = new Set(local.get("answered", []));
	const now = Date.now();
	const pending = (s.nudges || []).filter((n) => n.sentAt && Date.parse(n.expiresAt) > now && !answered.has(n.id));
	const question = pending.find((n) => n.kind === "N-1" || n.opens === "question");
	const checkin = pending.find((n) => n.kind === "N-5");
	const blocks = (s.blocks || []).filter((b) => b.status !== "removed");
	const saved = local.get("saved", null);
	show(
		h("main", {},
			s.offline ? h("p", { class: "note" }, COPY.offline) : null,
			h("h1", {}, "LockedIn"),
			question ? h("section", { class: "card" }, h("p", { class: "eyebrow" }, question.title), h("p", {}, question.body), h("button", { class: "btn primary", onclick: () => questionScreen(question) }, "Next question")) : h("p", { class: "muted" }, nextQuestionText(s)),
			// What "Done for now" left (v2.1): one card, no extra notification. It also follows the next notification's own question.
			saved?.questions?.length ? h("section", { class: "card" }, h("p", { class: "eyebrow" }, saved.label), h("p", {}, COPY.savedCard(saved.questions.length)), h("button", { class: "btn primary", onclick: () => carryOn() }, COPY.carryOn)) : null,
			checkin ? checkinCard(checkin) : null,
			// Your week (v2.1 part C). A laptop or relay from before v2.1 sends no week: the blocks are listed as they were.
			...(s.week ? [weekSection(s)] : oldWeek(blocks)),
		),
	);
}

// ─── start ──────────────────────────────────────────────────────────────────
async function render() {
	const m = /^#([0-9a-f]{32})\.([0-9a-f]{32})$/.exec(location.hash);
	if (m) {
		const scanned = { pairId: m[1], token: m[2] };
		history.replaceState(null, "", "/p"); // the token never stays in the address bar
		// An iPhone in the browser can't be the paired phone: its Home Screen app has storage of its own and pairs
		// there, with the code. The scanned link only tells the laptop that this phone has arrived.
		if (isIos && !standalone) {
			PAIR = scanned;
			return installGuide();
		}
		PAIR = scanned;
		await kv("pair", PAIR);
		const ready = local.get("pushOn", false) && typeof Notification !== "undefined" && Notification.permission === "granted";
		if (!ready) return pairScreen();
	}
	PAIR = PAIR || (await kv("pair"));
	if (!PAIR) return isIos && !standalone ? installGuide() : codeScreen();
	void flush();
	const id = new URLSearchParams(location.search).get("n");
	if (id) {
		history.replaceState(null, "", "/p");
		const s = await schedule(false);
		const n = (s.nudges || []).find((x) => x.id === id) || ((await schedule()).nudges || []).find((x) => x.id === id);
		if (n) {
			// A block's notification opens the block (v2.1), when the laptop sent what the block screen shows.
			const fresh = n.blockId ? await schedule() : null;
			const b = n.blockId ? (fresh?.blocks || []).find((x) => x.id === n.blockId) : null;
			if (b?.goal) return blockScreen(b);
			return n.kind === "N-5" ? home() : questionScreen(n);
		}
	}
	return home();
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
render();
