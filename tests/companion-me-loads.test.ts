/**
 * A screen asks the server once, however its parent re-draws (v3.0).
 *
 * Me passed "Your AI" a new callback on every draw; the panel took a new
 * callback as a reason to load again, and each load re-drew Me. Me then asked
 * for the AI status without stopping, and no other page could open. These
 * tests mount the panel in a parent that re-draws on every status.
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { parseHTML } from "linkedom";
import { createElement, useState } from "react";
import type { Root } from "react-dom/client";

const STATUS = {
	chatgpt: { available: true, pending: false, allowBackgroundUse: true, connected: true, email: "student@example.com", error: null },
	keys: { anthropic: false, openai: false, openrouter: false },
	slots: { strong: { model: { provider: "chatgpt", id: "m1" } }, cheap: { model: { provider: "chatgpt", id: "m1" } }, vision: { model: { provider: "chatgpt", id: "m1" } } },
	catalog: [{ id: "m1", name: "Model one", provider: "chatgpt", input: ["text", "image"], reasoning: true, supportedLevels: ["low", "high"], cost: null }],
	provider: "chatgpt",
	modelsReady: true,
	ready: true,
	blocker: null,
	voice: false,
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("the AI panel loads its status once", () => {
	const asked: string[] = [];
	let root: Root | null = null;
	let host: Element;
	const real = { fetch: globalThis.fetch };

	before(() => {
		const { window, document } = parseHTML("<!doctype html><html><body><div id=host></div></body></html>");
		Object.assign(window, { setTimeout, clearTimeout, setInterval, clearInterval, requestAnimationFrame: (f: () => void) => setTimeout(f, 0), cancelAnimationFrame: clearTimeout });
		Object.assign(globalThis, { window, document, IS_REACT_ACT_ENVIRONMENT: false });
		if (!("navigator" in globalThis) || !globalThis.navigator) Object.defineProperty(globalThis, "navigator", { value: window.navigator, configurable: true });
		globalThis.fetch = (async (url: string | URL | Request) => {
			asked.push(String(url));
			return new Response(JSON.stringify(STATUS), { status: 200, headers: { "content-type": "application/json" } });
		}) as typeof fetch;
		host = document.getElementById("host")!;
	});
	after(() => {
		root?.unmount();
		globalThis.fetch = real.fetch;
	});

	it("a parent that re-draws on every status, with a new callback each time, is asked for one status", async () => {
		const { createRoot } = await import("react-dom/client");
		const { ConnectAi } = await import("../components/lockedin/screens/connect.tsx");
		let draws = 0;
		function Parent() {
			const [, setSeen] = useState(0);
			draws++;
			// A new function on every draw, and a re-draw on every status: what Me did.
			return createElement(ConnectAi, { variant: "settings", onStatus: () => setSeen((n) => n + 1), onReadyChange: () => setSeen((n) => n + 1) });
		}
		root = createRoot(host);
		root.render(createElement(Parent));
		await wait(500);
		assert.match(host.textContent ?? "", /Model one|ChatGPT/, "the panel drew its status");
		assert.equal(asked.filter((u) => u.endsWith("/api/companion/ai")).length, 1, `asked ${asked.length} times in half a second`);
		assert.ok(draws < 10, `the parent drew ${draws} times`);
	});
});

describe("Me asks for the AI status in one place", () => {
	it("the screen has no second request of its own, and hands the panel a callback that does not change", async () => {
		const fs = await import("node:fs");
		const path = await import("node:path");
		const me = fs.readFileSync(path.join(import.meta.dirname, "..", "components/lockedin/screens/me.tsx"), "utf-8");
		assert.ok(!me.includes("lockedIn.ai.status()"), "Me reads the status the panel loaded");
		assert.ok(me.includes('<ConnectAi variant="settings" onStatus={setAi} />'), "the callback is the state setter, which never changes");
	});
});
