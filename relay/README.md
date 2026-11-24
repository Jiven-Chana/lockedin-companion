# LockedIn relay and phone app

The relay is a small Cloudflare Worker (v0.1 F-112, spec §5, decision O-1). It does four things:
- holds the next 7 days of nudges the laptop prepared;
- wakes the phone with web push when one is due, even when the laptop is closed;
- keeps the phone's answers and taps in an append-only log that the laptop replays;
- serves the phone web app (`web/`).

It never holds location, slides, notes or AI keys.

- `src/relay.ts`: the HTTP API (spec Appendix B) and the every-minute job.
- `src/push.ts`: VAPID-signed, payload-less web push (WebCrypto only).
- `schema.sql`: the D1 tables.
- `web/`: the phone app (plain HTML, CSS and JS; a PWA with a service worker).
- Tests: `tests/companion-relay*.test.ts` at the repo root, run by `npm run companion:check`.

## Run it locally (no Cloudflare account needed)

```bash
cd relay
npm install                 # wrangler
npm run vapid               # prints VAPID_PUBLIC_KEY=… and VAPID_PRIVATE_KEY=…
cp .dev.vars.example .dev.vars && $EDITOR .dev.vars   # paste the two keys
npm run db:local            # create the local D1 tables
npm run dev                 # http://localhost:8787  (phone app at /p)
```

Point the laptop at it with `COMPANION_RELAY_URL=http://localhost:8787` in `.env.local`. A real phone can't use `localhost`. For a real phone, deploy (below) or use an HTTPS tunnel. Push only works over HTTPS.

## Deploy to the team account (once, then `npm run deploy`)

```bash
cd relay
npx wrangler login                         # the team-owned Cloudflare account (O-1)
npx wrangler d1 create lockedin-relay      # copy the database_id into wrangler.toml
npm run db:remote                          # create the tables
npm run vapid                              # then:
npx wrangler secret put VAPID_PUBLIC_KEY   # paste
npx wrangler secret put VAPID_PRIVATE_KEY  # paste
npm run deploy                             # prints https://lockedin-relay.<account>.workers.dev
```

Then set `COMPANION_RELAY_URL=https://lockedin-relay.<account>.workers.dev` on the laptop. The VAPID private key and `.dev.vars` are secrets: never commit them.

**After any change under `relay/`** (the Worker or the phone app in `web/`), run `npm run deploy` again from the account that owns the relay. Phones pick up the new phone app the next time they open it online.

## Pairing a phone (v1.0.3)

The laptop shows one panel (Me → Phone): a QR code, three steps, a **6-digit code**, and a status line.

**iPhone.** iPhones only allow notifications from a web app on the Home Screen, and they give that app its own storage, so nothing the browser saves reaches it. Two attempts to carry the pairing across through the app's manifest (v1.0, v1.0.2) did not work on a real phone and were removed. So:
1. Scanning the QR code opens the phone app in the browser, which shows how to add it to the Home Screen (three steps with pictures). Nothing is paired there.
2. The Home Screen app asks for the code on the laptop. The sixth digit pairs it.
3. It then asks for notifications, and says when the next question will come.

**Android and desktop browsers** share storage with the installed app: scanning pairs them (the link is `/p#<pairId>.<token>`), and they go straight to notifications.

**Any phone with no pairing** (the link was lost, or another phone took the pair) gets the same code screen.

### The code
- `POST /v1/pairs/:id/code` (the laptop's secret) → `{ code, expiresAt }`: the pair's current code while it lasts (10 minutes), a fresh one after.
- `POST /v1/claim` `{ code }` (no token) → `{ pairId, token }`. The phone gets a **new** token; the pair's previous phone token, the one in the QR link, stops working, and so do its push subscriptions. A pair has one phone.
- A code holds no token (`pair_codes`: code, pair, expiry), works once, and is deleted when used, when it expires or when the pair is deleted.
- Guessing: more than 20 wrong codes in a minute across the relay and every claim gets `429` for the rest of that minute (`claim_failures` holds only timestamps: no address, no device).

**After a schema change** (this version adds `pair_codes` and `claim_failures`), run `npm run db:remote` before `npm run deploy`. The statements are `CREATE TABLE IF NOT EXISTS`, so it is safe to run again.
