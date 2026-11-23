#!/usr/bin/env node
// Print a fresh VAPID key pair for `wrangler secret put VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`.
// Run once per relay; keep the private key secret (never commit it).
const b64url = (b) => Buffer.from(b).toString("base64url");
const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
console.log(`VAPID_PUBLIC_KEY=${b64url(raw)}`);
console.log(`VAPID_PRIVATE_KEY=${jwk.d}`);
