# MVP 1: the LockedIn app

**Status:** proposal for review (14 Nov 2026). Nothing in here is built yet. Agree the design (§2), the feature list (§4), the open decisions (§9) and the branch plan (§8), then each feature ships as its own PR through the normal process (`docs/companion/SDLC.md`).

**What MVP 1 is.** The first student-facing LockedIn app: a phone-sized web app at `/m`, visually distinct from the engine's developer UI, that takes a new student from "never seen it" to "answering question 1 on their own lecture" in under a minute, and then brings them back at the right moment. It runs on the plumbing that is already merged (`docs/companion/API.md`); the backend additions it needs are listed per feature and collected in §6.

---

## 1. Goals and non-goals

**MVP 1 must let a tester do, without help:**
1. Get started: pick modules, connect a calendar (sample, a file, or a subscription link), see what the app read, try a 3-question session (J1, ≤ 60 s, ≤ 3 screens).
2. Get nudged after a lecture, tap, and land on question 1 (J2).
3. Answer with confidence and a "why", ask for a hint or a worked example, see feedback that cites the slide, open that slide (J2, INT-01-g).
4. Bring their own slides: upload a lecture PDF, read it, and be quizzed on it or on a range of slides.
5. Leave mid-session and resume; mark a lecture missed and get it offered later (J3); see misses come back (J4).
6. See progress without streaks or "overdue" (J6); change how the app looks and how often it nudges.

**And the facilitator can** run every journey on demand for T23 (demo clock, fire nudges, scenarios, engine switch, CSV).

**Not in MVP 1:** real push notifications and a real app lock (simulated, as planned), Canvas/Panopto, accounts, recording lectures, dictation, streaks/badges/leaderboards (ruled out by R-6). The study-block lock screen is a stretch (§4, F-11).

---

## 2. Design direction

### 2.1 Principles (each answers to evidence)

| Principle | In practice | Evidence |
|---|---|---|
| **One thing at a time** | Every screen has one primary action. The session shows one question, never a transcript | AE2-3, AFF-H, AFF-C |
| **Start, don't set up** | No settings before the first question; the first card on Today is always an action | AE2-1, AE2-P14, AFF-G |
| **Show the work while waiting** | "Reading your HCI slides → writing question 1", never a bare spinner | AE2-2, AE2-4 |
| **Forgiving** | No streaks, no red numbers, nothing "overdue"; misses are "ideas to revisit" | R-6, INT-01-i |
| **Honest about what it reads** | A visible "What I read" and a one-tap delete | R-7, Q-10 |
| **Grounded in the student's slides** | Every explanation cites a slide and the slide is one tap away | INT-01-g, INT-01-h |
| **Yours to tune** | Live theme preview, text size, spacing, reduce motion | AE2-P10, AE2-P16 |

### 2.2 Look and feel

Distinct from the engine UI (dense, monospace, desktop sidebar): LockedIn is **calm, rounded, card-based, mobile-first**.

- **Tokens** come from Rahul's onboarding spike (`kayzisland/hcidesignchallenge/onboarding/src/styles.css`), so the team's existing look carries over: themes `light` (soft lavender), `muted` (paper), `dark`, `contrast` (black/yellow), `system`; accents `lavender` (default), `mint`, `coral`, `blue`; text size `normal | large | xlarge`; loose line spacing; reduce motion. Radius 18 px, soft shadow, 44 px minimum touch targets, a visible focus ring.
- **Type:** Inter (UI) with a readable serif-free body at 16 px base; Markdown and KaTeX for teacher prose.
- **Layout:** a 390 × 844 phone frame on desktop (status bar with the demo clock, the nudge banner slides down from the top), full-screen on a real phone. Bottom tab bar; the session is a full-screen flow without tabs.
- **Motion:** short (150–200 ms) and functional only; off with reduce motion.
- **Iconography:** Lucide (already a dependency), never emoji as the only cue (colour-blind cues from the spike).

### 2.3 Information architecture

```text
/m                      phone frame (desktop) or full screen (phone) + nudge banner + tab bar
├── /m/welcome          onboarding (3 steps) → What I read → Today          (first run only)
├── /m                  Today
├── /m/library          modules → lectures (course order) → lecture
│   └── /m/library/[lectureId]          slides reader, "Quiz me", map (optional)
├── /m/session/[id]     the session (full screen, no tabs)
├── /m/progress         this week, ideas to revisit, roadmap
├── /m/me               settings: appearance, nudges, calendar, sessions, what I read, delete
└── /m/facilitator      desktop only, not linked from the app
```

Tabs: **Today · Library · Progress · Me**. Slides open in a bottom sheet from anywhere a `(Slide n)` chip appears.

### 2.4 Key screens (wireframes)

```text
Today (first run)                 Session: question                   Session: feedback
┌──────────────────────────┐      ┌──────────────────────────┐        ┌──────────────────────────┐
│ 13:05            ▂▄▆ 100%│      │ ✕  HCI · Personas         │        │ ✕  HCI · Personas         │
│ ┌──────────────────────┐ │      │ 5 questions · ~10 min ●●○○○│        │ 5 questions · ~10 min ●●○○○│
│ │ HCI just finished.   │ │      ├──────────────────────────┤        ├──────────────────────────┤
│ │ 5 questions, ~10 min?│ │      │ Start with what a persona │        │ ✗ Not quite               │
│ │ [Open] [Later] [✕]   │ │      │ is for  (Slide 4)         │        │ Answer: focus decisions   │
│ └──────────────────────┘ │      │                           │        │ on specific users' goals  │
│ Good afternoon           │      │ Which is the main purpose │        │                           │
│ ┌──────────────────────┐ │      │ of a persona?             │        │ A persona keeps specific  │
│ │ ▶ Try it now         │ │      │ ○ Focus decisions on goals│        │ users' goals in view …    │
│ │ 3 questions on your  │ │      │ ○ Record averages         │        │ [Slide 4] [Slide 7]       │
│ │ last lecture · 3 min │ │      │ ○ Replace research        │        │                           │
│ └──────────────────────┘ │      │ ○ I don't know            │        │ Your why: "averages…"     │
│ Today                    │      │ How sure?  0 30 50 70 90 100│      │                           │
│  11:00 HCI Personas  ✓   │      │ Why? (optional) [       ] │        │                           │
│  14:00 HCI lab           │      │ [Hint] [Show me] [ Check ]│        │          [ Next → ]       │
│ Today  Library  Progress Me│    └──────────────────────────┘        └──────────────────────────┘

Library: lecture                  Slide reader (sheet)                Lecture map (optional)
┌──────────────────────────┐      ┌──────────────────────────┐        ┌──────────────────────────┐
│ ‹ HCI · Week 3           │      │ ━━━━                      │        │ ‹ Personas and scenarios  │
│ Personas and scenarios   │      │ Slide 4 of 10       ✕     │        │  ● Why designers lose…  ✓ │
│ Tue 11:00–13:00 · ✓ done │      │ ┌──────────────────────┐ │        │  │                        │
│ ┌──────────────────────┐ │      │ │                      │ │        │  ● What a persona is   ◐ │
│ │ ▶ Quiz me (5 q)      │ │      │ │   (PDF page render)  │ │        │  │                        │
│ └──────────────────────┘ │      │ │                      │ │        │  ● What personas are… ○  │
│ Slides  (10)  [Add PDF]  │      │ └──────────────────────┘ │        │  │   1 idea to revisit    │
│  1 Personas and scenarios│      │ ‹ prev    • • • •   next ›│        │  ● Primary / anti      · │
│  2 Why designers lose…   │      │ [Quiz me on slides 4–6]  │        │  ● Scenarios           · │
│  …                       │      │                          │        │ ✓ solid ◐ shaky ○ revisit │
│ Map  ·  I wasn't there   │      └──────────────────────────┘        │ · not yet  [Quiz the gaps]│
└──────────────────────────┘                                          └──────────────────────────┘
```

A visual mock (real colours, themes, the phone frame) is the first deliverable of F-01 so the design can be signed off before the rest is built (§8).

---

## 3. Process taxonomy

How a feature moves from idea to shipped, and how features are grouped, so everyone uses the same words.

### 3.1 Layers (what a feature is)

| Layer | Meaning | MVP 1 features |
|---|---|---|
| **L0 Foundation** | The shell everything sits in | F-01 |
| **L1 Get started** | From install to the first question | F-02, F-03 |
| **L2 Core loop** | Nudge → session → feedback → resume | F-04, F-05 |
| **L3 Materials** | The student's own lecture content | F-06, F-07 |
| **L4 Insight** | Seeing where you are, forgivingly | F-08, F-12 |
| **L5 Structure** | Study blocks and the simulated lock | F-11 (stretch) |
| **L6 Control** | Settings, data, and the facilitator | F-09, F-10 |

### 3.2 Priority

- **P0, MVP blocker:** without it a T23 journey cannot run.
- **P1, MVP:** in MVP 1 unless the schedule breaks.
- **P2, optional / stretch:** built behind a setting or cut first.

### 3.3 Lifecycle

`proposed` (in this doc) → `approved` (decision recorded) → `in progress` (branch open, issue assigned) → `in review` (PR open, CI green) → `shipped` (merged to `main`, demoable) → `validated` (survived a T23 session). Each feature gets a *Feature (lo-fi → hi-fi)* issue with the ID below in its title, e.g. `[feat] F-05 Session screen`.

### 3.4 Definition of done for a UI feature

The SDLC definition of done, plus: works at 390 px and on a real phone; keyboard reachable with a visible focus ring; all five themes and three text sizes checked; reduce motion respected; loading and error states designed (no bare spinners, no raw error text); events logged for what T23 measures; a screenshot or recording in the PR.

---

## 4. Features

| ID | Feature | Layer | Pri | Journeys | Branch | Depends on |
|---|---|---|---|---|---|---|
| F-01 | App shell and design system | L0 | P0 | all | `feat/ui-shell` | — |
| F-02 | Onboarding and "What I read" | L1 | P0 | J1 | `feat/ui-onboarding` | F-01, F-03 (backend part) |
| F-03 | Calendar connect: sample, file, subscription link; export | L1 | P1 | J1, J2 | `feat/calendar-sync` | F-01 |
| F-04 | Today and the nudge banner | L2 | P0 | J1, J2, J3, J4, J6 | `feat/ui-today` | F-01 |
| F-05 | Session screen | L2 | P0 | J1–J4 | `feat/ui-session` | F-01 |
| F-06 | Library: modules, lectures, roadmap, search | L3 | P1 | J3, INT-01-e/f | `feat/ui-library` | F-01 |
| F-07 | Slides: PDF upload, reader, "Quiz me on these slides" | L3 | P1 | J2, INT-01-g | `feat/pdf-reader` | F-06 |
| F-08 | Progress: this week, ideas to revisit, welcome back | L4 | P1 | J4, J6 | `feat/ui-progress` | F-01 |
| F-09 | Me (settings) with live theme preview | L6 | P1 | all | `feat/ui-settings` | F-01 |
| F-10 | Facilitator panel | L6 | P0 | T23 | `feat/ui-facilitator` | F-01 |
| F-11 | Study blocks and the simulated lock screen | L5 | P2 | J5 | `feat/ui-blocks` | F-01, F-09 |
| F-12 | Lecture map (optional knowledge graph) | L4 | P2 | J4, INT-01-e | `feat/lecture-map` | F-07, F-08 |

### F-01 App shell and design system (P0)

- **Separate root layout.** Move the engine's pages into a route group `app/(engine)/` (its `layout.tsx`, `page.tsx`, `chat/`, `settings/`, `plugins/`; URLs unchanged) and add `app/(lockedin)/m/layout.tsx` as LockedIn's own root layout: own `<html>`, own CSS, no engine sidebar or Tailwind theme. `app/api` is untouched. Recorded in `NOTICE` and DECISIONS.
- `components/lockedin/`: tokens (`lockedin.css`), `PhoneFrame` (status bar with demo clock, banner slot, home indicator; full-screen under 500 px), `TabBar`, `Card`, `Button`, `Sheet`, `Chip`, `ProgressDots`, `ActivityLine`, `EmptyState`, `ErrorState`, `Markdown` (Streamdown + KaTeX, both existing dependencies).
- `lib` client: `api.ts` (typed fetch over `/api/companion`, types from `@/src/core`), `usePoll(fn, ms, while)` for session and tick polling, `useTick()` (every 30 s and on focus), `useProfile()`.
- First deliverable: the visual mock of the key screens in all themes for sign-off.
- **Done when:** `/m` renders the frame and tabs with placeholder screens in all five themes, at 390 px and on a phone.

### F-02 Onboarding and "What I read" (P0, J1)

Three steps, one decision each: **What are you studying?** (module chips) → **Connect your calendar** (F-03 options; sample preselected and labelled) → **How often can I nudge you?** (1 a day default, 2; quiet hours shown and editable inline). Then **What I read** (source, events, modules, last read, "I never read your location", delete) and straight to Today with "Try it now" on top. Logs `onboarding_step` per step.
- **Done when:** a new tester reaches question 1 in ≤ 60 s and ≤ 3 decision screens (time it from `onboarding_step` 1 to `question_shown`).

### F-03 Calendar connect and export (P1)

| Option | How | Backend |
|---|---|---|
| Sample timetable | Built | — |
| Upload `.ics` | File picker → `POST /timetable/import` | Built |
| **Subscribe to a link** (university timetables and Google/Outlook/Apple calendars all give an iCal link) | Paste `https://…` or `webcal://…`; refreshed on open and every 6 h; "Refresh now" | **New:** `POST /timetable/subscribe {url}`, `POST /timetable/refresh`; server-side fetch restricted to http(s), 5 s timeout, 2 MB cap, no private-network addresses; the URL is stored locally and shown masked |
| **Map unknown events** | Events that match no module: assign to a module, mark "not a lecture", or ignore | **New:** `POST /timetable/map` storing rules by event title |
| **Export to my calendar** | A subscribable `.ics` feed of study blocks and planned sessions, each with an alarm, so the phone's own calendar gives a real reminder without push notifications | **New:** `GET /calendar.ics` (VEVENT + VALARM) |

Google/Microsoft OAuth sync is out of MVP 1: the link covers the same calendars without accounts or keys. **Done when:** a real calendar link imports, refreshes, maps unknown events, and the export feed subscribes in Apple and Google Calendar.

### F-04 Today and the nudge banner (P0)

- **Banner:** the tick (`GET /nudges/due`) every 30 s and on focus; the banner slides into the phone frame with the nudge text and **Open / Later / ✕**, plus **I wasn't there** on N-1. Open goes straight to the session (pre-warmed: question 1 waiting).
- **Today:** greeting + date; one primary card chosen in this order: *Continue your session* → *Welcome back* → *Try it now* (first run) → *Ready to revisit (n)*; then today's timetable with per-lecture status and "I wasn't there"; next study block.
- **Done when:** J2 runs from the facilitator panel with tap → question 1 ≤ 3 s; the banner never stacks; dismissing never re-shows.

### F-05 Session screen (P0)

Every `SessionView` state designed: **preparing** (activity line), **question** (lead-in prose, stem, options + "I don't know", confidence stops 0/30/50/70/90/100 defaulting to 50, optional why box, Hint (when `canHint`), Show me first, Check), **thinking** (feedback panel + "Writing question 3…"), **feedback** (right/not quite, the correct answer, explanation, slide chips that open the reader sheet, the student's own why), **done** (two-line summary, Keep going (+3), Done), **error** (plain words, Retry, Start a new session). Progress dots; ✕ = Stop for now (no confirmation, nothing lost). A one-time tip explains confidence and why on the first session. Polls every 750 ms only while preparing or thinking.
- **Done when:** all six states on both engines; resume after closing the tab lands on the same question; keyboard-only completion works.

### F-06 Library (P1)

Modules → lectures in course order with status (done ✓ / ideas to revisit ◐ / not yet ·), search over lecture and slide titles, a lecture page with **Quiz me**, slide list, **Add PDF**, **I wasn't there**, and (F-12) **Map**. **Start any lecture in two taps** (INT-01-e/f). Built on `GET /roadmap`, `GET /lectures?q=`, `GET /materials/:id`.

### F-07 Slides: PDF upload, reader, quiz me on slides (P1)

- **Upload:** students add their own slides on a lecture page (drag-drop or picker, ≤ 25 MB). Conversion report: "10 slides read; slides 3 and 9 are images: add a one-line caption?" with inline caption fields. **Backend:** open `POST /materials/:id` to students (today it is facilitator-only), keep the size cap, add `PUT /materials/:id/captions`.
- **Reader:** a bottom sheet / full page with `pdfjs-dist` (already a dependency) rendering one page at a time, prev/next and swipe, page dots, pinch-zoom; falls back to the slide's Markdown when there is no PDF. Opens at page *n* from any `(Slide n)` chip.
- **Quiz me on these slides:** from the reader, "Quiz me on slides 4–6". **Backend:** `SessionSpec.slides?: { from, to }`; the opening message includes only that range (with the rest's headings for context).
- **Done when:** a tester uploads a real PDF, reads it, and gets questions on a chosen range that cite those slides.

### F-08 Progress (P1)

This week (sessions, questions answered, ideas ready to revisit: plain numbers, no comparison), **Ideas to revisit** (each miss as the question and its answer, "Revisit now" starts a retest), the roadmap per module, and the welcome-back card after 5+ days away. Never "overdue", never a streak (tested by string checks, as the API tests already do).

### F-09 Me (P1)

Appearance with **live preview** (themes, accents, text size, spacing, reduce motion: AE2-P10's moment of delight), nudges per day, quiet hours, evening time, default session mode (question me first / show me first), lock strictness (with F-11), calendar (source, refresh, export link), What I read, Delete all my data (one tap with a single confirm), About and credits. Every change logs `settings_changed`.

### F-10 Facilitator panel (P0, T23)

Desktop page beside a live phone frame: participant ID; demo clock (set, +5 min, next lecture end, next day); fire N-1…N-4 / block; scenarios (tayo, maya, returning); engine for next sessions; the upcoming-nudge list; a live event-log tail; reset (archives the log); export CSV. Gated by `COMPANION_DEMO=1`. **Done when:** every journey is triggerable in < 10 s.

### F-11 Study blocks and the simulated lock (P2, stretch)

Up to two weekly blocks (pick, move, skip this week in one tap). At block start the frame shows a simulated home screen: our app, decoy apps ("Social", "Videos", "Chat"), a timer and Start session; with gentle/firm lock the decoys ask "Open anyway?" / "What do you want it for?" and let the student through. Always says it is simulated. All backend routes exist.

### F-12 Lecture map: an optional knowledge graph (P2)

The engine has a knowledge graph (proposition extraction, chains, a force-directed canvas). Our research says that version confused testers (AE2-4, AFF-H: unexplained "reading and finding", jargon, background model calls), so the plan switched it off. **The lecture map is a different, smaller thing, and off by default:**

| | Engine graph | Lecture map |
|---|---|---|
| Nodes | Extracted propositions | The lecture's own slide sections (its headings) |
| Built by | Background model calls after every session | Our own data, no model calls |
| Edges | Reasoning chains | Course order and section order |
| Status | — | From the student's answers: each answer's explanation cites slides, so slides inherit ✓ solid / ◐ shaky / ○ to revisit / · not yet |
| Action | Explore | Tap a node → open the slide, or "Quiz me on the gaps" |
| Scope | Everything ever learned | One lecture, or a module as a chain of lectures |

- **Backend:** persist answer records with their slide references (`answers.jsonl`; today they live only in engine records and the event log) and add `GET /lectures/:id/map` and `GET /modules/:code/map`.
- **Rendering:** a simple vertical SVG (no new dependency); `@xyflow/react` (already present) only if the module view needs pan and zoom.
- A Settings toggle "Show lecture maps", default off, so T23 can measure whether anyone turns it on.

---

## 5. Events added for T23

`onboarding_step` (exists, client), `slides_uploaded`, `slide_opened {from: chip | list | map}`, `calendar_connected {source}`, `calendar_refreshed`, `map_opened`, `theme_previewed`. Each lands in `COMPANION_EVENT_TYPES` in the PR that needs it.

## 6. Backend additions (plumbing gaps MVP 1 exposes)

| # | Addition | For | Size |
|---|---|---|---|
| B-1 | Route group split: `app/(engine)` and `app/(lockedin)` root layouts | F-01 | S (moves files; URLs unchanged; `tests/render-layout.test.tsx` path updated) |
| B-2 | Calendar subscribe / refresh / map rules, `GET /calendar.ics` export with alarms | F-03 | M |
| B-3 | Student PDF upload (lift the demo gate), caption editing | F-07 | S |
| B-4 | `SessionSpec.slides` range through the opening message and scripted engine | F-07 | S |
| B-5 | Persisted answer records with slide refs; lecture and module map endpoints | F-12 | M |
| B-6 | New event types (§5) | several | XS |

## 7. Implementation details

- **Where code goes:** pages in `app/(lockedin)/m/**` (server components only for the shell; screens are client components), UI in `components/lockedin/**` (imports `@/src/core` only, per the import law), API client in `components/lockedin/api.ts`. No engine components are reused, so the look stays distinct.
- **Styling:** plain CSS with the token set in `components/lockedin/lockedin.css`, themes via `data-theme` / `data-accent` / `data-text` attributes on the LockedIn `<html>` (the spike's approach), applied before paint from the saved profile to avoid a flash. No Tailwind in the LockedIn tree.
- **Data:** no client store library. Server state is fetched per screen; polling only where the API says so (session while preparing/thinking, tick every 30 s); optimistic UI only for settings toggles.
- **PDF:** `pdfjs-dist` with its worker served from `public/`; render to canvas at device pixel ratio; one page in memory at a time.
- **Accessibility:** semantic buttons and radio groups for options, `aria-live="polite"` for the activity line and feedback, focus moved to the new question, 44 px targets, contrast theme verified.
- **Tests:** component tests with the existing `node:test` + `tsx` setup (`*.test.tsx` already runs in `npm test`) for state-to-render logic; route tests for each backend addition; one Playwright smoke for J1 and J2 on the scripted engine as a separate job (new dev dependency, decided in §9).
- **Performance budget:** first load of `/m` under 200 KB of JS gzipped (the engine bundle never loads there); tap → question 1 ≤ 3 s pre-warmed.

## 8. Branches, order and milestones

```text
main
 └─ feat/ui-shell (F-01, B-1) ── merge ──┬─ feat/ui-onboarding (F-02) ─┐
                                          ├─ feat/ui-today (F-04) ──────┤  M1 "click through J1 + J2"
                                          ├─ feat/ui-session (F-05) ────┤
                                          ├─ feat/ui-facilitator (F-10) ┘
                                          ├─ feat/calendar-sync (F-03, B-2) ─┐
                                          ├─ feat/ui-library (F-06) ─────────┤  M2 "my own material"
                                          │   └─ feat/pdf-reader (F-07, B-3, B-4)
                                          ├─ feat/ui-progress (F-08) ────────┤  M3 "where am I"
                                          ├─ feat/ui-settings (F-09) ────────┘
                                          ├─ feat/lecture-map (F-12, B-5)      optional
                                          └─ feat/ui-blocks (F-11)             stretch
```

| Milestone | Contains | Demo |
|---|---|---|
| **M0 Design sign-off** | Visual mock of the key screens in all themes | Review the look before building |
| **M1 Core loop** | F-01, F-02, F-04, F-05, F-10 | A tester does J1 and J2 on the scripted engine from the facilitator panel |
| **M2 My material** | F-03, F-06, F-07 | Connect a real calendar link, upload real slides, get quizzed on a slide range |
| **M3 Where am I** | F-08, F-09 (+ F-12 if approved) | J4, J6; theme preview; optional map |

Each branch is one PR into `main` with the template filled in; branches after F-01 can run in parallel. Merge order inside a milestone does not matter.

## 9. Decisions needed before building

| # | Question | Recommendation |
|---|---|---|
| U-1 | Sign off the design direction (§2), after seeing the M0 mock | Rahul's tokens, lavender default, card-based |
| U-2 | Tabs: Today · Library · Progress · Me? | Yes |
| U-3 | Lecture map (F-12): build it, off by default, despite AE2-4/AFF-H? | Build it as P2 behind a toggle and measure whether testers turn it on |
| U-4 | Calendar link subscriptions mean the server fetches a URL the student pastes. OK for a local prototype? | Yes, with the restrictions in F-03 |
| U-5 | Students upload their own slides (PDFs stay on the laptop's data directory) | Yes; T23 uses the facilitator's copies |
| U-6 | Calendar export with alarms as a "real reminder" without push | Yes, P1 inside F-03 |
| U-7 | Playwright for the J1/J2 smoke (new dev dependency, separate CI job) | Yes, after M1 |
| U-8 | Study blocks and lock (F-11) in MVP 1 at all? | Stretch; cut first |
