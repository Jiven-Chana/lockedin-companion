# MVP 1: the LockedIn app

**Status:** proposal for review (rev. 2, 14 Nov 2026). Nothing in here is built yet. Agree the design (§2), the feature list (§4), the open decisions (§9) and the branch plan (§8); then each feature ships as its own PR through the normal process (`docs/companion/SDLC.md`).

**What MVP 1 is.** The first student-facing LockedIn app: a **laptop-first** web app at `/app`, visually its own thing (not the engine's developer UI), that takes a new student from "never seen it" to "answering question 1 on their own lecture" in under a minute, and then brings them back at the right moment. It runs on the plumbing already merged (`docs/companion/API.md`); the backend additions it needs are listed per feature and collected in §6. **Mobile is phase 2** (§8): the same app, responsive, then installable.

**Changes in rev. 2:** an original, dynamic design system instead of the onboarding spike's palette (§2); the lecture map is a mermaid concept map, the same format the engine's teacher already plans in (F-12); laptop first, mobile after (§2.3, §8).

---

## 1. Goals and non-goals

**MVP 1 must let a tester do, on a laptop, without help:**
1. Get started: pick modules, connect a calendar (sample, a file, or a subscription link), see what the app read, try a 3-question session (J1, ≤ 60 s, ≤ 3 decision screens).
2. Get nudged after a lecture (an in-app toast and, if they allow it, a real desktop notification), click, and land on question 1 (J2).
3. Answer with confidence and a "why", ask for a hint or a worked example, see feedback that cites the slide **with the slide open beside it** (J2, INT-01-g).
4. Bring their own slides: upload a lecture PDF, read it, and be quizzed on it or on a range of slides.
5. Leave mid-session and resume; mark a lecture missed and get it offered later (J3); see misses come back (J4).
6. See progress without streaks or "overdue" (J6), optionally as a concept map; change how the app looks and how often it nudges.

**And the facilitator can** run every journey on demand for T23 (demo clock, fire nudges, scenarios, engine switch, CSV).

**Not in MVP 1:** mobile layouts and installation (phase 2), real phone push and a phone app lock (phase 2, simulated before that), Canvas/Panopto, accounts, recording lectures, dictation, streaks/badges/leaderboards (ruled out by R-6).

---

## 2. Design direction

### 2.1 Principles (each answers to evidence)

| Principle | In practice | Evidence |
|---|---|---|
| **One thing at a time** | Every screen has one primary action; the session shows one question, never a transcript | AE2-3, AFF-H, AFF-C |
| **Start, don't set up** | No settings before the first question; the first card on Today is always an action | AE2-1, AE2-P14, AFF-G |
| **Show the work while waiting** | "Reading your HCI slides → writing question 1", never a bare spinner | AE2-2, AE2-4 |
| **Forgiving** | No streaks, no red numbers, nothing "overdue"; misses are "ideas to revisit" | R-6, INT-01-i |
| **Honest about what it reads** | A visible "What I read" and a one-tap delete | R-7, Q-10 |
| **Grounded in the student's slides** | Every explanation cites a slide, and the slide is already on screen | INT-01-g, INT-01-h |
| **Yours to tune** | The whole palette is generated from a colour you pick, previewed live | AE2-P10, AE2-P16 |

### 2.2 The look: "Focus", a dynamic design system

LockedIn's identity is the act of locking in: the interface **narrows and deepens as you focus**, and its colour **comes from what you are studying**. Nothing is a fixed preset palette.

- **Generated palette.** Every colour (surfaces, ink, borders, accent, status) is computed in OKLCH from **one seed hue**, so any hue the student picks produces a coherent, accessible theme (contrast-checked at generation: text ≥ 4.5:1, UI ≥ 3:1). The student chooses the seed on a hue wheel with a live preview, or leaves it on **Auto**.
- **Context colour (Auto).** Each module gets its own hue (derived from its code, adjustable): the Library, a lecture and its session take on that module's colour, so HCI and Game Theory feel like different places. Today blends the hues of the day's modules.
- **Time of day.** The background is a slow ambient gradient that follows the clock (dawn, day, dusk, night) and dims during quiet hours. It follows the demo clock, so a facilitator jumping to 19:00 sees the evening.
- **Focus mode.** Entering a session, the chrome (nav, cards, colour) recedes, the background deepens towards the module hue, and a single **focus ring** fills as questions are answered: the ring closes when the session is done. It is the only "progress" device, and it never carries across sessions (no streaks).
- **Status without colour alone.** Solid / shaky / to revisit / not yet always pair a hue with an icon and a fill pattern (✓ ◐ ○ ·).
- **Type.** A characterful display face for headings and numbers (candidates: Bricolage Grotesque, Space Grotesk) and **Atkinson Hyperlegible** for body text, chosen for legibility; Markdown and KaTeX for teacher prose; monospace only for code.
- **Motion.** Purposeful and slow in the ambient layer (≥ 20 s cycles), quick (150–200 ms) in interactions; **Reduce motion** freezes the gradient and removes transitions.
- **Accessibility modes override the dynamic system:** light / dark / system, a fixed high-contrast mode (ignores the seed hue), text size (normal, large, extra large), loose line spacing.

The M0 mock (§8) shows two or three seed variants, module tinting, the time-of-day range and focus mode, so the group chooses the look from real pixels.

### 2.3 Layout: laptop first

```text
≥ 1024 px (MVP 1)                                     < 1024 px (phase 2)
┌──────┬──────────────────────────────────────────┐   rail → bottom tabs
│ Lock │  Today                    🔔 toast area   │   slide panel → bottom sheet
│ edIn │                                           │   two panes → one
│      │                                           │
│ Today│                                           │
│ Libr.│                                           │
│ Prog.│                                           │
│ Me   │                                           │
│      │                                           │
│ ⏱13:05 (demo)                                    │
└──────┴──────────────────────────────────────────┘
```

- A left **rail** (Today · Library · Progress · Me), content to the right, a toast area top-right for nudges. In demo mode the rail shows the demo clock.
- The session is a full-window **focus mode** with two panes: the question column, and the **slide panel** showing the slide the teacher is citing.
- Keyboard first: number keys pick options, `C` cycles confidence, `Enter` checks, `H` hint, `S` show me first, `Esc` stop for now.

### 2.4 Information architecture

```text
/app                      Today
/app/welcome              onboarding (3 steps) → What I read → Today        (first run only)
/app/library              modules → lectures (course order), search
/app/library/[lectureId]  lecture: Quiz me, slides, concept map, I wasn't there
/app/session/[id]         focus mode (no rail)
/app/progress             this week, ideas to revisit, roadmap, maps
/app/me                   appearance, nudges, calendar, sessions, what I read, delete
/app/facilitator          T23 control panel (COMPANION_DEMO=1), not linked from the app
```

### 2.5 Key screens (wireframes; the mock replaces these)

```text
Today                                                    Session (focus mode)
┌──────┬─────────────────────────────────────────────┐  ┌──────────────────────────────┬───────────────────────────┐
│      │ Tuesday afternoon            ┌─────────────┐│  │ ✕  HCI · Personas  ◔ 2 of 5  │ Slide 4 of 10      ‹ ›    │
│ Today│                              │HCI just     ││  │                              │ ┌───────────────────────┐ │
│      │ ┌──────────────────────────┐ │finished. 5  ││  │ Start with what a persona is │ │                       │ │
│ Libr.│ │ ▶ Try it now             │ │questions,   ││  │ for (Slide 4).               │ │  (the cited slide,    │ │
│      │ │ 3 questions on Personas  │ │~10 min?     ││  │                              │ │   rendered from the   │ │
│ Prog.│ │ and scenarios · 3 min    │ │[Open][Later]││  │ Which is the main purpose of │ │   student's PDF)      │ │
│      │ └──────────────────────────┘ └─────────────┘│  │ a persona?                   │ │                       │ │
│ Me   │ Today                                       │  │ 1 ○ Focus decisions on goals │ └───────────────────────┘ │
│      │  11:00 HCI · Personas and scenarios   ✓     │  │ 2 ○ Record averages          │ What personas are for     │
│      │  14:00 HCI lab                              │  │ 3 ○ Replace research         │ • focus decisions on      │
│      │ Ideas ready to revisit: 2  ›                │  │ 4 ○ I don't know             │   specific users' goals…  │
│      │ Next study block: Wed 15:00                 │  │ How sure? 0 30 [50] 70 90 100│                           │
│⏱13:05│                                             │  │ Why? ________________        │ [Quiz me on slides 4–6]   │
└──────┴─────────────────────────────────────────────┘  │ [Hint H] [Show me S] [Check ↵]│                           │
                                                         └──────────────────────────────┴───────────────────────────┘
Lecture: concept map
┌──────┬──────────────────────────────────────────────────────────────────────────┐
│      │ HCI · Week 3 · Personas and scenarios        [▶ Quiz me] [Quiz the gaps]  │
│      │  Slides | Concept map | Ideas to revisit (1)                              │
│      │   ┌────────────────┐     ┌──────────────────┐                             │
│      │   │✓ Why designers │────▶│◐ What a persona  │──┐                          │
│      │   │  lose users S2 │     │  is · S3          │  │   ┌───────────────────┐  │
│      │   └────────────────┘     └──────────────────┘  ├──▶│○ What personas are│  │
│      │                          ┌──────────────────┐  │   │  for · S4          │  │
│      │                          │· What goes in · S5│──┘   └───────────────────┘  │
│      │                          └──────────────────┘   ✓ solid ◐ shaky ○ revisit · not yet │
└──────┴──────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Process taxonomy

How features are grouped and how one moves from idea to shipped, so everyone uses the same words.

### 3.1 Layers

| Layer | Meaning | MVP 1 features |
|---|---|---|
| **L0 Foundation** | The shell and design system everything sits in | F-01 |
| **L1 Get started** | From first open to the first question | F-02, F-03 |
| **L2 Core loop** | Nudge → session → feedback → resume | F-04, F-05 |
| **L3 Materials** | The student's own lecture content | F-06, F-07 |
| **L4 Insight** | Seeing where you are, forgivingly | F-08, F-12 |
| **L5 Structure** | Study blocks (and, in phase 2, the phone lock) | F-11 |
| **L6 Control** | Settings, data, the facilitator | F-09, F-10 |

### 3.2 Priority

- **P0, MVP blocker:** without it a T23 journey cannot run.
- **P1, MVP:** in MVP 1 unless the schedule breaks.
- **P2, optional / stretch:** built behind a setting, or cut first.

### 3.3 Lifecycle

`proposed` (this doc) → `approved` (decision recorded in DECISIONS.md) → `in progress` (branch open, issue assigned) → `in review` (PR open, CI green) → `shipped` (merged to `main`, demoable) → `validated` (survived a T23 session). Each feature gets a *Feature (lo-fi → hi-fi)* issue titled with its ID, e.g. `[feat] F-05 Session focus mode`.

### 3.4 Definition of done for a UI feature

The SDLC definition of done, plus: works at 1280 × 800 and 1440 × 900 and degrades readably to 1024; keyboard-complete with a visible focus ring; checked in light, dark, high contrast, two seed hues and all three text sizes; reduce motion respected; loading and error states designed (no bare spinners, no raw error text); events logged for what T23 measures; a screenshot or recording in the PR.

---

## 4. Features

| ID | Feature | Layer | Pri | Journeys | Branch | Depends on |
|---|---|---|---|---|---|---|
| F-01 | App shell and the Focus design system | L0 | P0 | all | `feat/ui-shell` | — |
| F-02 | Onboarding and "What I read" | L1 | P0 | J1 | `feat/ui-onboarding` | F-01 |
| F-03 | Calendar: sample, file, subscription link, mapping, export | L1 | P1 | J1, J2 | `feat/calendar-sync` | F-01 |
| F-04 | Today, toasts and desktop notifications | L2 | P0 | J1–J4, J6 | `feat/ui-today` | F-01 |
| F-05 | Session focus mode with the slide panel | L2 | P0 | J1–J4 | `feat/ui-session` | F-01 (slide panel upgrades with F-07) |
| F-06 | Library: modules, lectures, roadmap, search | L3 | P1 | J3, INT-01-e/f | `feat/ui-library` | F-01 |
| F-07 | Slides: PDF upload, reader, "Quiz me on these slides" | L3 | P1 | J2, INT-01-g | `feat/pdf-reader` | F-06 |
| F-08 | Progress: this week, ideas to revisit, welcome back | L4 | P1 | J4, J6 | `feat/ui-progress` | F-01 |
| F-09 | Me: settings with the live palette preview | L6 | P1 | all | `feat/ui-settings` | F-01 |
| F-10 | Facilitator panel | L6 | P0 | T23 | `feat/ui-facilitator` | F-01 |
| F-11 | Study blocks (laptop: focus reminders; lock screen in phase 2) | L5 | P2 | J5 | `feat/ui-blocks` | F-01, F-09 |
| F-12 | Concept maps (mermaid), optional | L4 | P1 | J4, INT-01-e | `feat/concept-map` | F-06; best after F-07 |

### F-01 App shell and the Focus design system (P0)

- **Its own root layout.** Move the engine's pages into a route group `app/(engine)/` (`layout.tsx`, `page.tsx`, `chat/`, `settings/`, `plugins/`; URLs unchanged) and add `app/(lockedin)/app/layout.tsx` as LockedIn's root layout: own `<html>`, own CSS and fonts, none of the engine's sidebar or Tailwind theme. `app/api` is untouched. Recorded in `NOTICE` and DECISIONS.
- **Theme engine** (`src/core/companion/palette.ts`, pure and tested): `palette(seedHue, mode, contrast) → tokens` in OKLCH with contrast guarantees; `moduleHue(code, overrides)`; `ambientStops(clockTime, quietHours)`. Tokens are CSS custom properties set on `<html>` before first paint (from the saved profile) to avoid a flash.
- `components/lockedin/`: `Rail`, `Toast`, `Card`, `Button`, `Chip`, `FocusRing`, `ActivityLine`, `SlidePanel` (placeholder until F-07), `EmptyState`, `ErrorState`, `Markdown` (Streamdown + KaTeX, existing dependencies), `Kbd`.
- Client data layer: `api.ts` (typed fetch over `/api/companion`, types from `@/src/core`), `usePoll(fn, ms, while)`, `useTick()` (every 30 s and on window focus), `useProfile()`.
- **First deliverable (M0):** the visual mock for sign-off.
- **Done when:** `/app` renders the rail and placeholder screens with the generated palette in light/dark/contrast, two seed hues, and the ambient layer following the demo clock.

### F-02 Onboarding and "What I read" (P0, J1)

Three steps, one decision each: **What are you studying?** (module chips, each showing its colour) → **Connect your calendar** (F-03 options; sample preselected and labelled) → **How often can I nudge you?** (1 a day default, or 2; quiet hours shown inline). Then **What I read** (source, events, modules, last read, "I never read your location", delete), then Today with **Try it now** on top. The palette preview appears as a small "Make it yours" chip on Today, not as a step. Logs `onboarding_step`.
- **Done when:** a new tester reaches question 1 in ≤ 60 s and ≤ 3 decision screens (measured from `onboarding_step` 1 to `question_shown`).

### F-03 Calendar connect and export (P1)

| Option | How | Backend |
|---|---|---|
| Sample timetable | Built | — |
| Upload `.ics` | File picker / drag-drop → `POST /timetable/import` | Built |
| **Subscribe to a link** (university timetables, Google, Outlook and Apple calendars all publish an iCal link) | Paste `https://…` or `webcal://…`; refreshed on open and every 6 h; **Refresh now** | **New:** `POST /timetable/subscribe {url}`, `POST /timetable/refresh`. The server fetches only http(s), 5 s timeout, 2 MB cap, no private-network addresses; the URL is stored locally and shown masked |
| **Map unknown events** | Events matching no module: assign to a module, mark "not a lecture", or ignore; remembered by title | **New:** `POST /timetable/map` |
| **Export to my calendar** | A subscribable `.ics` feed of study blocks and planned sessions with alarms, so the laptop's (and later the phone's) own calendar reminds the student | **New:** `GET /calendar.ics` (VEVENT + VALARM) |

Google/Microsoft OAuth is out of MVP 1: the link covers the same calendars without accounts or keys.
- **Done when:** a real calendar link imports, refreshes and maps unknown events, and the export feed subscribes in Apple and Google Calendar.

### F-04 Today, toasts and desktop notifications (P0)

- **Nudges:** the tick (`GET /nudges/due`) every 30 s and on window focus. A due nudge shows as a **toast** top-right (Open / Later / ✕, plus "I wasn't there" on N-1) and, if the student opted in, as a **real desktop notification** through the browser Notification API (works on `localhost`; asked once, after the first finished session, never during onboarding). Clicking either opens the pre-warmed session on question 1.
- **Today:** a time-of-day greeting; one primary card, chosen in this order: *Continue your session* → *Welcome back* → *Try it now* (first run) → *Ideas ready to revisit (n)*; then today's timetable with per-lecture status and "I wasn't there"; the next study block.
- **Done when:** J2 runs from the facilitator panel with click → question 1 ≤ 3 s; toasts never stack; a dismissed nudge never reappears.

### F-05 Session focus mode with the slide panel (P0)

Two panes in focus mode. **Left:** the focus ring and goal line, then every `SessionView` state: *preparing* (activity line), *question* (lead-in, stem, options + "I don't know", confidence stops 0/30/50/70/90/100 defaulting to 50, optional why box, Hint when `canHint`, Show me first, Check), *thinking* (feedback + "Writing question 3…"), *feedback* (right / not quite, the correct answer, the explanation, the student's own why), *done* (two-line summary, Keep going (+3), Done), *error* (plain words, Retry, Start a new session). **Right:** the slide panel, which follows the latest `(Slide n)` in the prose or feedback; clicking any slide chip moves it. Before F-07 it shows the slide's Markdown; after F-07 the PDF page. ✕ is Stop for now: no confirmation, nothing lost. A one-time tip explains confidence and why. Polls every 750 ms only while preparing or thinking. Keyboard shortcuts as in §2.3.
- **Done when:** all six states on both engines; reopening resumes on the same question; the whole session can be done from the keyboard.

### F-06 Library (P1)

Modules (in their colours) → lectures in course order with status (✓ done / ◐ ideas to revisit / · not yet), search over lecture and slide titles, and a lecture page with **Quiz me**, tabs *Slides · Concept map · Ideas to revisit*, **Add PDF** and **I wasn't there**. **Any lecture in two clicks** (INT-01-e/f). Built on `GET /roadmap`, `GET /lectures?q=`, `GET /materials/:id`.

### F-07 Slides: PDF upload, reader, quiz me on these slides (P1)

- **Upload:** students add their own slides on a lecture page (drag-drop or picker, ≤ 25 MB). The conversion report lists image-only slides with inline caption fields ("Slides 3 and 9 are images: add a one-line caption?"). **Backend:** open `POST /materials/:id` to students (today it is facilitator-only), keep the cap, add `PUT /materials/:id/captions`.
- **Reader:** the slide panel and a full reader, rendering one page at a time with `pdfjs-dist` (existing dependency): prev/next, arrow keys, page strip, zoom; falls back to the slide's Markdown without a PDF.
- **Quiz me on these slides:** "Quiz me on slides 4–6" from the reader. **Backend:** `SessionSpec.slides?: { from, to }`; the opening message includes only that range plus the other headings for context.
- **Done when:** a tester uploads a real PDF, reads it, and gets questions on a chosen range that cite those slides.

### F-08 Progress (P1)

This week (sessions, questions answered, ideas ready to revisit: plain numbers, no comparisons), **Ideas to revisit** (each miss as its question and answer; Revisit now starts a retest), the roadmap per module, links to each lecture's concept map, and the welcome-back card after 5+ days away. Never "overdue", never a streak (string-checked in tests, as the API tests already do).

### F-09 Me (P1)

Appearance with the **live palette preview**: hue wheel or Auto, per-module colours, light/dark/system, high contrast, text size, spacing, reduce motion. Nudges per day, quiet hours, evening time; desktop notifications on/off; default session mode (question me first / show me first); calendar (source, refresh, export link); What I read; Delete all my data (one click, one confirm); About and credits. Every change logs `settings_changed`.

### F-10 Facilitator panel (P0, T23)

A desktop page (ideally on a second screen) driving the tester's window: participant ID; demo clock (set, +5 min, next lecture end, next day); fire N-1…N-4 / block; scenarios (tayo, maya, returning); engine for next sessions; the upcoming-nudge list; a live event-log tail; reset (archives the log); CSV export. Gated by `COMPANION_DEMO=1`.
- **Done when:** every journey is triggerable in < 10 s.

### F-11 Study blocks (P2)

Up to two weekly blocks (pick, move, skip this week in one click). On the laptop a block start is a **focus reminder**: a toast or notification and a block screen with a timer and Start session. The simulated phone lock (decoy apps, "What do you want it for?") moves to phase 2 with the mobile layout. All backend routes exist.

### F-12 Concept maps: mermaid, optional (P1)

The engine's teacher already **plans every session as a mermaid `graph TD` concept map** (`plan_init`: nodes are ideas, `-->` means "requires"), the engine parses it into a node/edge tree (`parseMermaidPlan`, `ChatRecord.tree`), and **every question is tagged with a `nodeId` from that map**. The concept map reuses exactly that format and colours it with the student's results. It is not the engine's proposition graph, which our testing found confusing (AE2-4, AFF-H) and which costs background model calls.

- **One canonical map per lecture,** `companion/content/<lectureId>/map.mmd`: a mermaid `graph TD` whose node ids are the same slugs the scripted questions already use (`persona-purpose`, …), with slide references in the labels:
  ```mermaid
  graph TD
    lose-sight["Why designers lose users · S2"] --> persona-basis["What a persona is · S3"]
    persona-basis --> persona-purpose["What personas are for · S4"]
    persona-basis --> persona-contents["What goes in a persona · S5"]
    persona-purpose --> scenario-definition["What a scenario is · S8"]
  ```
- **The teacher plans on it.** The opening message includes the lecture's map, and the planning prompt override says "if the message gives a concept map, call `plan_init` with exactly those node slugs" (the teacher may prune to the session's scope). So LearnHarness answers and scripted answers land on the same nodes.
- **Maps for uploaded slides** that have none: the first LearnHarness session's `plan_init` map is saved as the lecture's map (the student can rename nodes); without a session yet, a starter map is built from the slide headings, one node per section in order.
- **Status per node** from every answer tagged with that node: ✓ solid (latest correct at ≥ 70% confidence), ◐ shaky (correct at low confidence, or mixed), ○ to revisit (an open miss), · not yet. Module view: one map per module whose nodes are lectures in course order, each with its own share of solid nodes.
- **Rendering** with `mermaid` (already a dependency, as the engine does), styled by `classDef` from the generated palette, plus icons and patterns for colour-blind safety. Clicking a node opens its slide in the panel, or starts "Quiz me on this idea" (a session scoped to that node and its prerequisites). "Quiz the gaps" starts a session on every ○ and ◐ node.
- **Optional:** a Settings toggle "Show concept maps", **on by default in Library, never pushed**, with `map_opened` and `map_node_clicked` events so T23 measures whether students use it.

---

## 5. Events added for T23

`slides_uploaded`, `slide_opened {from: chip | panel | reader | map}`, `calendar_connected {source}`, `calendar_refreshed`, `notifications_permission {granted}`, `map_opened`, `map_node_clicked`, `palette_changed`. Each joins `COMPANION_EVENT_TYPES` in the PR that needs it.

## 6. Backend additions (plumbing gaps MVP 1 exposes)

| # | Addition | For | Size |
|---|---|---|---|
| B-1 | Route group split: `app/(engine)` and `app/(lockedin)` root layouts | F-01 | S (moves files; URLs unchanged; `tests/render-layout.test.tsx` path updated) |
| B-2 | Calendar subscribe / refresh / map rules; `GET /calendar.ics` export with alarms | F-03 | M |
| B-3 | Student PDF upload (lift the demo gate), caption editing | F-07 | S |
| B-4 | `SessionSpec.slides` range through the opening message and the scripted engine | F-07 | S |
| B-5 | Concept maps: `map.mmd` per lecture (validated with the engine's mermaid parser), the map in the opening message, the planning override line, saving a session's `plan_init` map for lectures without one, a starter map from slide headings | F-12 | M |
| B-6 | Persisted answer records (`answers.jsonl`, with `nodeId` and slide refs; today they live only in engine records and the event log); `GET /lectures/:id/map` and `GET /modules/:code/map` returning mermaid + node statuses; `SessionSpec.nodes` for "quiz me on this idea" | F-12, F-08 | M |
| B-7 | Palette engine (pure, in core) and per-module hue overrides in the profile | F-01, F-09 | S |
| B-8 | New event types (§5) | several | XS |

## 7. Implementation details

- **Where code goes:** pages in `app/(lockedin)/app/**` (server components for the shell, client components for screens), UI in `components/lockedin/**` (imports `@/src/core` only, per the import law), the API client in `components/lockedin/api.ts`. No engine components are reused, so the look stays distinct; the engine's mermaid parser is reused server-side through the server barrel.
- **Styling:** plain CSS over generated custom properties; mode and accessibility as attributes on the LockedIn `<html>` (`data-mode`, `data-contrast`, `data-text`, `data-motion`); colours never hard-coded in components. No Tailwind in the LockedIn tree.
- **Data:** no client store library. Fetch per screen; poll only where the API says so (session while preparing/thinking; tick every 30 s and on focus); optimistic updates only for settings.
- **PDF:** `pdfjs-dist` with its worker served from `public/`; render to canvas at device pixel ratio; one page in memory at a time.
- **Mermaid:** render client-side with `securityLevel: "strict"` and attach click handlers to the rendered node elements by id (no inline `click` callbacks in the source).
- **Accessibility:** semantic radio groups for options, `aria-live="polite"` on the activity line and feedback, focus moved to each new question, visible focus, contrast mode verified; every concept map also available as an ordered list.
- **Tests:** pure tests for the palette engine (contrast guarantees for any hue), map status logic and map validation; component tests with the existing `node:test` + `tsx` setup (`*.test.tsx` already runs in `npm test`); route tests for each backend addition; a Playwright smoke for J1 and J2 on the scripted engine as a separate CI job (§9, U-7).
- **Performance budget:** first load of `/app` under 250 KB of JS gzipped (mermaid and pdfjs load on demand); click → question 1 ≤ 3 s pre-warmed.

## 8. Branches, order and milestones

```text
main
 └─ feat/ui-shell (F-01, B-1, B-7) ── merge ──┬─ feat/ui-onboarding (F-02) ─┐
                                               ├─ feat/ui-today (F-04) ──────┤  M1 "click through J1 + J2"
                                               ├─ feat/ui-session (F-05) ────┤
                                               ├─ feat/ui-facilitator (F-10) ┘
                                               ├─ feat/calendar-sync (F-03, B-2) ─┐
                                               ├─ feat/ui-library (F-06) ─────────┤  M2 "my own material"
                                               │   └─ feat/pdf-reader (F-07, B-3, B-4)
                                               ├─ feat/concept-map (F-12, B-5, B-6) ┐
                                               ├─ feat/ui-progress (F-08) ──────────┤  M3 "where am I"
                                               ├─ feat/ui-settings (F-09) ──────────┘
                                               └─ feat/ui-blocks (F-11)               stretch
```

| Milestone | Contains | Demo |
|---|---|---|
| **M0 Design sign-off** | Visual mock: two or three seed variants, module tinting, time-of-day range, focus mode, concept map | Choose the look before building |
| **M1 Core loop** | F-01, F-02, F-04, F-05, F-10 | A tester does J1 and J2 on a laptop on the scripted engine, driven from the facilitator panel |
| **M2 My material** | F-03, F-06, F-07 | Connect a real calendar link, upload real slides, get quizzed on a slide range with the slide beside the question |
| **M3 Where am I** | F-08, F-09, F-12 | J4 and J6; the live palette; concept maps coloured by results |
| **Phase 2 Mobile** | Responsive layouts (rail → tabs, panel → sheet), installable web app (PWA), phone notifications, F-11's simulated lock | The same journeys on a phone |

Each branch is one PR into `main` with the template filled in; after F-01 the branches can run in parallel.

## 9. Decisions needed before building

| # | Question | Recommendation |
|---|---|---|
| U-1 | The design direction (§2.2): a generated palette from one seed hue, module colours, time-of-day ambience, focus mode. Choose the variant from the M0 mock | Yes; pick from the mock |
| U-2 | Navigation: a left rail with Today · Library · Progress · Me | Yes |
| U-3 | Concept maps as mermaid `graph TD` in the teacher's own plan format, a canonical map per lecture, on in Library but never pushed | Yes |
| U-4 | Calendar link subscriptions mean the server fetches a URL the student pastes. OK for a local prototype? | Yes, with the restrictions in F-03 |
| U-5 | Students upload their own slides (PDFs stay in the laptop's data directory) | Yes; T23 uses the facilitator's copies |
| U-6 | Real desktop notifications (opt-in, asked after the first session) plus the calendar export as reminders | Yes |
| U-7 | Playwright for the J1/J2 smoke (new dev dependency, separate CI job) | Yes, after M1 |
| U-8 | T23 on laptops (D-8), with phones in phase 2 | Yes |
| U-9 | Fonts: a display face (Bricolage Grotesque or Space Grotesk) plus Atkinson Hyperlegible for body text | Decide in the mock |
