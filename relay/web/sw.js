/* LockedIn phone app service worker (v0.1 F-112).
 * - Caches the app shell so it opens instantly and offline.
 * - On a push (payload-less, VAPID): fetches the pair's schedule, caches it,
 *   and shows every nudge the relay has sent that this phone hasn't shown.
 *   The question is cached before the tap, so opening it needs no network (V-11).
 * - On a tap: opens the app on that nudge.
 */

const SHELL = "lockedin-shell-v1";
const DATA = "lockedin-data-v1";
const FILES = ["/p", "/app.js", "/styles.css", "/manifest.webmanifest", "/icon.svg", "/icon-192.png"];

self.addEventListener("install", (e) => {
	e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
	e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== SHELL && k !== DATA).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
	const url = new URL(e.request.url);
	// The install page (/p/i/<pair>) goes straight to the network: it is made per pair, and its address holds the pairing.
	if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/v1/") || url.pathname.startsWith("/p/i/")) return;
	// App shell: network first (so updates land), cache when offline.
	e.respondWith(
		fetch(e.request)
			.then((res) => {
				const copy = res.clone();
				caches.open(SHELL).then((c) => c.put(url.pathname === "/" ? "/p" : e.request, copy));
				return res;
			})
			.catch(() => caches.match(url.pathname === "/" ? "/p" : e.request).then((r) => r || caches.match("/p"))),
	);
});

async function kv(key, value) {
	const c = await caches.open(DATA);
	if (value === undefined) {
		const r = await c.match(`/kv/${key}`);
		return r ? r.json() : null;
	}
	await c.put(`/kv/${key}`, new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } }));
}

self.addEventListener("push", (e) => {
	e.waitUntil(
		(async () => {
			const pair = await kv("pair");
			let shown = (await kv("shown")) || [];
			let schedule = null;
			if (pair) {
				try {
					const res = await fetch(`/v1/pairs/${pair.pairId}/schedule`, { headers: { authorization: `Bearer ${pair.token}` } });
					if (res.ok) {
						schedule = await res.json();
						await kv("schedule", schedule);
					}
				} catch {
					schedule = await kv("schedule");
				}
			}
			const now = Date.now();
			const due = (schedule?.nudges || []).filter((n) => n.sentAt && Date.parse(n.expiresAt) > now && !shown.includes(n.id));
			// A push must always show something (iOS and Chrome require it).
			if (!due.length) return self.registration.showNotification("LockedIn", { body: "Something's ready for you.", tag: "lockedin", data: {} });
			for (const n of due) {
				await self.registration.showNotification(n.title || "LockedIn", { body: n.body, tag: n.id, data: { id: n.id }, icon: "/icon-192.png", badge: "/icon-192.png" });
				shown.push(n.id);
			}
			await kv("shown", shown.slice(-200));
		})(),
	);
});

self.addEventListener("notificationclick", (e) => {
	e.notification.close();
	const id = e.notification.data?.id;
	const target = id ? `/p?n=${encodeURIComponent(id)}` : "/p";
	e.waitUntil(
		(async () => {
			const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
			for (const w of wins) {
				if ("focus" in w) {
					await w.navigate(target).catch(() => undefined);
					return w.focus();
				}
			}
			return self.clients.openWindow(target);
		})(),
	);
});
