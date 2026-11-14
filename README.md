# LockedIn

A proactive study companion. After a lecture, the student gets one nudge; tapping it opens a session that is already prepared: the goal on screen and question 1 waiting. Five questions with a confidence rating and a "why" box, a hint or a worked example on request, leave and resume any time, and anything missed comes back later in a short retest.

This repository is the hi-fi prototype's **engine and plumbing**: the nudge engine, session engines, storage, HTTP API, seed configuration, demo content and tests. The phone UI is built on top of the [API](docs/companion/API.md).

## Quick start

```bash
nvm install 26 && nvm use 26          # Node 26 (.nvmrc)
npm ci
npm run plugins:setup                 # once after a fresh checkout

cp companion/seed/.env.local.example .env.local   # add a provider key for real teaching
npm run companion:seed                # settings, prompt overrides, demo content → data/

npm run dev                           # http://localhost:3000/api/companion/health
```

Without `COMPANION_ENGINE` set, sessions run on the **scripted** engine, so a fresh checkout works with no API key.

## Documentation

| | |
|---|---|
| [docs/companion/README.md](docs/companion/README.md) | Architecture, commands, where to change what, data layout |
| [docs/companion/SDLC.md](docs/companion/SDLC.md) | How we build and ship: branches, commits, PRs, CI (and [CONTRIBUTING.md](CONTRIBUTING.md)) |
| [docs/companion/API.md](docs/companion/API.md) | Every `/api/companion` route |
| [docs/companion/DECISIONS.md](docs/companion/DECISIONS.md) | Decisions made in the build, and decisions still open |
| [docs/companion/CHECKPOINT.md](docs/companion/CHECKPOINT.md) | The engine checkpoint runbook |
| [docs/companion/plan.md](docs/companion/plan.md) | The hi-fi MVP implementation plan |

## Checks

```bash
npm run test:companion    # the companion suite (~3 s, no network, no model)
npm run typecheck && npm run lint && npm test
```

## Credits and licence

LockedIn's teaching engine is [LearnHarness](https://github.com/amosblomqvist/learnharness) by Amos Blomqvist (v0.6.1), which this project includes and modifies. LearnHarness provides the agent turn loop, question grading and persistence used inside LockedIn's sessions; LockedIn adds the start layer around it (nudges, timetable, study blocks, miss log, the scripted engine and the companion API). The engine's own technical documentation is in [docs/](docs/).

Licensed under the GNU Affero General Public License v3.0 only, the same licence as LearnHarness. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
