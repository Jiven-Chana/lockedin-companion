/**
 * The phone web app's pairing (v1.0.3), run as the plain script it is, in a
 * simulated phone. An iPhone pairs in its Home Screen app by typing the 6
 * digits the laptop shows: the browser only shows how to install it.
 * Android and desktop browsers pair from the scanned link, as before, and
 * any phone with no pairing gets the same code screen.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import vm from "node:vm";
import { parseHTML } from "linkedom";

const WEB = path.join(import.meta.dirname, "..", "relay", "web");
const PAIR = `${"a".repeat(32)}.${"b".repeat(32)}`;
const CODE = "482915";
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
	/** How the relay answers a typed code (default: 200 for CODE, 404 otherwise). */
	claim?: (code: string) => number;
	offline?: boolean;
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
			const body = init.body ? JSON.parse(init.body) : null;
			requests.push({ method: init.method ?? "GET", url, body });
			if (url === "/v1/claim") {
				if (opts.offline) throw new TypeError("Load failed");
				const answer = (opts.claim ?? ((code: string) => (code === CODE ? 200 : 404)))(body.code);
				return new Response(JSON.stringify(answer === 200 ? { pairId: "c".repeat(32), token: "d".repeat(32) } : { error: "no" }), { status: answer });
			}
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
		/** Type into a box, as the keypad does: the value, then an input event. */
		type: async (selector: string, value: string) => {
			const box = app.querySelector(selector)!;
			(box as unknown as { value: string }).value = value;
			box.dispatchEvent(new DomEvent("input"));
			await new Promise((r) => setTimeout(r, 30));
		},
		value: (selector: string) => (app.querySelector(selector) as unknown as { value: string }).value,
		tap: async (selector: string, nth = 0) => {
			app.querySelectorAll(selector)[nth]!.dispatchEvent(new DomEvent("click"));
			await new Promise((r) => setTimeout(r, 30));
		},
	};
}

describe("an iPhone opening the laptop's link in the browser", () => {
	it("gets the three steps with pictures, and is told the app will ask for the code", async () => {
		const p = await open({ ua: IPHONE, hash: `#${PAIR}` });
		assert.match(p.text(), /Add LockedIn to your Home Screen/);
		const steps = [...p.app.querySelectorAll(".step")];
		assert.deepEqual(steps.map((s) => s.querySelector("b")!.textContent), ["Tap the Share button", "Scroll down and tap “Add to Home Screen”", "Tap Add, then open LockedIn from your Home Screen"]);
		assert.equal(steps.filter((s) => s.querySelector("svg, img")).length, 3, "each step has its picture");
		assert.match(steps[0]!.textContent ?? "", /at the bottom of Safari/);
		assert.match(steps[2]!.textContent ?? "", /It will ask for the 6-digit code on your laptop/);
	});

	it("does not keep the pairing in the browser, where the Home Screen app could never see it", async () => {
		const p = await open({ ua: IPHONE, hash: `#${PAIR}` });
		assert.equal(p.kv.has("/kv/pair"), false);
		assert.equal(p.location.hash, "", "and the token doesn't stay in the address bar");
		assert.equal(p.manifest(), "/manifest.webmanifest", "one manifest for everyone");
	});

	it("tells the relay it arrived, so the laptop stops waiting", async () => {
		const p = await open({ ua: IPHONE, hash: `#${PAIR}` });
		assert.deepEqual(p.requests.map((r) => [r.method, r.url]), [["GET", `/v1/pairs/${"a".repeat(32)}/schedule`]]);
	});

	it("the sample question is folded away, and answering it sends nothing", async () => {
		const p = await open({ ua: IPHONE, hash: `#${PAIR}` });
		assert.equal(p.app.querySelectorAll("details .option").length, 3, "inside the fold, so the steps are the page");
		const before = p.requests.length;
		await p.tap(".option");
		assert.match(p.text(), /✓ Right\./);
		assert.equal(p.requests.length, before, "no event reaches the relay");
	});

	it("opened with no link at all (the address typed by hand), still shows how to install", async () => {
		const p = await open({ ua: IPHONE });
		assert.match(p.text(), /Add LockedIn to your Home Screen/);
		assert.deepEqual(p.requests, [], "nothing to tell the relay about");
	});

	it("in another browser, says where its Share button is", async () => {
		const p = await open({ ua: IPHONE_CHROME, hash: `#${PAIR}` });
		assert.match(p.text(), /next to the address at the top/);
	});
});

describe("the iPhone app on the Home Screen", () => {
	it("asks for the code on the laptop, and nothing else", async () => {
		const p = await open({ ua: IPHONE, standalone: true });
		assert.match(p.text(), /Enter the code on your laptop/);
		assert.match(p.text(), /It's on your laptop, under Me → Phone\./);
		assert.deepEqual(p.buttons(), ["Pair"]);
		assert.equal(p.app.querySelectorAll("input").length, 1);
		const box = p.app.querySelector("input")!;
		assert.deepEqual([box.getAttribute("inputmode"), box.getAttribute("autocomplete")], ["numeric", "one-time-code"], "the number keypad, and a code from Messages can fill it");
		assert.deepEqual(p.requests, []);
	});

	it("the sixth digit pairs it: no button to find", async () => {
		const p = await open({ ua: IPHONE, standalone: true });
		await p.type("input", "482");
		assert.equal(p.requests.length, 0, "nothing is sent for half a code");
		await p.type("input", "482915");
		assert.deepEqual(p.requests.map((r) => [r.method, r.url, r.body]), [["POST", "/v1/claim", { code: CODE }]]);
		assert.match(p.text(), /✓ Paired with your laptop/);
		assert.match(p.text(), /One last step: allow notifications/);
		assert.deepEqual(p.buttons(), ["Allow notifications"]);
		assert.deepEqual(JSON.parse(p.kv.get("/kv/pair")!), { pairId: "c".repeat(32), token: "d".repeat(32) });
	});

	it("the code reads back in two groups of three, like the laptop shows it, however it is typed", async () => {
		const p = await open({ ua: IPHONE, standalone: true, claim: () => 404 });
		await p.type("input", "4829");
		assert.equal(p.value("input"), "482 9");
		await p.type("input", "48 29-15 77");
		assert.equal(p.value("input"), "482 915");
	});

	const refusals: Array<[string, Partial<Phone>, RegExp]> = [
		["a wrong code", { claim: () => 404 }, /That code isn't right\. Check your laptop and try again\./],
		["a code that has run out", { claim: () => 410 }, /That code has run out\. Your laptop is showing a new one\./],
		["too many tries", { claim: () => 429 }, /Too many tries\. Wait a minute, then try again\./],
		["no connection", { offline: true }, /Can't reach LockedIn\. Check your connection and try again\./],
	];
	for (const [name, how, says] of refusals) {
		it(`${name}: says so in plain words, and the code can be tried again`, async () => {
			const p = await open({ ua: IPHONE, standalone: true, ...how });
			await p.type("input", "111111");
			assert.match(p.text(), says);
			assert.match(p.text(), /Enter the code on your laptop/, "still on the code screen");
			assert.equal(p.kv.has("/kv/pair"), false);
			await p.tap("button");
			assert.equal(p.requests.filter((r) => r.url === "/v1/claim").length, 2, "Pair tries again");
		});
	}

	it("once paired and notifications are on, opening it is just the app", async () => {
		const first = await open({ ua: IPHONE, standalone: true });
		await first.type("input", CODE);
		// The same phone, later: its pairing is stored, notifications are on.
		const p = await open({ ua: IPHONE, standalone: true, hash: `#${PAIR}`, pushOn: true, permission: "granted" });
		assert.doesNotMatch(p.text(), /Enter the code|Allow notifications/);
		assert.match(p.text(), /This week/);
	});
});

describe("Android and desktop browsers", () => {
	it("pair from the scanned link and go straight to notifications: no install step, no code", async () => {
		const p = await open({ ua: ANDROID, hash: `#${PAIR}` });
		assert.doesNotMatch(p.text(), /Home Screen|Enter the code/);
		assert.deepEqual(p.buttons(), ["Allow notifications"]);
		assert.ok(p.kv.has("/kv/pair"));
	});

	it("with no pairing (the link was lost, or another phone took the pair), get the same code screen", async () => {
		const p = await open({ ua: ANDROID });
		assert.match(p.text(), /Enter the code on your laptop/);
		await p.type("input", CODE);
		assert.match(p.text(), /✓ Paired with your laptop/);
	});
});
