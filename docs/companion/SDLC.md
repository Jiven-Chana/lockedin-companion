# How we build and ship

The goal: turning a lo-fi idea into a hi-fi feature is a small, reviewable PR with evidence attached, and `main` is always green and demoable.

## Branches and commits

| Ref | Purpose | Rules |
|---|---|---|
| `main` | The product. Default branch. Always green, always demoable | Changes land only through PRs; CI must pass; squash merge only |
| `feat/<journey>-<slug>` | A feature, e.g. `feat/j5-lock-screen` | Branch from `main`, keep it short-lived (a day or two) |
| `fix/<slug>`, `content/<slug>`, `docs/<slug>`, `chore/<slug>`, `test/<slug>` | Fixes, lecture content, docs, tooling, tests | Same |
| tags `hifi-v<n>` | Frozen builds (T21 freeze = `hifi-v1`, Tue 24 Nov) | Annotated, from `main` after a green CI run |

Do not use tags starting with `v`: the engine's desktop release tooling assumes those.

**Commit messages** follow [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): summary` in the imperative, under ~72 characters, with a body saying *why* when it isn't obvious. Types: `feat`, `fix`, `test`, `docs`, `content`, `refactor`, `chore`, `ci`. Scopes: `nudges`, `sessions`, `engine`, `api`, `store`, `blocks`, `content`, `seed`, `ui`. Because PRs are squash-merged, **the PR title becomes the commit on `main`**: write it in the same format.

```text
feat(nudges): hold N-2 back while an N-1 is still due today
fix(engine): keep a preparing session in "preparing" across the prober handoff
content(hci-w4): replace draft fieldwork slides with the real deck
```

## The lo-fi → hi-fi loop

1. **Issue.** Open a *Feature (lo-fi → hi-fi)* issue: the journey (J1–J6), the lo-fi finding it comes from, evidence IDs (AE2-…, Q-…, R-…), and acceptance criteria as observable behaviour ("tap to question 1 ≤ 3 s pre-warmed"). If it needs a group decision, add it to [DECISIONS.md](DECISIONS.md) first.
2. **Rules first.** If the feature changes behaviour, express it in the pure core (`src/core/companion/`) with a table-driven test before any UI. Tunable numbers go in `policy.ts`, never inline.
3. **Service + route.** Extend `CompanionService` and add a one-line route with `companionRoute`. Cover it in `tests/companion-routes.test.ts` and document it in [API.md](API.md).
4. **Events.** If T23 measures it, log an event (plan §12.3). New types go in `COMPANION_EVENT_TYPES`; browser-sent ones also in `CLIENT_EVENT_TYPES`.
5. **UI** on top of the API (a separate PR is fine).
6. **PR.** Fill in the template: journey, evidence, engines run on, screenshots for UI, the `design-log.md` entry in the team repo (rubric criterion 8: traceability).
7. **Review** by at least one teammate when possible. The reviewer checks the acceptance criteria and the plan's "never cut" list, not just the code.
8. **Squash merge.** The branch is deleted automatically.

## Definition of done

- [ ] CI is green (`npm run companion:check`, typecheck, lint, the full test suite, the production build, the seed)
- [ ] Behaviour is covered by a test at the lowest layer that can express it (pure rule > service > route)
- [ ] Works on the **scripted** engine; if it touches sessions, also run once on **learnharness** (`npm run companion:tracer` or a manual run) and say so in the PR
- [ ] No streaks, no "overdue", no red numbers; the lock is off by default with an override; nudge wording under 90 characters (tests enforce the last one)
- [ ] Simulated things are labelled as simulated
- [ ] Event logged if T23 measures it; [API.md](API.md) updated if the HTTP surface changed
- [ ] No secrets, no participant data (`.env.local`, `data/`, `runs/` are ignored; keep it that way)
- [ ] Engine changes (outside the companion paths) are listed in `NOTICE`

## CI

`.github/workflows/ci.yml` runs on every PR into `main` and every push to it, on Ubuntu with Node 26:

- **quality:** `npm run companion:check` (prompt-override drift check + companion suite, fast fail), `npm run typecheck`, `npm run lint` (enforces the import law), `npm test` (full suite, no paid model calls)
- **build:** `npm run build` (Next production build; catches route-handler signature errors), then `npm run companion:seed` against a fresh data dir

**Branch protection** for `main` (Settings → Rules → Rulesets): require a pull request, require the `quality` and `build` checks, block force pushes and deletion. GitHub only enforces rulesets on private repositories on a paid plan. On a free personal account, either upgrade, move the repository to a team organisation, or make it public; until then, the rules above are a team agreement.

## Environments

| | How | Engine | Data |
|---|---|---|---|
| Dev | `npm run dev` | scripted by default; learnharness with a key | `data/` |
| T23 participant | `LH_DATA_DIR=$PWD/runs/P03 npm run dev` on the facilitator laptop, `COMPANION_DEMO=1` | decided at the checkpoint (DECISIONS.md D-2) | `runs/P03/` (one per participant) |
| Phone on Wi-Fi | `npm run dev -- -H 0.0.0.0` on a **private hotspot only**. There is no login: anyone on the network can read everything and spend the key | as above | as above |

Never expose the server on eduroam or public Wi-Fi.

## Releases

`hifi-v1` (T21 freeze) is cut from `main` after a green CI run and a full T23 dry run (plan §11, Mon 23):

```bash
git checkout main && git pull
git tag -a hifi-v1 -m "T21 freeze: <what is simulated>, T23 engine: <scripted|learnharness>"
git push origin hifi-v1
```

## The engine baseline

The teaching engine is LearnHarness v0.6.1 (commit `cb25c8e`), included in this repository and modified as listed in `NOTICE`. This repository does not track LearnHarness's history. If an upstream fix is needed, port the specific change by hand in its own PR (`chore(engine): port <change> from LearnHarness <commit>`), add it to `NOTICE`, and run the seams that pin engine behaviour:

- `tests/companion-question.test.ts`: our question order matches the engine's dock shuffle
- `tests/companion-content.test.ts`: the seed survives the engine's settings sanitizer; prompt overrides match existing segments
- `tests/companion-lh-integration.test.ts`: our engine against the real in-process turn loop
- `npm run companion:prompts`, then `npm run companion:tracer -- --runs 3` with a real model

`src/server/companion/lh-port.ts` is the only file that calls engine internals.

## Working with AI assistants

`AGENTS.md` tells agents not to guess design decisions. For companion work, the plan and [DECISIONS.md](DECISIONS.md) are the approved design; anything they don't cover is a question for the team, not the agent. `CLAUDE.md` points agents at these documents.
