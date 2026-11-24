# Stage 1 demo: a clean base (F-120, F-102 seeding)

**Branch:** `feat/v0.1` · **Commits:** `fix(ui): read session figures and quiet hours from policy (F-120)`, `chore(seed): seed prompts and switches on first run (F-102)` · **Spec:** [`v0.1-spec.md`](../v0.1-spec.md) §6 F-102, F-120; §9 step 1

## What changed

| | Before (v0.0) | Now |
|---|---|---|
| A fresh data folder | Needed `npm run companion:seed` by hand, or the real engine had no prompt overrides | Seeds itself the first time the server starts: the four prompt overrides, the settings switches (graph off, background tools off, file access restricted) and the demo lectures |
| Session sizes on screens | "3 questions… about 3 minutes" and "5 questions, about 10 minutes" typed into `today.tsx` and `welcome.tsx` | Read from `SESSION_BUDGETS` in `policy.ts` through `SESSION_COPY`. Same words at today's budgets |
| Quiet hours in onboarding | "22:00 and 08:00" typed in | Read from `DEFAULT_PREFS.quietHours` |
| "What I read" for a calendar link | "Your timetable (.ics)" | "Your calendar link" (a file still says "Your timetable (.ics)") |
| Slide card text colour | `#6a6680` inline in `session.tsx` | A CSS token on `.li-slide` (slides are white paper in every theme) |
| `.env.local.example` | Turned `COMPANION_DEMO=1` on | `COMPANION_DEMO=0`, with a note to set 1 only on a facilitator laptop |
| Stale references | `types.ts` and `docs/companion/README.md` pointed at an `app/m` phone UI that doesn't exist | Point at `components/lockedin` / `/app` |
| `mvp1-plan.md` | Open PR #2, "nothing in here is built yet" | PR #2 closed as superseded by `v0.1-spec.md` (branch kept) |

Nothing new is simulated in this stage. Sessions still run on the **scripted** engine until stage 2 connects your AI.

## Setup (once)

```bash
cd ~/PycharmProjects/LockedIn
git checkout feat/v0.1 && git pull
nvm use 26                      # .nvmrc; your shell defaults to Node 22
npm ci                          # only if dependencies changed
```

Only one `next dev` can run per project folder. Stop any other one first (`lsof -i :3000`).

## Demo A: a fresh data folder seeds itself (F-102)

```bash
rm -rf runs/demo-s1
LH_DATA_DIR=$PWD/runs/demo-s1 COMPANION_DEMO=1 npm run dev
```

1. Open **http://localhost:3000/api/companion/health**. You should get JSON with `"ok": true` and `"defaultEngine": "scripted"`.
2. In the terminal running the server, look for one line:
   `[companion] first run: seeded …/runs/demo-s1 (4 prompt overrides, 7 demo lectures)`
3. In a second terminal, check what it wrote:
   ```bash
   ls runs/demo-s1/prompts/*            # prober/10-probe-doctrine.md, shared/40-formatting.md, teacher/05-method.md, teacher/10-planning.md
   jq '.graph, .agent.fileAccess' runs/demo-s1/settings.json   # {"enabled": false, "rendering": false} and {"restricted": true, …}
   ls runs/demo-s1/companion/materials  # the 7 demo lectures
   ```
4. Stop the server (Ctrl-C) and start it again with the same command. **No** "first run" line this time: an already seeded folder is left alone.

**Expected:** no `npm run companion:seed` was needed. `npm run companion:seed` still works for re-seeding after you pull prompt changes.

## Demo B: screens take their figures from policy (F-120)

With the server from demo A running:

1. Open **http://localhost:3000/app**. On a fresh folder it takes you to onboarding.
2. Step 1: pick both modules. Step 2: keep **Use the sample timetable**. Click Continue.
3. **Step 3 ("How often can I nudge you?")** reads: "…question 1 ready. Never during a lecture, never between 22:00 and 08:00."
4. Finish. The "You're set" card says **"3 questions on your last lecture, about 3 minutes"**.
5. Go to Today. The hero card shows the same try-now line, and its progress ring has 3 segments.
6. **Prove it comes from policy** (optional, and revert afterwards):
   - In `src/core/companion/policy.ts`, change `"try-now": { questions: 3, minutes: 3 }` to `{ questions: 4, minutes: 5 }` and save.
   - Reload Today. The card now reads "4 questions on your last lecture, about 5 minutes" and the ring has 4 segments.
   - `git checkout src/core/companion/policy.ts` to undo.
7. **Me → What I read** says "Source: Sample timetable".
8. **Calendar link label** (optional, needs internet). Links are entered in onboarding, so use a second folder:
   stop the server, start it with `LH_DATA_DIR=$PWD/runs/demo-s1-link COMPANION_DEMO=1 npm run dev`, and in onboarding step 2 choose the calendar link option with a public feed, e.g.
   `https://calendar.google.com/calendar/ical/en.uk%23holiday%40group.v.calendar.google.com/public/basic.ics`.
   **Me → What I read** now says **"Source: Your calendar link"** (before this stage it said "Your timetable (.ics)"). The holidays won't match a module and there will be no try-now card; that's expected. Calendar import gets fixed properly in stage 6.
9. **Slide card:** start the try-now session. The slide panel on the right still shows the module and title line in muted grey on white, in light, dark and high contrast (Me → Appearance).

## Automated checks

```bash
npm run companion:check     # 162 companion tests, incl. the new ones below
npx tsx --test tests/companion-copy.test.ts tests/companion-seed.test.ts
npm run typecheck && npm run lint && npm test
```

- `tests/companion-copy.test.ts`: every copy line equals its policy figures; the v0.0 wording is unchanged at today's budgets; nudge type → session kind; the "What I read" labels.
- `tests/companion-seed.test.ts`: an empty folder needs seeding, a seeded one doesn't, a missing override triggers it again; switches are written and placeholder model ids never are; model slots and uploaded slides survive a re-seed; the server seeds once and then leaves the folder alone.

## Known limits

- **How "first run" is detected:** any of the four prompt overrides is missing from `<data>/prompts`. Pulling *new* prompt text into the repo does not re-seed an existing folder automatically. Run `npm run companion:seed` (same as v0.0).
- **The "What I read" label** shows "Your calendar link" whenever a link is saved, even if you later upload a file. The calendar rework in stage 6 (F-108) replaces this.
- **The full `npm test` on a busy Mac:** two engine tests (`plugin-document-types`, `plugin-grading-types`) can hit their timeout when the whole suite runs in parallel. Each passes in about 16 s on its own. They test plugin types and are unrelated to the companion.
- **Next.js warning:** `next dev` prints "Your version of Next.js is affected by a known security vulnerability". Not addressed in this stage; see the stage report.
