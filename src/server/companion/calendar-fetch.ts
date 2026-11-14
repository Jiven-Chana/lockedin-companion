/**
 * Fetch a calendar link the student pasted (mvp1-plan F-03, decision U-4).
 * The server makes this request, so guard it: http(s) only, no private,
 * loopback or link-local addresses, no redirects, 5 s timeout, 2 MB cap.
 */

import { lookup } from "node:dns/promises";
import net from "node:net";

const MAX_BYTES = 2 * 1024 * 1024;

export function isPrivateAddress(ip: string): boolean {
	const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
	if (net.isIPv4(v4)) {
		const [a, b] = v4.split(".").map(Number) as [number, number];
		return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
	}
	const x = ip.toLowerCase();
	return x === "::" || x === "::1" || x.startsWith("fc") || x.startsWith("fd") || x.startsWith("fe8") || x.startsWith("fe9") || x.startsWith("fea") || x.startsWith("feb");
}

export async function fetchCalendarText(url: string, fetchImpl: typeof fetch = fetch): Promise<string> {
	const u = new URL(url);
	if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("only http(s) calendar links");
	const host = u.hostname.replace(/^\[|\]$/g, "");
	const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
	if (addrs.length === 0 || addrs.some((a) => isPrivateAddress(a.address))) throw new Error("that link points at a private network address");
	const res = await fetchImpl(u, { redirect: "error", signal: AbortSignal.timeout(5_000), headers: { accept: "text/calendar, text/plain;q=0.9" } });
	if (!res.ok || !res.body) throw new Error(`the calendar server answered ${res.status}`);
	const reader = res.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { value, done } = await reader.read();
		if (done) break;
		size += value.length;
		if (size > MAX_BYTES) {
			await reader.cancel();
			throw new Error("that calendar is larger than 2 MB");
		}
		chunks.push(value);
	}
	return new TextDecoder().decode(Buffer.concat(chunks));
}
