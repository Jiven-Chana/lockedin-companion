/**
 * The phone web app's first open (v1.0 P-1, V-29), run as the plain script
 * it is, in a simulated phone: an iPhone in the browser gets the guided
 * install and a manifest that carries the pairing; the installed app says
 * so and asks for notifications; once set up it just opens; other phones
 * skip the install step. The sample question sends nothing.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import vm from "node:vm";
import { parseHTML } from "linkedom";
import { handle, type RelayEnv } from "../relay/src/relay.ts";

const WEB = path.join(import.meta.dirname, "..", "relay", "web");
const PAIR = `${"a".repeat(32)}.${"b".repeat(32)}`;
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36";

interface Phone {
	ua: string;
	/** Opened from the Home Screen. */
	standalone?: boolean;
	/** The address's "#pairId.token" (the laptop's QR code). */
	hash?: string;
	/** The address's path, when it isn't /p (the install page is /p/i/pairId.token). */
	pathname?: string;
	/** The address's "?pair=pairId.token" (how an installed iPhone app opens). */
	search?: string;
	/** Notifications already turned on in this app. */
	pushOn?: boolean;
	permission?: "default" | "granted" | "denied";
}

async function open(opts: Phone) {
	const { document, Event: DomEvent } = parseHTML(fs.readFileSync(path.join(WEB, "index.html"), "utf-8"));
	const local = new Map<string, string>(opts.pushOn ? [["pushOn", "true"]] : []);
	const kv = new Map<string, string>();
	const requests: { method: string; url: string; body: unknown }[] = [];
	const location = { hash: opts.hash ?? "", search: opts.search ?? "", pathname: opts.pathname ?? "/p", replacedWith: null as string | null, replace(url: string) { this.replacedWith = url; } };
	const context = vm.createContext({
		document,
		location,
		history: { replaceState: (_s: unknown, _t: string, url: string) => { location.hash = ""; location.search = ""; location.pathname = url; } },
		window: { matchMedia: () => ({ matches: !!opts.standalone }), addEventListener: () => {} },
		navigator: { userAgent: opts.ua, standalone: !!opts.standalone },
		localStorage: { getItem: (k: string) => local.get(k) ?? null, setItem: (k: string, v: string) => void local.set(k, v) },
		caches: {
			open: async () => ({
				match: async (k: string) => (kv.has(k) ? new Response(kv.get(k)!) : undefined),
				put: async (k: string, r: Response) => void kv.set(k, await r.text()),
				delete: async (k: string) => kv.delete(k),
			}),
		},
		fetch: async (url: string, init: { method?: string; body?: string } = {}) => {
			requests.push({ method: init.method ?? "GET", url, body: init.body ? JSON.parse(init.body) : null });
			return new Response(JSON.stringify(url.endsWith("/schedule") ? { nudges: [], blocks: [] } : {}), { status: 200 });
		},
		Notification: { permission: opts.permission ?? "default", requestPermission: async () => opts.permission ?? "default" },
		crypto, Response, URLSearchParams, Date, JSON, console, setTimeout, atob,
	});
	vm.runInContext(fs.readFileSync(path.join(WEB, "app.js"), "utf-8"), context);
	await new Promise((r) => setTimeout(r, 30));
	const app = document.getElementById("app")!;
	return {
		app,
		text: () => app.textContent ?? "",
		manifest: () => document.querySelector('link[rel="manifest"]')!.getAttribute("href"),
		buttons: () => [...app.querySelectorAll("button")].map((b) => b.textContent),
		requests,
		location,
		kv,
		type: (selector: string, value: string) => {
			(app.querySelector(selector) as unknown as { value: string }).value = value;
		},
		tap: async (selector: string, nth = 0) => {
			app.querySelectorAll(selector)[nth]!.dispatchEvent(new DomEvent("click"));
			await new Promise((r) => setTimeout(r, 30));
		},
	};
}

const INSTALL_PAGE = `/p/i/${PAIR}`;

describe("an iPhone opening the pairing link in the browser", () => {
	it("is sent to the install page, whose own address and manifest carry the pairing", async () => {
		// Jiven's iPhone, 24 Nov: pointing the manifest at the pair after the page had loaded was ignored, and the
		// Home Screen app opened unpaired. The page that gets added must be served already knowing the pair.
		const p = await open({ ua: IPHONE, hash: `#${PAIR}` });
		assert.equal(p.location.replacedWith, INSTALL_PAGE);
	});

	it("on the install page, gets the three steps with pictures, and no dead end", async () => {
		const p = await open({ ua: IPHONE, pathname: INSTALL_PAGE });
		assert.match(p.text(), /Add LockedIn to your Home Screen/);
		const steps = [...p.app.querySelectorAll(".step")];
		assert.deepEqual(steps.map((s) => s.querySelector("b")!.textContent), ["Tap the Share button", "Scroll down and tap “Add to Home Screen”", "Tap Add, then open LockedIn from your Home Screen"]);
		assert.equal(steps.filter((s) => s.querySelector("svg, img")).length, 3, "each step has its picture");
		assert.match(steps[0]!.textContent ?? "", /at the bottom of Safari/);
	});

	it("keeps the pairing in the address while it waits to be added, in case the phone saves the address instead of the manifest's", async () => {
		const p = await open({ ua: IPHONE, pathname: INSTALL_PAGE });
		assert.equal(p.location.pathname, INSTALL_PAGE);
		assert.equal(p.location.replacedWith, null, "no second redirect");
		assert.equal(p.manifest(), `/v1/manifest?pair=${PAIR}`);
	});

	it("tells the relay it arrived, so the laptop stops waiting", async () => {
		const p = await open({ ua: IPHONE, pathname: INSTALL_PAGE });
		assert.deepEqual(p.requests.map((r) => [r.method, r.url]), [["GET", `/v1/pairs/${"a".repeat(32)}/schedule`]]);
	});

	it("has a sample question to try, and answering it sends nothing", async () => {
		const p = await open({ ua: IPHONE, pathname: INSTALL_PAGE });
		assert.equal(p.app.querySelectorAll(".option").length, 3);
		const before = p.requests.length;
		await p.tap(".option");
		assert.match(p.text(), /✓ Right\./);
		assert.match(p.text(), /Nothing you tap here is sent to your laptop/);
		assert.equal(p.requests.length, before, "no event reaches the relay");
	});

	it("in another browser, says where its Share button is", async () => {
		const p = await open({ ua: IPHONE_CHROME, pathname: INSTALL_PAGE });
		assert.match(p.text(), /next to the address at the top/);
	});
});

describe("the installed iPhone app", () => {
	// Three ways the pairing can reach it: the manifest's start address (?pair=), the install page's own address, an older icon's #.
	const arrivals: Array<[string, Partial<Phone>]> = [
		["the manifest's start address", { search: `?pair=${PAIR}` }],
		["the install page's own address", { pathname: INSTALL_PAGE }],
		["an address with the pairing after #", { hash: `#${PAIR}` }],
	];
	for (const [name, address] of arrivals) {
		it(`opened for the first time from ${name}: says it worked and asks for notifications`, async () => {
			const p = await open({ ua: IPHONE, standalone: true, ...address });
			assert.match(p.text(), /✓ Installed/);
			assert.match(p.text(), /Now tap Allow notifications\./);
			assert.deepEqual(p.buttons(), ["Allow notifications"]);
			assert.ok(p.kv.has("/kv/pair"), "the pairing came with the app's own address");
			assert.deepEqual([p.location.pathname, p.location.search, p.location.hash], ["/p", "", ""], "and it is taken out of the address");
		});
	}

	it("once notifications are on, opening it is just the app, not the pairing screen again", async () => {
		const p = await open({ ua: IPHONE, standalone: true, search: `?pair=${PAIR}`, pushOn: true, permission: "granted" });
		assert.doesNotMatch(p.text(), /Installed|Allow notifications/);
		assert.match(p.text(), /This week/);
	});

	it("with no pairing at all it is not a dead end: the pairing link can be pasted in", async () => {
		const p = await open({ ua: IPHONE, standalone: true });
		assert.match(p.text(), /isn't paired with your laptop yet/);
		assert.match(p.text(), /Copy link/);
		p.type("input", "nonsense");
		await p.tap("button");
		assert.match(p.text(), /That isn't a LockedIn pairing link/);
		p.type("input", `  https://lockedin-relay.example.workers.dev/p#${PAIR} `);
		await p.tap("button");
		assert.match(p.text(), /✓ Installed/);
		assert.deepEqual(p.buttons(), ["Allow notifications"]);
		assert.equal(JSON.parse(p.kv.get("/kv/pair")!).token, "b".repeat(32));
	});

	it("in a browser with no pairing, it only says where to get one", async () => {
		const p = await open({ ua: ANDROID });
		assert.match(p.text(), /Open the link or QR code from your laptop/);
		assert.equal(p.app.querySelector("input"), null);
	});
});

describe("Android and desktop browsers", () => {
	it("skip the install step and go straight to notifications", async () => {
		const p = await open({ ua: ANDROID, hash: `#${PAIR}` });
		assert.doesNotMatch(p.text(), /Home Screen/);
		assert.deepEqual(p.buttons(), ["Allow notifications"]);
		assert.equal(p.manifest(), "/manifest.webmanifest", "the plain manifest: Android shares storage with the installed app");
	});
});

describe("the relay's manifest for one pair", () => {
	const assets = { fetch: async (req: Request) => (new URL(req.url).pathname === "/manifest.webmanifest" ? new Response(fs.readFileSync(path.join(WEB, "manifest.webmanifest"), "utf-8")) : new Response("", { status: 404 })) };
	const env = { DB: null as never, ASSETS: assets } as RelayEnv;
	const get = (query: string) => handle(new Request(`https://relay.test/v1/manifest${query}`), env);

	it("is the plain manifest with the pair in its start address", async () => {
		const res = await get(`?pair=${PAIR}`);
		assert.equal(res.status, 200);
		assert.equal(res.headers.get("content-type"), "application/manifest+json");
		assert.equal(res.headers.get("cache-control"), "no-store");
		const plain = JSON.parse(fs.readFileSync(path.join(WEB, "manifest.webmanifest"), "utf-8"));
		assert.deepEqual(await res.json(), { ...plain, start_url: `/p?pair=${PAIR}` }, "a query, not a #: start addresses with a query are the well-trodden path");
		assert.equal(plain.display, "standalone", "iPhones need a standalone manifest for notifications");
	});

	it("the install page is the phone app, served already pointing at this pair's manifest", async () => {
		const page = { fetch: async (req: Request) => (new URL(req.url).pathname === "/" ? new Response(fs.readFileSync(path.join(WEB, "index.html"), "utf-8")) : assets.fetch(req)) };
		const res = await handle(new Request(`https://relay.test${INSTALL_PAGE}`), { DB: null as never, ASSETS: page } as RelayEnv);
		assert.equal(res.status, 200);
		assert.match(res.headers.get("content-type") ?? "", /^text\/html/);
		assert.equal(res.headers.get("cache-control"), "no-store");
		const html = await res.text();
		assert.ok(html.includes(`<link rel="manifest" href="/v1/manifest?pair=${PAIR}" />`));
		assert.ok(!html.includes('href="/manifest.webmanifest"'), "no trace of the plain manifest");
		assert.ok(html.includes('src="/app.js"'), "the same app");
		// Not a pair: the page isn't made up.
		const bad = await handle(new Request("https://relay.test/p/i/<script>"), { DB: null as never, ASSETS: page } as RelayEnv);
		assert.equal(bad.status, 404);
	});

	it("refuses anything that isn't a pair", async () => {
		for (const bad of ["", "?pair=abc", `?pair=${PAIR}x`, `?pair=${PAIR.replace(".", "/")}`, "?pair=javascript:alert(1)"]) assert.equal((await get(bad)).status, 400, bad);
	});
});
