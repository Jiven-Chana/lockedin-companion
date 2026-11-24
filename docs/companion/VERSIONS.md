# LockedIn version history

Each version records what it ships, how it works, what is missing, and the evidence behind it. Evidence IDs (`Q-n`, `INT-0n-x`, `AE-n`, `AE2-n`, `AE2-Pn`, `AFF-x`, `X-n`, `C-n`, `LIT-n`, `R-n`, `N-n`) are indexed in the team repository (`kayzisland/hcidesignchallenge`, `research/findings-register.md`); rules `R-1`–`R-9` and nudges `N-1`–`N-5` are in its `define/behaviour-change.md` (T20 v2).

**Naming.** Versions are `v0.0`, `v0.1`, …; git tags are `lockedin-v0.0`, `lockedin-v0.1`, … (never a bare `v*` tag: the engine's desktop release tooling reserves those, `SDLC.md`). The PLAN.md freeze tag `hifi-v1` will point at whichever LockedIn version is frozen for the hi-fi test.

| Version | Date | Git | Status | Spec |
|---|---|---|---|---|
| **v0.0** | 14 Nov 2026 | `6ff961b` on `main`, tag `lockedin-v0.0` | Shipped (laptop web app at `/app`) | [`plan.md`](plan.md), `mvp1-plan.md` (branch `docs/mvp1-plan`), [`DECISIONS.md`](DECISIONS.md) B-1–B-15 |
| **v0.1** | 24 Nov 2026 | `99f701d` on `main`, tag `lockedin-v0.1` | Phase A shipped as built (stages 1–13, 23–24 Nov). Its known issues are the v1.0 list | [`v0.1-spec.md`](v0.1-spec.md), [`DECISIONS.md`](DECISIONS.md) V-1–V-18, [`demos/`](demos/) |
| **v1.0** | 24 Nov 2026 | tag `lockedin-v1.0` on `main` (PR #6) | Shipped: everything broken in v0.1 is fixed; no redesigns, no packaging (V-19). Awaiting Jiven's own test and the iPhone check | [`v1.0-release.md`](v1.0-release.md), [`v1.0-plan.md`](v1.0-plan.md), [`v1.0-issues.md`](v1.0-issues.md), [`DECISIONS.md`](DECISIONS.md) V-19–V-31 |
| **v2.0** | after v1.0 passes Jiven's test | — | Direction only (24 Nov): the polish stage, streamlining the flow back towards the team's lo-fi design | [`v2.0-direction.md`](v2.0-direction.md) |
| **v3.0** | after v2.0 | — | Not specified yet: the desktop app, code clean-up, remaining flow polish, bugs found in v2.0 | — |

---

## v0.0: the plumbing and the laptop app (14 Nov 2026)

### In one paragraph

A single-user, laptop-first web app at `/app`, built inside a fork of LearnHarness v0.6.1. It reads a timetable (a labelled sample week, an `.ics` file or a calendar link), works out when a lecture has just ended and the student is free, and shows one nudge (an in-app toast, plus a browser notification if allowed). Clicking it opens a focus-mode session: a goal line, then up to five questions, each with a confidence rating and an optional "why", a hint, "show me first", feedback that cites the slide with the slide beside it, "keep going", and resume. Wrong, "don't know" and low-confidence answers become "ideas to revisit" that come back later in a short retest. Sessions run on one of two engines: **scripted** (authored JSON question sets, the default, needs no key) or **LearnHarness** (real generated teaching, needs a model key and seeding, never run against a real model in this repo). A facilitator panel drives every journey on demand for user testing.

### How it works

```mermaid
flowchart LR
    subgraph Browser["Laptop browser: /app (components/lockedin)"]
        UI[Today · Library · Lecture · Session · Progress · Me · Welcome · Facilitator]
        Tick[30 s poll: /nudges/due]
    end
    subgraph Server["Next 16 server (one process, one student)"]
        Routes[app/api/companion/* one-line routes]
        Svc[CompanionService\nsrc/server/companion/service.ts]
        Core[Pure rules\nsrc/core/companion/*]
        Store[(JSON files\ndata/companion/*)]
        Scripted[Scripted engine\ncompanion/content/*/questions.json]
        LHE[LearnHarness engine\nengines/learnharness.ts → lh-port.ts]
        LH[LearnHarness turn loop\nsrc/server/chat-handler.ts]
    end
    UI --> Routes
    Tick --> Routes
    Routes --> Svc
    Svc --> Core
    Svc --> Store
    Svc --> Scripted
    Svc --> LHE --> LH
```

- **Import law.** Pure rules in `src/core/companion/` (no IO), IO in `src/server/companion/`, one-line routes in `app/api/companion/` via `companionRoute`, enforced by lint. `lh-port.ts` is the only file that calls engine internals. Tunable numbers and nudge wording live only in `policy.ts`.
- **Screens are in `components/lockedin/`**; the files under `app/(lockedin)/` are 5–8 line wrappers.
- **Storage.** `${LH_DATA_DIR:-data}/companion/`: `profile.json`, `lectures.json`, `blocks.json`, `sessions.json`, `misses.json`, `demo.json`, `runtime.json`, append-only `nudges.jsonl` and `events.jsonl`, `materials/<lectureId>/`. One student per data directory; no login; localhost only (`store.ts:6-8`, `API.md`).
- **Nudges** are decided by pure rules (`nudges.ts`: free gaps, quiet hours, daily cap, priority block → N-4 → N-1 → N-3 → N-2, pre-warming) but are only *delivered* while a browser tab is open, because the tick is a client poll (`shell.tsx:58`). Nothing fires when the app is closed.
- **Sessions.** `POST /sessions` returns at once; the engine prepares in the background and the screen polls (B-3). The LearnHarness path sends an opening message with the slides inlined, waits for a pending `quiz` or `ask_user_question`, grades on the server, and maps the chat record to a `SessionView` (`view-mapper.ts`).

### What it ships

Status: **UI** = works in the app; **API** = server only, no screen; **core** = pure logic only.

| Feature | Status | Where | Evidence |
|---|---|---|---|
| Three-step onboarding (modules → calendar → nudges a day), "What I read", try-now card | UI | `screens/welcome.tsx`, `service.ts:205-236` | AE2-P14, AE2-1, AFF-G, Q-10, R-7 |
| Today: hero card (nudge → active session → welcome back → try now → today's lecture), lectures, next block | UI | `screens/today.tsx` | AFF-F, Q-1, R-4 |
| Nudges N-1 to N-4 and block start, toasts with Open / Later / dismiss / "I wasn't there" | UI (tab open only) | `nudges.ts`, `shell.tsx:34-111` | Q-8, Q-9, R-1, R-3, R-5, LIT-4 |
| Browser desktop notifications (opt-in) | UI (tab open only) | `shell.tsx:38-45`, `me.tsx:47-54` | R-1 |
| Session focus mode: goal, question, confidence, why, hint, show me first, feedback, keep going (+3), stop, resume, keyboard keys | UI | `screens/session.tsx`, `service.ts:609-854` | AE2-5, AE2-8, Q-7, AE2-P8, AFF-B |
| Slide panel beside the question (Markdown text of the slide) | UI | `session.tsx:278-290`, `slides.ts` | INT-01-g |
| Library and lecture pages, search over lecture and slide titles | UI | `screens/library.tsx`, `screens/lecture.tsx`, `progress.ts:97-104` | INT-01-e, INT-01-f |
| Concept maps (mermaid) per lecture, statuses from answers and misses | UI | `concept-map.tsx`, `core/concept-map.ts`, `content/*/map.mmd` | INT-01-e |
| Progress: this week, ideas to revisit, roadmap, welcome back; no streaks | UI | `screens/progress.tsx`, `progress.ts` | R-6, INT-01-i, LIT-23 |
| Misses and spaced retests (1/3/7 days) | UI | `misses.ts` | AFF-E, AE-8, C-6 |
| "Focus" palette: one seed hue → OKLCH theme, light/dark/system/high contrast, module hues, text size, spacing, reduce motion, live preview | UI | `palette.ts`, `root.tsx`, `me.tsx:63-93` | AE2-P10, deck slides 18, 21, 22 |
| Settings: nudges a day, default mode, quiet hours, evening time, notifications | UI | `screens/me.tsx` | R-1, Q-7 |
| Delete all my data | UI | `me.tsx:133-142`, `store.ts:232-250` | R-7 |
| Calendar: `.ics` file and subscription link (guarded fetch), manual refresh | UI | `timetable.ts`, `calendar-fetch.ts` | Q-10 |
| Study blocks (max 2) and simulated lock (off / gentle / firm) | **API + core only** | `blocks.ts`, `service.ts:397-452` | LIT-3, LIT-10, LIT-11, X-7 |
| PDF slide upload → `slides.md` | **API only, demo-gated** | `service.ts:382-393` | INT-01-g |
| Facilitator panel: scenarios, demo clock, fire nudges, engine switch, participant, event log, CSV | UI (`COMPANION_DEMO=1`) | `screens/facilitator.tsx`, `/demo/*` | T23 |
| Event log (23 event types), CSV export | API | `service.ts:111-130`, `csv.ts`, `types.ts:306-330` | Rubric 3 |
| Scripted and LearnHarness engines, optional declared fallback | API + facilitator UI | `engines/*`, `default.ts:36-39`, `service.ts:675-679` | Option D, B-2, B-11 |

Tests: 12 `tests/companion-*.test.ts` files (rules, nudges, palette, question parity, opening message, service journeys J1–J6 on the scripted engine, routes, LearnHarness engine over a fake port and over the real turn loop with a fake model). Run `npm run companion:check`, then `npm run typecheck`, `npm run lint`, `npm test`. CI runs all of them plus `npm run build` and the seed.

### What is missing or wrong in v0.0

These are verified against the code (file:line), not inferred.

**A real student gets almost nothing.**
- **Imported lectures never have material.** Calendar lecture ids are `${code}-${date}-${time}` (`timetable.ts:207`) and never match a content folder, so `hasMaterials` is false: no N-1 (`nudges.ts:161-163`), "Quiz me" is disabled, no try-now, nothing to retest.
- **Slides can only be added through a demo-gated route with no screen**, one lecture *occurrence* at a time (`materials/[lectureId]/route.ts`).
- **Modules come only from the sample timetable** (`service.ts:308-311`); an import **replaces** all lectures and loses "I wasn't there" (`service.ts:246`).
- **All 7 lectures are placeholder drafts** (`companion/content/*/slides.md:3`, B-14).
- **The real engine is off.** `COMPANION_ENGINE` defaults to `scripted`; no `settings.json`, no seeded prompts, placeholder model ids in `companion/seed/settings.json:4-6`. The 16 Nov checkpoint table (`CHECKPOINT.md`) is blank.

**The teacher's diagrams and maths don't render.** The seeded formatting prompt tells the teacher to use mermaid and LaTeX (`companion/seed/prompts/shared/40-formatting.md`), but `components/lockedin/prose.tsx` renders only paragraphs, lists, bold/italic/code and slide chips. Diagrams and `$…$` appear as raw text.

**No phone.** The 16 Nov decision (phone starts, laptop teaches) has no implementation: no phone UI, no push, no hand-off. Nudges only arrive while a laptop tab is open.

**Blocks and the lock have no screen.** Today says "Add one in Me" (`today.tsx:140`); Me has no block or lock control. No Sunday checklist, no weekly hours, no notion of routine.

**Calendar parser gaps.** TZID ignored, floating times read in the server's zone (`timetable.ts:136`); only `FREQ=WEEKLY`; BYDAY, EXDATE, RECURRENCE-ID and DURATION ignored; all-day events skipped; no automatic refresh although the UI says "It refreshes when you open the app" (`welcome.tsx:46`); unmapped events shown only as a count.

**Session gaps.** Only single-select answers (`session.tsx:81` ignores `question.multi`); the slide PDF is never rendered (pdfjs unused); "Quiz me on this" from a concept-map node is not scoped to the node (`lecture.tsx:88,96`); nothing writes a `map.mmd`, although the lecture page says "your first teaching session refines it" (`lecture.tsx:71`).

**Engine capabilities not reachable from `/app`.** ChatGPT sign-in (works in the web build, same machine only), Deepgram dictation, API keys and model choice, the full Markdown/KaTeX/mermaid renderer (`components/host-markdown.tsx`), notes import into the knowledge graph. None has an entry point in `/app`.

**Desktop app is upstream's.** Electron opens the engine UI at `/`, not `/app`; appId, product name, update feed (`amosblomqvist/learnharness`), mic prompt text and notarisation team id are LearnHarness's; no `COMPANION_*` env; no seeding of prompts; `notifications` missing from the permission allow-list (`electron/main.cjs:384`).

**Smaller defects and stale copy.** "What I read" labels a link as "(.ics)" (`timetable.ts:218`); `WELCOME_BACK_DAYS` comment says six, value is five (`policy.ts:83`); hardcoded "22:00 and 08:00" in onboarding (`welcome.tsx:142`), "3 questions… about 3 minutes" (`welcome.tsx:164`, `today.tsx:70`) and "5 questions, about 10 minutes" (`today.tsx:73`) instead of `policy.ts`; a hard-coded slide colour (`session.tsx:285-286`); the facilitator is linked from the rail despite the plan (`shell.tsx:85-89`); the env example turns `COMPANION_DEMO=1` on; docs describe an `app/m` phone UI that does not exist (`docs/companion/README.md:5`, `types.ts:6`); `mvp1-plan.md` says "Nothing in here is built yet" and was never merged.

**No UI tests**, no recorded real-engine chat fixture (`tests/fixtures/companion/` absent).

### Evidence that v0.0 was built against

`plan.md` §15 maps each feature to its findings. The decisions in force were the 8 and 10 Nov group decisions (start-first, cap of 1–2 nudges, timetable and slides only, both teaching modes, option D: keep the engine and cut its setup, onboarding after a first taste). v0.0 predates the 16 Nov sync (phone/laptop split), T20 v2 (18 Nov), the UI research for the lo-fi (18 Nov), the literature review LIT-13–LIT-23 (19 Nov) and the device-split QOC (19 Nov); v0.1 brings those in.

---

## v0.1: phase A, as shipped (24 Nov 2026)

Tag `lockedin-v0.1`. The design is [`v0.1-spec.md`](v0.1-spec.md); the click-by-click guides are in [`demos/`](demos/) (stages 1 to 13).

### What it ships
- **Connect your AI** on screen 1 (a ChatGPT sign-in or an API key), with a model per engine slot and "Choose for me" (V-3, V-15, V-16).
- **Calendar first:** a timetable link or file, modules read from it, including Birmingham's feed (V-17, F-108).
- **Your own material:** upload in any shape, units proposed by file name, headings or the AI (V-18, F-104).
- **Study packs** per unit: a concept map, explainers with diagrams, and a question bank that is also the no-AI fallback (V-6, F-105, F-106).
- **Rich teaching text:** diagrams, maths and tables in sessions (F-103).
- **The weekly plan:** a routine learned in an optional chat, proposed study blocks, a Sunday check-in (V-4, V-5, F-109 to F-111).
- **The phone:** a relay on Cloudflare and an installable web app. One question in a notification, then the laptop continues (V-1, V-2, V-11, F-112).
- **Dictation** in the "why" box, **calm motion** with a setting, and the facilitator's tools (F-116, F-118, F-119).

### What was missing or wrong
Found in real use on 23 and 24 Nov and listed in [`v1.0-issues.md`](v1.0-issues.md). Phase B (the desktop app, the calendar feed out, PDF pages in the slide panel) was not started.

---

## v1.0: what was broken, fixed (24 Nov 2026)

Tag `lockedin-v1.0`. The plan is [`v1.0-plan.md`](v1.0-plan.md); what was fixed, how it was checked and the test checklist are in [`v1.0-release.md`](v1.0-release.md).

### In one paragraph
Every issue in the v1.0 list that fails, misleads or corrupts data is fixed, and nothing is redesigned or packaged (V-19). Sessions on a student's own notes reach question 1. The slide panel shows the real PDF page. Study packs survive a dropped connection. "Week 0" and the sample lectures no longer sit beside real content. The iPhone install is guided and keeps its pairing. The event log counts each action once. The build output holds no participant data.

### What changed in how it works
- **Sessions:** the "Next question, please." safety net also runs before question 1, and a retry waits for question 1 again (`engines/learnharness.ts`, `service.ts`). A failed session can restart on the lecture's question bank (`POST /sessions/:id/practice`).
- **Material:** the uploaded PDF is kept (the reader was emptying it), and `GET /materials/:id/pages/:n` serves a picture of a page, drawn by the engine's PDF renderer through `lh-port.ts` and kept in `materials/<id>/pages/`.
- **Study packs:** a stage is retried after 10, 30 and 90 seconds; while the AI connection is down the pack waits and the queue behind it stays queued; interrupted packs resume at the next start (`study-pack.ts`).
- **Units:** a week of 0 reads "Week not set" (`weekLabel`), `PUT /lectures/:id/week` sets it, and a unit needs 500 characters of text.
- **Phone:** `GET /v1/manifest?pair=…` on the relay carries the pairing into the installed iPhone app (`relay/README.md`).
- **Elsewhere:** `/` redirects to `/app`; deadline events are never lectures; the demo clock needs `COMPANION_DEMO=1`; Next.js 16.4.6.

### What is still missing
- **v2.0:** Teach and Practice as modes, teaching by idea, notes versus slides, progress as a picture, a short Me ([`v2.0-direction.md`](v2.0-direction.md)).
- **v3.0:** the desktop app, the relay on a team account, code clean-up, and one name and shape per event.
- **Not yet confirmed on a device:** the iPhone install and a real notification (P-1, P-2).
