@AGENTS.md

# LockedIn

LockedIn is a study companion built on the LearnHarness teaching engine (see `NOTICE`). These rules apply on top of AGENTS.md:

- **The approved design** is `docs/companion/plan.md` plus `docs/companion/DECISIONS.md`. Build what they say; anything they don't cover is a question for the user, not a guess (AGENTS.md "No guessing").
- **v0.1 work** follows `docs/companion/v0.1-spec.md`, which takes precedence over `plan.md` where they differ. `docs/companion/VERSIONS.md` records what each version ships and what is missing. The spec's §12 open decisions are questions, not defaults to assume. v0.1 also adds a top-level `relay/` package (the phone relay and phone web app).
- **Where code goes:** pure rules in `src/core/companion/` (no IO, browser-safe), IO in `src/server/companion/`, one-line routes in `app/api/companion/` using `companionRoute`. The lint enforces the import law. Tunable numbers and nudge wording live only in `src/core/companion/policy.ts`.
- **Keep engine changes contained.** Avoid editing files outside the companion paths (`src/*/companion`, `app/api/companion`, `companion/`, `docs/companion/`, `tests/companion-*`). When you must, keep it minimal and add it to `NOTICE`. `src/server/companion/lh-port.ts` is the only place that calls engine internals.
- **Tests first for behaviour:** table-driven tests in `tests/companion-*.test.ts`. Run `npm run companion:check` (fast) before `npm run typecheck`, `npm run lint`, `npm test`.
- **Process:** `docs/companion/SDLC.md` (branches, Conventional Commits, PRs, definition of done). Never commit `.env.local`, `data/`, `runs/`.
- **Node 26** (`.nvmrc`). Read `node_modules/next/dist/docs/` before framework-facing changes (Next 16).
