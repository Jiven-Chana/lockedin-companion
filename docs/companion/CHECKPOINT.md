# Checkpoint runbook (Mon 16 Nov, 18:00)

LearnHarness stays the engine for the hi-fi only if all four criteria hold (plan §6.9). Otherwise the session screen runs on the scripted engine (`COMPANION_ENGINE=scripted`) and the rest of the plan continues unchanged. Record the result in `design-log.md` in the team repo.

## 0. One-time setup (about 10 minutes)

```bash
cp companion/seed/.env.local.example .env.local      # put ANTHROPIC_API_KEY (or OPENROUTER_API_KEY) in it
npm run dev                                           # seeds data/ on first start; http://localhost:3000 → Settings → Providers/Models
```

Pick the three model slots once in LearnHarness's own Settings (strong: a fast model with reliable tool use, thinking level low; cheap; vision). That writes valid catalogue ids into `data/settings.json`. Copy the `models` block into `companion/seed/settings.json` in a PR so every teammate's seed gets them, or set `COMPANION_MODEL_STRONG=provider/id` (and `_CHEAP`, `_VISION`) and re-run the seed.

Check: `curl localhost:3000/api/companion/health` shows `strongModel` set and `providerKeyPresent: true`.

## 1. Latency: question 1 ≤ 20 s cold, ≤ 3 s pre-warmed

```bash
npm run companion:tracer -- hci-w3-personas --runs 5
npm run companion:tracer -- hci-w4-fieldwork --runs 5
```

Cold latency is printed per run, with the median. Pre-warmed: run the J2 flow from the facilitator routes (`/demo/scenario {name: tayo}`, advance to the lecture end, tick, advance 5 minutes, tick, open) and read `msSinceOpen` on the `question_shown` event (`/api/companion/events.csv`). Try `thinkingLevel` `low` and `minimal` on the strong slot.

## 2. Protocol: a 5-question session completes 3 times out of 3, on two lectures

`npm run companion:tracer -- <lecture> --answer` covers the first answer; for full sessions use the routes (see API.md) or the phone UI once it exists. Look for `error` events and `status: "error"` views.

## 3. Doctrine: keeps to the budget, never asks to confirm a plan, cites slides

Read the 6 transcripts at `http://localhost:3000/chat/<chatId>` (the `chatId` is on `session_prepared` events). Note every budget overrun, plan presentation, missing `(Slide n)` and unintroduced term. Tune `companion/seed/prompts/**` (or the patches, then `npm run companion:prompts`), re-seed, re-run. `settings.json` and prompt files are re-read on every turn: no restart needed.

## 4. Cost per session under the ceiling (D-3)

`GET /api/companion/sessions/:id/cost` (with `COMPANION_DEMO=1`), or the tracer's "cost so far" line.

## Record

| # | Criterion | Result (fill in) | Pass? |
|---|---|---|---|
| 1 | Q1 ≤ 20 s cold (median of 5) / ≤ 3 s pre-warmed | | |
| 2 | 3/3 complete sessions, 2 lectures | | |
| 3 | Budget kept, no plan confirmation, slides cited | | |
| 4 | Cost per session ≤ ceiling | | |

After the checkpoint: save one real companion chat record (`data/chats/<chatId>.json`) as `tests/fixtures/companion/` and add it to `tests/companion-view.test.ts` (plan §12.1).

## Evidence so far (23 Nov dry run, not the full checkpoint)

Real engine on a ChatGPT sign-in, "Choose for me" models (strong `gpt-6-sol`, cheap `gpt-6-luna`, vision `gpt-6-sol`), production build, the bundled HCI personas lecture only:

| # | What was seen | Against the criterion |
|---|---|---|
| 1 | First taste (3 questions) ready **20.4 s, 22.0 s, 21 s** after it started preparing (3 cold runs). It prepares during the modules screen, so by "Finish" it was already waiting (`prewarmed` timing not measured) | At or just over the 20 s cold line; one lecture only. Needs the 5-run median on two lectures |
| 2 | Before the fix: the teacher stopped after question 1 of 3 (feedback, no next question). After the opening-message line (`TEACHER_RULES`): **3 of 3**, no `teacher_nudged` needed | 1 complete session, 3 questions, one lecture. Needs 3 × 5-question sessions on two lectures |
| 3 | Questions cite slides; explanations name slides ("(Slide 3)"); no plan confirmation seen in 2 transcripts | Partial: 2 transcripts read, not 6 |
| 4 | `costUsd` is null on a ChatGPT sign-in (subscription, no per-token price) | Not measurable on ChatGPT; measure on an API key if D-3 needs a number |

Also seen: a study pack for the same lecture in **54 s** (7 explainers, 15 questions, 1 question dropped by the validator for a 95-character stem).
