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

## Installing on an iPhone (v1.0, P-1)

iPhones only allow notifications from a web app on the Home Screen, and they give that app its own storage: a pairing saved in the browser doesn't reach it. So:
- in the browser, the phone app shows a guided install (three steps with pictures, and a sample question that sends nothing);
- it points its manifest at `GET /v1/manifest?pair=<pairId>.<token>`, which is the plain `web/manifest.webmanifest` with `start_url` set to `/p#<pairId>.<token>`. The Home Screen app therefore opens already paired;
- the installed app says "✓ Installed" and asks for notifications. Once they are on, it opens as the app.

The route only echoes the pair it is given (it must be two 32-character hex strings) and never looks it up. The token is the phone's own, and it already travels to the relay on every call.

Android and desktop browsers share storage with the installed app, so they keep the plain manifest and skip the install step.
