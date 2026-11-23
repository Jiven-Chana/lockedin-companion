# LockedIn companion: engine and plumbing

LockedIn adds a **start layer** and **session engines** around the LearnHarness teaching engine (v0.6.1, included and modified under AGPL-3.0; see `NOTICE`) for the hi-fi prototype (T21): a proactive study app that gets students into a short session at the right moment, with LearnHarness doing the teaching inside the session.

This document covers everything the student never sees: rules, engines, storage, API, seed and tests. The LockedIn screens (`components/lockedin/`, served at `/app`) are built on top of the [API](API.md) and are not part of this layer.

- **Design:** [plan.md](plan.md) (the group-reviewed implementation plan; section numbers below refer to it). **Next version:** [v0.1-spec.md](v0.1-spec.md); **history:** [VERSIONS.md](VERSIONS.md)
- **How we work:** [SDLC.md](SDLC.md) (branches, commits, PRs, definition of done, CI)
- **HTTP API:** [API.md](API.md)
- **Decisions made in the build, and decisions still open:** [DECISIONS.md](DECISIONS.md)
- **Monday checkpoint runbook:** [CHECKPOINT.md](CHECKPOINT.md)

## Quick start

```bash
nvm install 26 && nvm use 26          # CI uses Node 26 (.nvmrc)
npm ci
npm run plugins:setup                 # once after a fresh checkout

cp companion/seed/.env.local.example .env.local   # add a provider key for the learnharness engine
npm run companion:seed                # settings, prompt overrides, demo content → data/

npm run dev                           # http://localhost:3000/api/companion/health
```

With `COMPANION_ENGINE` unset the server uses the **scripted** engine, so a fresh checkout works with no API key. Set `COMPANION_ENGINE=learnharness` (and configure models once, see [CHECKPOINT.md](CHECKPOINT.md)) for real teaching.

One participant per data directory (plan §7.2): `LH_DATA_DIR=$PWD/runs/P03 npm run companion:seed && LH_DATA_DIR=$PWD/runs/P03 npm run dev`. `runs/` is git-ignored.

## Commands

| Command | What it does |
|---|---|
| `npm run test:companion` | The companion test suite (about 3 s, no network, no model) |
| `npm run companion:check` | Prompt-override drift check + companion tests (what CI runs first) |
| `npm run companion:seed` | Seed a data dir (`-- --force` overwrites existing materials) |
| `npm run companion:prompts` | Regenerate the derived prompt overrides after an engine prompt changes |
| `npm run companion:tracer` | Tracer bullet: a real LearnHarness session to question 1, with latency and cost (`-- gt-w2-nash --runs 5 --answer`) |
| `npm test` / `npm run typecheck` / `npm run lint` | The full upstream gates, which must stay green |

## Architecture (plan §5)

```text
Browser (phone UI, later)          app/api/companion/**  (thin routes, one line each)
                                           │
                                   src/server/companion/  (IO)
          ┌────────────────────────────────┼──────────────────────────────────┐
          │ CompanionService (service.ts): onboarding, nudge tick + pre-warm, │
          │ nudge actions, sessions, misses, blocks/lock, progress, events,   │
          │ facilitator ops                                                    │
          ├──────────────┬──────────────┬───────────────┬─────────────────────┤
          │ store.ts     │ clock.ts     │ content.ts    │ engines/             │
          │ data/        │ real + demo  │ slides, sets, │  learnharness.ts ──► lh-port.ts ──► LearnHarness
          │ companion/   │ offset       │ timetable     │  scripted.ts          (createChat, handleChatInput,
          └──────────────┴──────────────┴───────────────┴─────────────────────┘ sideChats, pricing)
                                           │
                                   src/core/companion/  (pure rules, browser-safe)
   nudges · policy · opening-message · question-data · view-mapper · misses · progress
   timetable (sample + .ics) · blocks/lock · scripted · slides · csv · time · types
```

- **Import law** (enforced by `eslint.config.mjs`): `app/` imports only `@/src/core` and `@/src/server`; `src/core/**` never imports IO layers. Our code follows the same split, re-exported through the two barrels.
- **The engine is kept as intact as possible:** companion code lives in its own paths and reaches LearnHarness through two barrel exports and one adapter (`src/server/companion/lh-port.ts`). Engine changes stay small and isolated so they remain easy to reason about.
- **The engine interface** (`src/server/companion/engines/types.ts`) is the only thing the service talks to, so switching engines (`COMPANION_ENGINE`, the facilitator panel, or automatic fallback) changes no UI code.

## Where to change what

| To change… | Edit | Test |
|---|---|---|
| A threshold, budget, cap or nudge wording | `src/core/companion/policy.ts` (one place, with evidence comments) | `tests/companion-nudges.test.ts` |
| When a nudge fires | `src/core/companion/nudges.ts` | `tests/companion-nudges.test.ts` |
| What the teacher sees first | `src/core/companion/opening-message.ts` **and** the overrides in `companion/seed/prompts/` | `tests/companion-opening.test.ts` |
| How a LearnHarness record becomes the screen | `src/core/companion/view-mapper.ts` | `tests/companion-view.test.ts`, `tests/companion-lh-integration.test.ts` |
| Teacher behaviour | `companion/seed/prompts/**` (full replacements) or `companion/seed/prompt-patches/**` (then `npm run companion:prompts`) | `tests/companion-content.test.ts`; transcripts at the checkpoint |
| Demo lectures, slides, scripted questions, scenarios | `companion/content/**` | `tests/companion-content.test.ts` |
| A new endpoint | a method on `CompanionService` + `app/api/companion/<path>/route.ts` using `companionRoute` | `tests/companion-routes.test.ts` |

## Data (plan §7.2)

`${LH_DATA_DIR:-data}/companion/`: `profile.json`, `lectures.json`, `blocks.json`, `sessions.json`, `misses.json`, `nudges.jsonl` (append-only, last record per id wins), `events.jsonl` (the T23 log), `demo.json` (demo clock, participant, engine override), `runtime.json`, `materials/<lectureId>/{slides.md,slides.pdf,questions.json}`, `archive/` (event logs archived by facilitator resets). LearnHarness's own chats stay in `data/chats/`.

Single user, single process: one server per data directory.

## What is simulated (say so in the deck)

Push notifications (the nudge banner is in-app), the app lock (decoy apps, always overridable), the sample timetable (labelled), the demo clock, and the scripted engine when it is used. All demo slides and question sets in `companion/content/` are **draft placeholders** to be replaced with the module's real material and reviewed (see [DECISIONS.md](DECISIONS.md)).

## Licence

AGPL-3.0, inherited from LearnHarness. This is a modified version: keep `LICENSE` and `NOTICE` and record significant engine changes in `NOTICE`. If the server is ever offered to people over a network, they must be able to get this source.
