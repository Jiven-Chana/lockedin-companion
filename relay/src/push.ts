/**
 * Web push from the relay (v0.1 F-112): a VAPID-signed push with no
 * payload (RFC 8292). The phone's service worker wakes, fetches its due
 * nudge from the relay and shows it, so the question is cached before the
 * tap (spec §5.2, V-11). No payload means no message encryption, which
 * keeps this to WebCrypto alone: it runs on Workers, in browsers and in
 * Node.
 */

export interface VapidKeys {
	/** The uncompressed P-256 public key (65 bytes), base64url: the applicationServerKey. */
	publicKey: string;
	/** The private scalar d, base64url. */
	privateKey: string;
	/** "mailto:…" or an https URL, as push services ask. */
	subject: string;
}

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), (c) => c.charCodeAt(0));
const utf8 = (s: string) => new TextEncoder().encode(s);

async function signingKey(keys: VapidKeys): Promise<CryptoKey> {
	const pub = fromB64url(keys.publicKey);
	if (pub.length !== 65 || pub[0] !== 4) throw new Error("VAPID public key must be an uncompressed P-256 point");
	const jwk: JsonWebKey = { kty: "EC", crv: "P-256", d: keys.privateKey, x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33, 65)), ext: true };
	return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

/** The VAPID JWT for one push service origin, valid for 12 hours. */
export async function vapidJwt(audience: string, keys: VapidKeys, nowSeconds = Math.floor(Date.now() / 1000)): Promise<string> {
	const header = b64url(utf8(JSON.stringify({ typ: "JWT", alg: "ES256" })));
	const claims = b64url(utf8(JSON.stringify({ aud: audience, exp: nowSeconds + 12 * 3600, sub: keys.subject })));
	const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, await signingKey(keys), utf8(`${header}.${claims}`)));
	return `${header}.${claims}.${b64url(signature)}`;
}

export type PushResult = "sent" | "gone" | "failed";

/** Wake one subscription. "gone" means the subscription expired (404/410): delete it. */
export async function sendPush(endpoint: string, keys: VapidKeys, fetchImpl: typeof fetch = fetch): Promise<PushResult> {
	const url = new URL(endpoint);
	if (url.protocol !== "https:") return "failed";
	const jwt = await vapidJwt(url.origin, keys);
	try {
		const res = await fetchImpl(endpoint, {
			method: "POST",
			headers: { Authorization: `vapid t=${jwt}, k=${keys.publicKey}`, TTL: "3600", Urgency: "high", "Content-Length": "0" },
		});
		if (res.status === 404 || res.status === 410) return "gone";
		return res.ok ? "sent" : "failed";
	} catch {
		return "failed";
	}
}

/** A fresh VAPID key pair (scripts/vapid.mjs prints one for `wrangler secret put`). */
export async function generateVapidKeys(subject: string): Promise<VapidKeys> {
	const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
	const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
	const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
	return { publicKey: b64url(raw), privateKey: jwk.d!, subject };
}
