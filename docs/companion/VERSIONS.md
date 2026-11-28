# LockedIn version history

Each version records what it ships, how it works, what is missing, and the evidence behind it. Evidence IDs (`Q-n`, `INT-0n-x`, `AE-n`, `AE2-n`, `AE2-Pn`, `AFF-x`, `X-n`, `C-n`, `LIT-n`, `R-n`, `N-n`) are indexed in the team repository (`kayzisland/hcidesignchallenge`, `research/findings-register.md`); rules `R-1`–`R-9` and nudges `N-1`–`N-5` are in its `define/behaviour-change.md` (T20 v2).

**Naming.** Versions are `v0.0`, `v0.1`, …; git tags are `lockedin-v0.0`, `lockedin-v0.1`, … (never a bare `v*` tag: the engine's desktop release tooling reserves those, `SDLC.md`). The PLAN.md freeze tag `hifi-v1` will point at whichever LockedIn version is frozen for the hi-fi test.

| Version | Date | Git | Status | Spec |
|---|---|---|---|---|
| **v0.0** | 14 Nov 2026 | `6ff961b` on `main`, tag `lockedin-v0.0` | Shipped (laptop web app at `/app`) | [`plan.md`](plan.md), `mvp1-plan.md` (branch `docs/mvp1-plan`), [`DECISIONS.md`](DECISIONS.md) B-1–B-15 |
| **v0.1** | 24 Nov 2026 | `99f701d` on `main`, tag `lockedin-v0.1` | Phase A shipped as built (stages 1–13, 23–24 Nov). Its known issues are the v1.0 list | [`v0.1-spec.md`](v0.1-spec.md), [`DECISIONS.md`](DECISIONS.md) V-1–V-18, [`demos/`](demos/) |
| **v1.0** | 24 Nov 2026 | tag `lockedin-v1.0` on `main` (PR #6) | Shipped: everything broken in v0.1 is fixed; no redesigns, no packaging (V-19). Awaiting Jiven's own test and the iPhone check | [`v1.0-release.md`](v1.0-release.md), [`v1.0-plan.md`](v1.0-plan.md), [`v1.0-issues.md`](v1.0-issues.md), [`DECISIONS.md`](DECISIONS.md) V-19–V-31 |
| **v1.0.1** | 24 Nov 2026 | tag `lockedin-v1.0.1` on `main` | Two bugs from Jiven's first test: diagram labels can no longer be a syntax error, and the relay is deployed with the v1.0 phone app | [`v1.0-release.md`](v1.0-release.md) section 6 |
| **v1.0.2** | 24 Nov 2026 | tag `lockedin-v1.0.2` on `main` | The iPhone install no longer depends on Safari re-reading the manifest, and an unpaired Home Screen app can take the pairing link | [`v1.0-release.md`](v1.0-release.md) section 7, `relay/README.md` |
| **v1.0.3** | 24 Nov 2026 | tag `lockedin-v1.0.3` on `main` | Pairing by a 6-digit code: one clear panel on the laptop, and the iPhone's Home Screen app asks for the code (V-32). Replaces the manifest routes of v1.0 and v1.0.2 | [`v1.0-release.md`](v1.0-release.md) section 8, `relay/README.md` |
| **v1.0.4** | 24 Nov 2026 | tag `lockedin-v1.0.4` on `main` | "Send a test question to my phone" in Me → Phone; a retest no longer spends the day's notification before a lecture whose material is in course units | [`v1.0-release.md`](v1.0-release.md) section 9 |
| **v1.1** | 24 Nov 2026 | tag `lockedin-v1.1` on `main` | Progress as a learning score over time with module attribution, attention on gaps and milestones; the Week page as a timetable whose study blocks can be dragged (V-34 to V-38). The first slice of the v2.0 polish | [`v1.1-release.md`](v1.1-release.md), [`v1.1-plan.md`](v1.1-plan.md), [`v1.1-research.md`](v1.1-research.md) |
| **v1.1.1** | 24 Nov 2026 | tag `lockedin-v1.1.1` on `main` | Four defects in v1.1: a study block can be started (Start, or its notification), a stopped session is offered again on Today, confidence is four taps with none preselected, and a block names its first step (V-44) | [`v1.1-release.md`](v1.1-release.md) section 6 |
| **v2.0** | 25 Nov 2026 | tag `lockedin-v2.0` on `main` | Shipped: Learn and Practise as two modes, gaps by idea with new questions written around them, three notes per module that the tutor reads and the student can edit, and a first run on the student's own material (V-39 to V-67). The phone, diagrams, Me and motion moved to v2.1 (V-67) | [`v2.0-plan.md`](v2.0-plan.md), [`v2.0-direction.md`](v2.0-direction.md), [`DECISIONS.md`](DECISIONS.md) V-39 to V-67 |
| **v2.1** | 27 Nov 2026 | tag `lockedin-v2.1` on `main` (PR #14) | Shipped: the phone brought closer to the lo-fi. A question's round carries on on the phone, a study block opens and moves on the phone, and the week and Settings are on the phone and hold with the laptop closed (V-68 to V-70). The other v2.1 items moved to v3.0 (V-70) | [`v2.1-plan.md`](v2.1-plan.md), [`DECISIONS.md`](DECISIONS.md) V-67 to V-70 |
| **v2.2** | 27 Nov 2026 | tag `lockedin-v2.2` on `main` (PR #16) | Shipped: what the lo-fi test (T18) changes in the features. A shorter notification, "notifications" for "nudges", Move and Remove on every block, "Re-plan the rest of my week", and "Where are you?" as an option on a study block with its questions on the move (V-71 to V-75). Jiven ran the checklist on his iPhone on 27 Nov | [`v2.2-plan.md`](v2.2-plan.md), [`DECISIONS.md`](DECISIONS.md) V-71 to V-75 |
| **v2.3** | 27 Nov 2026 | tag `lockedin-v2.3` on `main` (PR #17) | Shipped: a phone that can be used by itself. A block opens from the phone's week, "Practise" on the phone's home screen, maths drawn on the phone, and Today on the laptop says what was answered on the phone (V-76 to V-79). Jiven checked it on his iPhone on 27 Nov | [`v2.3-plan.md`](v2.3-plan.md), [`DECISIONS.md`](DECISIONS.md) V-76 to V-79 |
| **v3.0** | 27 Nov 2026 | tag `lockedin-v3.0` on `main` (PR #18) | The Blocks look on the laptop and the phone, in light and dark, with one colour system; diagrams drawn by LockedIn; Me in a few lines; the phone's week as a day strip and a timeline (V-80 to V-85). | [`v3.0-plan.md`](v3.0-plan.md), [`DECISIONS.md`](DECISIONS.md) V-80 to V-85 |
| **v3.0.1** | 28 Nov 2026 | tag `lockedin-v3.0.1` on `main` (PR #19) | Fixes from Jiven's own run-through of v3.0: Today, Week and Progress fit one screen; Progress as blocks with side panels; the Learn plan without dashes; the Library says a week once; page changes fade in (V-86 to V-88). Laptop only: no relay deploy | [`DECISIONS.md`](DECISIONS.md) V-86 to V-88, and its section below |
| **v3.1** | 28 Nov 2026 | branch `feat/v3.1`, tag `lockedin-v3.1` once merged | "Learn that teaches": a Learn session opens on what the student wants, with an optional check and "Where you are"; written and worked answers marked by the tutor; the whole module in reach; attachments; Practise questions that stand on their own; several files and web pages as material (V-89 to V-96). Laptop only: no relay deploy | [`v3.1-plan.md`](v3.1-plan.md), [`DECISIONS.md`](DECISIONS.md) V-89 to V-96 |
| **v3.1.1** | 28 Nov 2026 | branch `fix/v3.1.1`, tag `lockedin-v3.1.1` once merged | What using v3.1 showed: one plan that carries the check's levels, named stages in Learn, a unit's weeks as a range and changeable, an enlarged diagram that fills the window, maths ending in `\}` rendered, Speak beside every writing box | Part C of v3.1 |
| **v3.2** | 28 Nov 2026 | branch `feat/v3.2`, tag `lockedin-v3.2` once merged | Pictures that build up: an explainer or a tutor's diagram arrives a step at a time in the Blocks look, with one block to guess first; chosen from four working designs | "Change it and see" and "Two cases compared"; old explainers stay still pictures |
| **v4.0** | later | — | Not specified yet: the desktop app that students download, the relay on a team account, code clean-up | — |

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

---

## v1.1: progress that means something, and a week you can move (24 Nov 2026)

Tag `lockedin-v1.1`. The plan is [`v1.1-plan.md`](v1.1-plan.md), the evidence behind it [`v1.1-research.md`](v1.1-research.md), and what shipped, how it was checked and the test checklist are in [`v1.1-release.md`](v1.1-release.md).

### In one paragraph
Progress stops being a second copy of the Library. It is now the history of what the student has learned: one learning score, drawn over the week, month or term against a steady-pace line, with the modules it came from, the gaps that need attention and fifteen milestones that are kept once earned (V-34 to V-36). The Week page is a timetable: lectures and commitments sit at their real times, and study blocks can be dragged to any free time or day (V-37). A visible score departs from the team's earlier decision to drop points (T20, R-6); it is recorded as Jiven's decision and owed a design-log entry.

### What changed in how it works
- **The score is replayed, not stored.** `replayScore` (`src/core/companion/score.ts`) reads the event log and the study blocks and works the score out again each time, so it can never drift from the history and the numbers can be changed in one place (`SCORE_RULES` in `policy.ts`).
- **Milestones are stored** the first time they are earned (`milestones.json`, event `milestone_earned`), so a later change to the rules can't take one away.
- **Study blocks carry a module** (`StudyBlock.module`, event `plan_module_set`). "Plan my week" gives each new block the module of the unit it studies; the student can change it.
- **A block can't land on a lecture.** `placementProblem` (`plan-week.ts`) is the one rule; the timetable uses it for the fast answer and `PUT /blocks/:id` uses it for the real one (`409 block_overlaps`).
- **`GET /progress` is a new shape** and `GET /plan` gained `quietHours` and `modules` ([`API.md`](API.md)).

### What is still missing
- **Not in v1.1:** stretching a block by dragging its edge, and adding a block by clicking an empty slot.
- **Still open from the same feedback:** a chapter that spans several weeks, and timetable week numbers that match the university's (V-38 hides them on Progress; it does not renumber them).
- **v2.0:** Teach and Practice as modes, teaching by idea, LockedIn-drawn visuals (V-33), a short Me ([`v2.0-direction.md`](v2.0-direction.md)).
- **v3.0:** the desktop app, the relay on a team account, code clean-up.
- **Owed to the group:** the design-log entry for the score and milestones, and `LIT` ids for the eleven sources in the research note.

---

## v2.0: two ways to study, and a first run on your own slides (25 Nov 2026)

Tag `lockedin-v2.0`. The plan is [`v2.0-plan.md`](v2.0-plan.md) (steps 1 to 7 of it), the design and its reasons [`v2.0-direction.md`](v2.0-direction.md), the decisions [`DECISIONS.md`](DECISIONS.md) V-39 to V-67.

### In one paragraph
A session is now one of two things, and says which. **Learn** is the AI tutor: it asks a guess or two, shows a plan of ideas, teaches each one on one calm screen a step at a time, takes typed or spoken questions at any point, draws a picture when one helps, never ends by itself and is picked up where it stopped. **Practise** is a quick round from the question bank, mixed across a module's ideas and difficulties and weighted to gaps. What a student got wrong is kept by idea, an idea closes after two sure right answers on different days, and "Practise this idea" writes new questions around the gap. LockedIn keeps three short notes per module (how you learn it, where you are, the last plan), hands them to the tutor and shows them to the student. A new student signs in with one button, pastes a timetable link or adds modules by hand, drops slides in, picks when they have energy and one weekly total, and ends on Learn on their own first unit. The release was cut here, after step 7 of 14, at Jiven's decision (V-67).

### What changed in how it works
- **A session has a mode** (`SessionSpec.study`, `spec.learn`). Anything the tutor runs is Learn; anything on the bank is Practise. The short AI quiz of v1 is gone (V-55).
- **Learn** is `src/core/companion/learn.ts` (the opening message, the chat record as steps, the plan) over the LearnHarness engine, with LockedIn's own prober and teacher instructions (`companion/seed/prompts`). The tutor's picture, demo and look-up tools are on.
- **Gaps** are `gaps.ts`: per idea, closed by `closeGaps` (V-43). `StudyPacks.writeForIdea` writes new questions for one idea.
- **Notes** are `notes.json` per data folder (`notes.ts`), rewritten after each Learn session on the cheap model, capped, editable, removed by "Delete all my data".
- **The first run** is `SetupView` (`GET /setup` and `/setup/*`): a profile made by setup is not `onboarded` until its end. Modules can be added by name, slides are saved without the checklist, each planned block records what put it there (`StudyBlock.placed`), and a module has a share of the week (`ModuleInfo.share`).
- **New and changed calls** are in [`API.md`](API.md): `/learn`, `/sessions/:id/say|finish|steps|how`, `/modules/:code/notes|share|materials/quick`, `/modules`, `/setup/*`, `/gaps`, `/practise`.
- **The phone relay is unchanged** from v1.1.1: no deploy is needed for this release.

### How it was checked
- 985 companion tests, the type check and lint, and the full suite in CI.
- Each screen in Chrome with real clicks and typing, on a copy of Jiven's data or an empty data folder.
- Learn, the notes, "Practise this idea" and the first run against the real AI on Jiven's ChatGPT sign-in.
- Jiven's own run on his six modules on 25 Nov, which found two faults, both fixed before release: a finished picture did not show while a question was open, and the tutor's next question took the keyboard mid-sentence.

### What was not checked
- Speaking to the tutor (no voice key on the test copies), an interactive demo and a web look-up (the tutor did not choose to make either), and a session long enough to be summarised.
- Signing in to ChatGPT from a signed-out state, pasting a real timetable link, and the phone step of setup with a real phone.
- "Same as my other modules" with the real AI.
- Whether students like any of it: that is the hi-fi test.

### What is still missing
- **Moved to v2.1 (V-67), in this order:** the phone (the Practise round continuing on the phone, "why now" in the notification, four confidence taps, the block notification naming its first step, "next free gap"); diagrams drawn by LockedIn (the concept map, the session plan, explainers); Me in a few lines with "Advanced", and the clutter list; motion.
- **Later, not in v2.1:** Today as one next step, the Week screen's Undo, add and calendar export, and Your courses (one drop for everything, chapters that span weeks, real week numbers).
- **Known and small:** the planner fills the earliest days first; the session plan is a plain list until it is drawn; `/api/stt/token` is asked for even with no voice key; Today's card for a week-long session shows its first lecture's title; Practise's done screen has no "Learn this".
- **Owed to the group:** design-log rows for V-41, V-45, V-46, V-48 and V-49, and a `LIT` id for interleaving.

---

## v2.1: the phone, closer to the lo-fi (27 Nov 2026)

Tag `lockedin-v2.1`. The plan, with the lo-fi wording each screen uses, is [`v2.1-plan.md`](v2.1-plan.md); the decisions are [`DECISIONS.md`](DECISIONS.md) V-67 to V-70.

### In one paragraph
The phone now does what the team's lo-fi v13 shows it doing, outside the four choices the lo-fi test was run to settle. The notification says why it came. After the first question the student chooses: carry on on the laptop, keep going on the phone, or stop, and what is left is saved with "Nothing is overdue". A study block's notification opens the block on the phone, where it can be started, opened on the laptop, or moved to a later time. The week is on the phone: move, remove with Undo, add, "Looks good". Settings on the phone set notifications per day, and 0 stops them at once. Changes made on the phone hold with the laptop closed.

### What changed in how it works
- **A question carries its round** (`phone-round.ts`, `ScheduledNudge.round`): the rest of the questions travel with the first one, and the laptop opens the same round at the next question.
- **The relay moves things itself** (`relay/src/relay.ts`): a moved block's notification is re-timed on the relay, the week is edited there, and 0 notifications a day is enforced there.
- **The relay takes larger uploads** and tells the laptop its limits, so an older relay or phone still works with a newer partner.
- **New and changed calls and events** are in [`API.md`](API.md) and `relay/README.md`.

### How it was checked
- 1,053 companion tests: the rules, the laptop against the real relay code, and the phone app run in a simulated phone.
- Every new phone screen in Chrome at phone size against a stand-in relay.
- The relay was deployed on 25 Nov and Jiven tried the phone app on his iPhone on 26 Nov. He reported no functional fault, and that the phone app looks plain.

### What was not checked
- No written checklist was run on the iPhone: which screens were opened on 26 Nov is not recorded.
- Whether students like it: that is the hi-fi test.

### What is still missing
- **Decided by the lo-fi test, for v2.2:** answering on the lock screen, "Where are you?", focus levels, and the smaller findings (LF-1 to LF-21).
- **Moved to v3.0 (V-70):** the phone's look, Me in a few lines with "Advanced", the clutter list, icons, motion, and diagrams drawn by LockedIn.
- **v4.0:** the desktop app.

---

## v2.2: what the lo-fi test changed (27 Nov 2026)

The plan, with each finding and what became of it, is [`v2.2-plan.md`](v2.2-plan.md); the decisions are [`DECISIONS.md`](DECISIONS.md) V-71 to V-75.

### In one paragraph
The lo-fi test (T18, four testers, 25 Nov) reported on 27 Nov, and v2.2 makes the feature changes it points to. The notification is shorter. "Nudge", which a tester had to ask about, is "notification". Moving a block no longer needs explaining: Move and Remove are on every block on the phone, and the laptop says blocks can be dragged. A study block's start can be told where the student is, as an option: bed or café asks "now or later?", and on the move the block's questions can be answered on the phone one at a time. One request from the look test is built too: "Re-plan the rest of my week". Answer buttons on the lock screen and focus levels were tested in the lo-fi and are not built; a web app cannot do either.

### What changed in how it works
- **A block that is near carries its questions** (`PhoneBlockLines.round`, `svc.phoneBlockRound`): up to five from its unit's bank, for today's and tomorrow's blocks, dropped from the furthest block first if the week would not fit the relay (`fitBlocks`).
- **The phone remembers what it has asked of a block** (its own storage), so a block moved after two answers carries on at the third.
- **The place is one new phone event,** `block_where`. The laptop writes it to the event log and does nothing else with it.
- **The re-plan is a pure rule** (`openBlocks`, `replanWeek` in `plan-week.ts`) behind `POST /plan/replan`; `DELETE` undoes it on the day it was made.
- **The relay needs a deploy:** it must accept `block_where`, and the deploy publishes the phone app's new screens.

### How it was checked
- 1,099 companion tests: the re-plan as tables of cases and through the service, the block's questions and the place event against the real relay code, and every new phone screen run in a simulated phone.
- The phone screens in Chrome at phone size against a stand-in relay with made-up questions: the chips, bed's "now or later?", two answers on the move, the rest moved, the week, Settings.
- The Week screen in Chrome on a copy of Jiven's own data: seven unstarted blocks moved (three into next week), the line still there after a reload, and Undo putting all seven back. Progress's link opens the week.

### What was not checked
- Jiven ran the plan's ten-step checklist on his iPhone on 27 Nov, after the relay deploy, and reported that it "looks good". Step 6 as written was wrong: a block cannot be opened from the phone's week, only from its notification.
- The notification's new wording was checked in the simulated service worker only, not as a real notification.
- The reasoning box's new wording and Me's renamed settings were not opened in Chrome; they are text changes covered by the type check.
- Whether students want any of it: that is the hi-fi test.

### What is still missing
- **Declared, needing a native app:** answer buttons on the lock screen (LF-1), focus levels and the shield (LF-5 to LF-7).
- **Asked for and not built:** a study circle or leaderboard (LF-15), a question in any free gap for courses without lectures (LF-17).
- **Raised by Jiven after the checklist (27 Nov):** a block on the phone's week cannot be opened, only moved or removed; the week is a long list, not a calendar; the phone has no way to start questions by itself; and the phone shows maths markup as raw text.
- **v3.0:** the look, on the laptop and the phone. **v4.0:** the desktop app.
- **Owed to the group:** design-log rows for V-71 to V-75, each of which acts on a finding before T19 has agreed it.

---

## v2.3: a phone you can use by yourself (27 Nov 2026)

The plan is [`v2.3-plan.md`](v2.3-plan.md); the decisions are [`DECISIONS.md`](DECISIONS.md) V-76 to V-79.

### In one paragraph
After the v2.2 check on his iPhone, Jiven found the phone too thin: a notification, a list of blocks, and nothing to start by yourself. v2.3 lets the phone be opened and used. A block's line in the week opens the block. A "Practise" card on the home screen has a button per module and asks five questions at a time, from ten the laptop leaves on the phone for each module. Maths in a question is drawn. On the laptop, Today says what was answered on the phone that day, and a unit answered only on the phone no longer reads "not started".

### What changed in how it works
- **The upload carries a pool per module** (`RelaySchedule.practise`, `svc.phonePractise`): what the laptop's own Practise would ask next. The relay stores it beside the week and never reads it; its limit for the week went from 60,000 to 200,000 characters, and the laptop trims the pools to whatever limit the relay reports (`fitPractise`).
- **The phone remembers what it has asked from a pool,** and forgets when the laptop sends a different one.
- **Maths on the phone** is KaTeX, the library the laptop uses, copied into `relay/web/vendor/` by `relay/scripts/vendor.mjs` when the relay is deployed and kept by the service worker for offline use. The phone follows the laptop's rule for what counts as maths, so prices stay words.
- **Units answered on the phone are kept as a list** (`runtime.phoneAnsweredLectures`), filled once from the log on an older install, so a unit's standing never means reading the whole log.
- **The relay needs a deploy.**

### How it was checked
- 1,147 companion tests: the pools and their fit, the relay keeping a pool through a change to the week, the Today line and a unit's standing as tables of cases, and every new phone screen run in a simulated phone.
- The phone in Chrome at phone size against a stand-in relay, with the real maths library: the Practise card, a round with maths in the question, its options and its explanation, a formula on its own line, a price left as words, a block opened on another day and on its own day.
- On a copy of Jiven's data: the pools the laptop would send (two modules, ten questions each, about 10,000 characters), and the Today line in Chrome.

### What was not checked
- Jiven reported on 27 Nov that he had run the plan's iPhone checklist after the relay deploy. Which steps he ran, and what step 8 (maths and Practise with no connection) showed, is not recorded.
- Maths with no connection was not tried: the files are kept for it, but only a real phone in flight mode shows whether it works.
- None of Jiven's 127 bank questions contains maths today, so maths was only seen on made-up questions.

### What is still missing
- **Not chosen (V-78):** carrying a half-done round between phone and laptop, and a faster check between them. The laptop hears from the phone once a minute while LockedIn is open.
- **A notification cannot draw maths:** a question with maths in it shows its markup on the lock screen, and is drawn once opened.
- **v3.0:** the week as a calendar and the phone's look. **v4.0:** the desktop app.

---

## v3.0: the Blocks look (27 Nov 2026)

The plan, with each screen and what was changed from Blocks as drawn, is [`v3.0-plan.md`](v3.0-plan.md); the decisions are [`DECISIONS.md`](DECISIONS.md) V-80 to V-85.

### In one paragraph
The look test showed four complete looks for the same screens, and all three testers chose Blocks for the whole app. v3.0 rebuilds the laptop app and the phone app in it: thick ink outlines, a hard shadow on anything that can be pressed, a tab bar across the top, filled pictograms beside words, and a panel in a module's colour for the next step. It is changed where testers said Blocks was wrong: a wrong answer is a calm lilac card, there is no yellow by default, Progress keeps its rising line, and in Learn the text is read before the question. Every colour now means one thing and is defined once, for the laptop, the phone and the diagrams. The concept map is drawn by LockedIn as rows of blocks. It was built on three testers, where the rule written before testing asked for four of five.

### What changed in how it works
- **One colour system** (`src/core/companion/look.ts`): the colours in light, dark and high contrast, the module colours and shapes, and the CSS for the laptop (`lookCss`) and the phone (`phoneLookCss`, written into `relay/web/styles.css` by `relay/scripts/look.ts`). The one-hue generator in `palette.ts` is gone; a theme colour picked before v3.0 is read and ignored.
- **A module's colour** is its place in the student's list, or the one picked in Me (`ModuleInfo.colour`, `PUT /modules/:code/colour`). `<Tint module>` gives a region that colour; `ModuleMark` draws its shape. The phone is sent the colour by name.
- **The map's layout is a pure rule** (`map-layout.ts`: `layoutMap`, `linkPath`, `studyOrder`, `parseSimpleFlow`), drawn by `blocks-map.tsx`. Mermaid is still loaded for diagrams that are not plain boxes and arrows.
- **The phone's week** is rebuilt (`weekSection` in `relay/web/app.js`); the week sent to the phone gained each lecture's length, and the target and kept minutes.
- **The relay needs a deploy** for the phone's look. It has no new rule of its own.

### How it was checked
- 1,219 companion tests. New: the colour rules (meanings, distance between colours, contrast of text on every colour in each mode, no colour written outside `look.ts` on the laptop or the phone), the map layout on every map in the repository and 500 generated ones, the stylesheets parsing, picking a module's colour, and the phone's week.
- In Chrome, light and dark, on a copy of Jiven's data: Today, Practise, the answer card, Learn, Progress, Week, the Library, a lecture with its concept map, and Me. The first step of setup on an empty data folder.
- Changing tabs, timed in Chrome on the development server: each of the five tabs opens in under half a second, and no page asks the server for anything while it sits idle (a lecture whose questions are being prepared checks on them, as before). Jiven found the first build slow to change pages: Me asked for the AI status without stopping (about 25 times a second in Chrome), which held up every page opened after it. Fixed, with a test that mounts the AI panel under a parent that re-draws (`tests/companion-me-loads.test.ts`).
- The phone in Chrome at phone size, light and dark, against a stand-in relay: the home screen, a question, an answer, a block on its day and on another day, the week on two days, and moving a block.

### What was not checked
- Nothing has run on a real phone. High contrast was not opened in Chrome. Setup was seen at step 1 only; the facilitator screen and the setup chat were not opened.
- A tutor's diagram drawn by LockedIn (plain boxes and arrows) was tested as a rule, not seen in a live Learn session; nor was a mermaid diagram in the new colours.
- Dragging a block on the restyled Week was not repeated with a real mouse; its rule and tests are unchanged.
- Whether students prefer the changed design to Blocks as drawn: the changes follow what testers said, and were not shown to them.

### What is still missing
- **Not chosen for v3.0:** the clutter list (Today's starter cards, the stage-by-stage pack line).
- **Known and small:** the Library names each week twice; two links arriving at one block join into one arrowhead only when there is room to line them up.
- **v4.0:** the desktop app.
- **Owed to the group:** the third tester's session in the team repo, and design-log rows for V-80 to V-85.

---

## v3.0.1: what a run-through of v3.0 changed (28 Nov 2026)

Jiven used v3.0 on his own laptop for an evening and listed what was wrong. Every item is his; the decisions are [`DECISIONS.md`](DECISIONS.md) V-86 to V-88. Nothing changes on the phone, so there is no relay deploy.

### What was wrong, and what was done
| He said | Cause | Now |
|---|---|---|
| Pages are slightly cut off; things go off the page | v3.0 was checked in a window 1,000 tall. A 13-inch laptop shows about 720 to 800 | Today, Week and Progress fill the window exactly, from about 700 tall upwards. Below that they scroll rather than squash |
| The calendar does not fit one page | The timetable drew every hour at one fixed height: 1.9 screens | Week shares the room under its heading out over the hours shown (`weekScale`, `WEEK_FIT`). A block too short for two lines says its time and name on one, with its state as a mark and in its tooltip |
| Progress: gaps, poor symmetry, and nobody would know to scroll | Four screens tall, with "Where it came from" beside a much taller Milestones | One screen of blocks. Milestones and "To revisit" say the short version (`milestoneSummary`) and open the whole list in a side panel |
| The dotted line round the Learn plan does not work | Steps to come were dashed, and the bar showed an empty dashed box | Solid quiet outlines with the step's number; the bar says "Step 1 of 3" with a square per step |
| The Library says "Week 1" twice and "From your course material" on every row | A heading per week above rows that already carried the week | The week is on the row only. The line under a title appears only for a date, "this week", "you weren't there" or "no material yet" (`unitNotes`) |
| Transitions are abrupt | In Calm, the default, a page change had no animation | A page, and what arrives on it, fades in and rises for 200 ms in Calm and Full. Off and the system's reduce motion still switch it off |
| Pages take forever to change (fixed in v3.0 before release) | Me asked for the AI status without stopping | See the v3.0 section |

### The first build of v3.0.1 was wrong, and what replaced it
The first build pinned Today and Progress to the window's height and hid what did not fit, and made headings smaller on those three tabs and smaller again in short windows. It was checked only at window sizes where everything happened to fit. In a narrower or zoomed window, buttons and cards were cut in half, and a page's title changed size from one tab to the next. Jiven, on opening it: "All the pages are now fucked. Also the fonts are all pear shaped."

What replaced it, before release:
- **Nothing is cut.** A page is at least as tall as the window and its main row takes the height left over; it is never shorter than its content. No block hides or scrolls its own content.
- **Type never changes to fit.** Every tab has the same title, heading and text sizes, as in v3.0, in every window. A short window gets less air round its blocks and leaves out three lines a page can spare.
- **Below a wide window** (1,100 across) the pages flow and scroll as they did in v3.0.
- Tests forbid the first build's rules: a fixed height, a clipped block, or a font size that depends on the page or the window (`tests/companion-tidy.test.ts`).

### How it was checked
- 1,253 companion tests. New in `tests/companion-tidy.test.ts`: the timetable's sizing rule, the milestone summary, the Library's line, the Learn wording, that the page-change animation is not tied to Full and is still switched off by Off and reduce motion, and the rules above.
- In Chrome, on a fresh copy of Jiven's data with his settings (light, Motion "Full"), every tab at ten window sizes, from half a screen (735 wide) and 125% zoom to 1920 x 1000. Looked for in each: content cut by its own block, content spilling out of a block, two rows overlapping, and the type sizes on each tab. None found on Today, Week or Progress, and the type is the same on every tab (title 51 px, heading 26 px, text 17 px).
- The three pages are exactly one screen at 1470 x 800 and 1470 x 750 (Progress is 2 px over at 750). At 1470 x 720 Progress scrolls 32 px. Smaller windows scroll.
- Seen in Chrome: the three pages, both side panels (Escape closes them), the Library, and a Learn session's bar and plan.
- A study block dragged with a real mouse on the resized timetable moved to the time it was dropped on. No page asks the server for anything while idle.

### What was not checked
- Not seen in Jiven's own browser or on his screen. Safari was not opened: everything was checked in Chrome.
- High contrast, and the large and extra-large text sizes, were not opened on the three pages. Larger text needs more room, so those pages will scroll.
- The timetable's one-line blocks show "not started" and "moved" as a mark only, with the word in the tooltip. Nobody has been asked whether that is clear.

### What is still missing
- **Known and small:** two lectures timetabled at the same time are drawn on top of each other in Week, as before.
- **v4.0:** the desktop app.

---

## v3.1: Learn that teaches (28 Nov 2026)

The plan, with what Jiven said and what the code did before, is [`v3.1-plan.md`](v3.1-plan.md); the decisions are [`DECISIONS.md`](DECISIONS.md) V-89 to V-96. Nothing changes on the phone app, so there is no relay deploy.

### In one paragraph
Jiven ran first-run setup and a Learn session with a fresh data folder and found that Learn did not teach: it opened on a question he could not answer, knew only one week of his module, checked with multiple choice, could not take a worked solution, and the Practise questions were easy or badly written. v3.1 changes how a Learn session starts (what you want, an optional check, where you are, then the plan), what a check is (your own words, marked by the tutor), what the tutor can reach (the whole module, and a file you attach), and how Practise questions are written and chosen. AI usage is the constraint throughout: the same reading budgets, the cheap model for questions, and no rewriting unless asked.

### What the real tutor did (28 Nov, his fresh data, `gpt-6-sol` and `gpt-6-luna`)
About eleven tutor turns and two question-writing calls were used.
- **His own case.** Started on the week 1 unit with his words: "I want to focus on week 7-9 content. I know what GANs are but I am not too sure how to solve problems on them", with the check on. The tutor read the idea files of weeks 7, 8 and 9 and asked nothing for a filename.
- **The check.** Two questions in his own words, each answerable with no slide ("Suppose a discriminator correctly identifies most generated images as fake. When updating the generator, what outcome is it trying to make more likely, and why?"). It stopped at the first wrong answer.
- **Where you are and the plan.** Four blocks (Solid, Not yet, two Not checked), then five ideas from weeks 8 and 9 written `m6-…` and `m7-…`, starting at the idea that was wrong, and saying week 7 was left for another block. 31 seconds for that turn; others 5 to 14.
- **Written checks.** Small applied problems ("a real image gets D(x)=0.2, a generated one D(G(z))=0.8: state the desired direction of each output and explain why"). A half-right answer was marked "partly" with what was right and what was missing; the idea went on the record as one to revisit, against the week 8 unit. A full answer was marked "right" and the lesson moved on.
- **An attached worked solution**, with the check skipped: the plan was built round it, one line at a time, ending on "Independent variation".
- **Rewriting one unit's questions** (the GAN unit, 44 seconds): before, 9 recall and 9 understand, none applied, some pointing at "the slides"; after, 12 applied and 6 understand, each stating its own case, options the same length. The second check was asked about 18, could answer all and agreed with all.

### What went wrong with the real tutor, and what was done
- **A check turn that ended on a sentence.** The tutor wrote "Have a go…" and stopped without asking; the student would have had to press "Carry on". Its instructions now say the sentence and the question go in the same turn. Not seen again in the two check questions that followed; not proven gone.
- **An empty reply to a written answer.** The first written check came back with a reply of nothing, so no mark. LockedIn now treats an empty reply as a stall and asks once, "Mark my answer."; the mark then arrived. The next written answer was marked directly. This costs one extra turn when it happens.

### How it was checked
- 1,442 companion tests. New files: `companion-uploads`, `companion-questions`, `companion-learn-start`, `companion-learn-written`, `companion-attach`, and additions to the Learn, pack and practise tests.
- The real AI, as above.
- In Chrome at 1470 x 750, 1280 x 720, 1024 x 700 and 735 x 750: the first step, a written question with a marked answer beside it, the plan with "Where you are", and the Library. Nothing spilled out of its block or made the page wider than the window. The first step fits one screen; a lesson scrolls, as a conversation does.

### What was not checked
- **Uploading several large PDFs through the browser.** The rules are tested, and the cause (a 26 MiB limit on one request) is read from the code, but 43 MB of his PDFs were not dropped on the real page.
- **A picture attached**, to the real tutor: only a text file was. A PDF page with no text is tested with a stand-in reader.
- **Correcting a block of "Where you are"** with the real tutor, the how-you-learn card after the first step, picking up a stopped session from the first step, and a question asked beside an open written check.
- **"Rewrite questions" on a whole module** (it was run on one unit), and a Practise round on the rewritten questions.
- Dark mode, high contrast and the larger text sizes on the new screens.
- Whether students find written checks better than multiple choice: this is Jiven's judgement, not yet a test finding. The hi-fi test on 30 Nov is the first chance.

### What is still missing
- **Part C of the plan, not designed:** the tutor's words streamed as they are written; pictures and demos shown large and playable; notes on A4 pages treated as notes (they are still one "slide" a page).
- **A photo as the answer to a written check.** A file can be sent only when no question is open; over an open question the screen asks for the answer first.
- **Known:** a rewritten question can still be easy (the GAN unit got "A fair six-sided die is rolled repeatedly. Which value is its expected outcome?"), and one said "which listed model family", which leans on a list it does not give. The second check has no slides, so it cannot catch a question that is merely too easy.
- **Usage, measured loosely:** a session's opening message is longer by one line a unit of the module; the second check of a unit's questions is one small call; an empty reply costs one extra turn.
- **Owed to the group:** design-log rows for V-89 to V-96, three of which replace or keep earlier decisions (V-59, part of V-47, V-40).

## v3.1.1: what using v3.1 showed (28 Nov 2026)

Jiven used v3.1 and listed what was still wrong. The decisions are [`DECISIONS.md`](DECISIONS.md) V-97 to V-100. Nothing changes on the phone, so there is no relay deploy.

### What was wrong, and what was done
| He said | Cause | Now |
|---|---|---|
| "I can see 2 plans" | "Where you are" and the plan were two lists of the same ideas, and a block's title ran into its note | One plan. Each step shows what the check found and can be changed; "You already have: …" is one line above it |
| "There are also 2 plan and slide buttons" | Plan and Slide were in the bar and again as tabs inside the panel | One pair, in the bar. The panel has its name and a close button |
| "A clearer deliniation between probe, predict, learn and check stages" | Only a small label on the question card | A strip in the bar (Find your level, Plan; then Guess, Learn, Check) and a header on each part of the lesson |
| "Set multiple weeks for 1 material and multiple materials in one week" | "Set week" showed only while a unit had no week, and took one week | The week is a button on every unit made from material; it takes a first and a last week. Two units could always share a week; now it can be reached |
| "Mermaid diagrams when I click on them they do not fill the screen" | The enlarged box was capped at the diagram's own drawn width | It fills the window |
| "The widgets in the learn box sometimes dont render math" | Maths whose last character was escaped (`\}`, `\|`, `\,`) was not recognised: `$S(i)=\{\mathrm{yes}\}$` | Recognised and rendered |
| "The voice 2 speech doesnt work … whereever the user can type" | There is no Deepgram key on his laptop, and without one the Speak button is hidden. It existed on Learn's boxes only | Speak beside the setup chat, module notes, pasted notes and the Library's search as well. The key is his to add (V-100) |

### How it was checked
- 1,481 companion tests, written first for each rule.
- The plan, a written check, the plan panel, the Library, the week control and the enlarged diagram at 735 x 700, 1024 x 700, 1176 x 600, 1336 x 680, 1470 x 750 and 1920 x 1000, with the probe for cut and spilling content, on real sessions saved from v3.1. Chrome only. One fault found and fixed: in a narrow column the Speak button squeezed the tutor line; the line now wraps.

### Not checked
- **Dictation itself.** There was no Deepgram key to test with; only the buttons' places were checked, with a placeholder key.
- **The tutor naming its steps after the checked ideas.** The prompt asks for it; no new real-AI run was made (usage). On the sessions saved from v3.1, written before the prompt changed, one of two checked ideas paired with a step and the other was shown as "You already have".
- Changing a step's level with the real tutor; dark mode, high contrast and larger text on the changed screens.

### What is still missing
- **Explainer visuals in the Blocks look**, in place of mermaid's own drawing: built as v3.2.
- A unit that covers weeks that are not next to each other (weeks 3 and 7): a range only.
- Everything listed as missing under v3.1.

## v3.2: pictures that build up (28 Nov 2026)

The plan, how the design was chosen from four, what was built and what was measured are in [`v3.2-plan.md`](v3.2-plan.md); the decisions are [`DECISIONS.md`](DECISIONS.md) V-101 to V-103. Nothing changes on the phone, so there is no relay deploy.

### What it does
- A diagram in Learn, or on a Library explainer card, is drawn in Blocks and arrives a step at a time: Back, Next, "Show it all", Enlarge. Each step lights its blocks, can put a short note on a block, and has one sentence, beside the picture when there is room.
- It can open with one block to guess. Nothing is marked; the reason is shown in mint or lilac; "Show me instead" skips it. The tutor's own guess question is unchanged.
- The tutor and the explainer writer are told to write every picture as plain boxes and arrows, so LockedIn draws it. Anything else still goes to mermaid.

### Checked, not checked, still missing
See sections 6 and 7 of the plan. In short: tests, six window sizes, and four real-AI calls (the tutor wrote a stepped picture at the first attempt; a unit's explainers went from 0 of 8 to 8 of 8 drawn by LockedIn). Not checked: a gap written by the tutor inside Learn, dark mode and high contrast, the keyboard alone. Still missing: the two designs left out, and old explainers, which stay still pictures until a study pack is made again.
