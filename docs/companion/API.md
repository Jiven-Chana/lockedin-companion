# Companion HTTP API

All routes live under `/api/companion/`. They are thin wrappers over `CompanionService` (`src/server/companion/service.ts`). Types are in `src/core/companion/types.ts` and importable by the UI from `@/src/core`.

**Conventions**
- JSON in and out. Errors are `{ error, code, detail? }` with a meaningful status: `400 bad_request`, `404 *_not_found`, `409` conflicts (`question_not_pending`, `turn_running`, `not_onboarded`, `nudge_already_handled`), `422 no_scripted_set`, `502/503/504` engine failures (`models_not_configured`, `provider_key_missing`, `timeout`).
- `204` with no body where noted.
- LearnHarness's `proxy.ts` applies its host and same-origin write checks to every `/api` route. There is no login: localhost or a trusted hotspot only.
- Facilitator routes (marked **demo**) return `404` unless `COMPANION_DEMO=1`.
- Option indices are **1-based**, in display order, as LearnHarness records them.

## Setup and profile

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/health` | | `{ ok, defaultEngine, engineOverride, autoFallback, onboarded, lectures, now, engines: { learnharness: { strongModel, providerKeyPresent } } }` |
| POST | `/onboarding` | `{ modules?: string[], timetableSource?: "sample" \| "ics", nudgesPerDay?: 1 \| 2 }` | `{ profile, reads, tryNow: { lectureId, title, module, spec } \| null }` |
| GET | `/profile` | | `{ profile: Profile \| null }` |
| PUT | `/profile` | `{ prefs?: { nudgesPerDay, quietHours: {from,to}, lock: "off"\|"gentle"\|"firm", defaultMode, eveningTime }, appearance?: { theme, accent, textSize, lineSpacing, reduceMotion } }` (partial) | `Profile` |
| GET | `/reads` | | "What I read": `{ source, label, events, lectures, modules, weekdays, lastReadAt, location: "never read" }` |
| DELETE | `/data` | | `{ deleted: true }`. Deletes the student's records, sessions (and their LearnHarness chats) and the event log; lecture materials stay |

## Timetable, lectures, materials

| Method | Path | Body / query | Returns |
|---|---|---|---|
| POST | `/timetable/import` | `.ics` text, or `{ ics }` | `{ added, unmapped: [{ summary, start, end }] }` |
| GET | `/lectures` | `?module=HCI&q=personas` | `{ lectures: (Lecture & { status: "answered" \| "revisit" \| "not-started", revisit })[] }` |
| POST | `/lectures/:id/missed` | `{ missed?: boolean }` (default true; false undoes) | `Lecture` |
| GET | `/roadmap` | | `{ [module]: LectureWithStatus[] }` in course order |
| GET | `/materials/:lectureId` | | `{ lectureId, hasMaterials, hasPdf, slides: [{ number, title }] }` |
| GET | `/materials/:lectureId/pdf` | | the slide PDF (for the slide sheet; render page n with pdfjs) |
| POST | `/materials/:lectureId` | **demo.** PDF bytes, or multipart `file` | `{ lectureId, slideCount, needsCaption: number[], slides }`. Pages in `needsCaption` had no text (no OCR): caption them by hand in `slides.md` |

## Nudges

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/nudges/due` | | `{ nudge: (NudgeRecord & { ready }) \| null, prepared: string[] }`. **The tick.** Call every 30 s and after the demo clock changes. It pre-warms sessions for upcoming nudges, fires at most one due nudge, and returns the banner to show (the newest un-actioned nudge today) |
| POST | `/nudges/:id/open` | | `{ nudge, sessionId }`: go to the session screen |
| POST | `/nudges/:id/snooze` | | `{ nudge, returnAt }`: one tap, never asks why; comes back as N-4 |
| POST | `/nudges/:id/dismiss` | | `{ nudge }` |
| POST | `/nudges/:id/wasnt-there` | | `{ nudge }` (N-1 only): marks the lecture missed, so N-3 can offer it |

## Sessions

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/sessions` | `{ kind: "post-lecture" \| "missed-lecture" \| "retest" \| "try-now" \| "block", lectureId, mode?, questions?, missIds?, engine? (demo) }` | `{ sessionId }` immediately; preparation continues in the background |
| GET | `/sessions/:id` | | `SessionView`. **Poll every ~750 ms while `status` is `preparing` or `thinking`**, stop otherwise |
| POST | `/sessions/:id/answer` | `{ questionId, indices: number[] \| dontKnow: true, confidence?: 0\|30\|50\|70\|90\|100, why? }` | `{ correct, graded }`, then poll |
| POST | `/sessions/:id/hint` | `{ questionId }` | `{ text }`. LearnHarness side question with no access to the answer key |
| POST | `/sessions/:id/show-me` | `{ questionId }` | 204, then poll: a worked example, then a fresh question on the same idea |
| POST | `/sessions/:id/more` | `{ questions?: number }` (default 3) | `{ budget }`: "Keep going" |
| POST | `/sessions/:id/stop` | | 204. No model call; reopening resumes on the same question |
| POST | `/sessions/:id/retry` | | 204. Recovers a failed or interrupted turn |
| GET | `/sessions/:id/cost` | **demo.** | `{ sessionId, engine, cost }` (USD; checkpoint criterion 4) |

`SessionView` (see `types.ts`): `{ id, engine, kind, mode, lecture, goal, status: "preparing" | "question" | "thinking" | "done" | "error", activity?, answered, budget, prose?, question?: { id, kind: "quiz" | "ask", stem, context?, options: [{ index, label }], multi, role }, feedback?: { questionId, correct, dontKnow, shown, correctLabels, explanation?, slideRefs }, canHint, endedEarly?, error?, slideRefs }`.

Screen logic in one line per state: **preparing**: show `activity` ("Reading your HCI slides → writing question 1"), never a bare spinner. **question**: render `prose` (Markdown, KaTeX) then `question`; show Hint only if `canHint`. **thinking**: show `feedback` for the answered question and `activity`. **done**: two-line summary from `prose`, "Keep going" → `/more`. **error**: offer Retry (`/retry`) or a new session. When `feedback.shown` is true it was a "show me first" request, not an attempt: don't render it as wrong.

## Study blocks and the simulated lock

| Method | Path | Body | Returns |
|---|---|---|---|
| GET / PUT | `/blocks` | `StudyBlock[]` or `{ blocks }`: up to 2 of `{ id, weekday: 1–7, start: "HH:MM", minutes: 10–120, lectureId?, skippedDates: [] }` | `{ blocks }` |
| POST | `/blocks/:id/skip` | `{ date?: "YYYY-MM-DD" }` (default: the next occurrence) | `StudyBlock` |
| GET | `/blocks/active` | | `{ active: { block, startedAt, endsAt, minutesLeft, onBreak, phaseEndsAt } \| null, lock, simulated: true }` |
| POST | `/blocks/app-open` | `{ app, confirmed?, reason? }` | `{ allowed: true, reason, until? }` or `{ allowed: false, prompt: "confirm" \| "why", message }`. Ask, then call again with `confirmed: true` (gentle) or `reason` (firm). There is always a way out |

## Progress and Today

| Method | Path | Returns |
|---|---|---|
| GET | `/today` | `{ now, onboarded, tryNow, lectures (today, with status), nextBlock, readyToRevisit, welcomeBack, banner, activeSession }` |
| GET | `/progress` | `{ week: { sessions, questionsAnswered, readyToRevisit }, welcomeBack: { text, spec, daysAway } \| null, roadmap }` |

## Event log (T23)

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/events` | `{ type, data }` or an array (types: `onboarding_step`, `settings_changed`, `block_started`, `error`) | `{ logged }` |
| GET | `/events.csv` | **demo.** | CSV: `t, wall, participant, type, data` |

Server-side events are logged automatically: `onboarding_done`, `nudge_fired/opened/snoozed/dismissed`, `wasnt_there`, `session_prepare_started`, `session_prepared` (with `latencyMs`), `session_opened`, `question_shown` (with `msSinceOpen`), `answer` (correct, confidence, why length, assisted, `msOnQuestion`, miss reason), `hint`, `show_me`, `keep_going`, `session_done`, `session_stopped`, `block_started`, `app_open_blocked`, `lock_override`, `settings_changed`, `engine_fallback`, `error`.

## Facilitator (demo)

| Method | Path | Body | Effect |
|---|---|---|---|
| GET | `/demo/state` | | Demo clock, participant, engine override, upcoming nudge candidates, banner, scenario names |
| POST | `/demo/clock` | `{ set: ISO }` \| `{ advanceMinutes }` \| `{ jump: "next-lecture-end" \| "next-day" \| "reset" }` | Moves the demo clock (stored, so every route and a restart agree) |
| POST | `/demo/fire` | `{ type: "N-1" \| "N-2" \| "N-3" \| "N-4" \| "block", lectureId? }` | Fires now, outside the rules (logged as `forced`) |
| POST | `/demo/scenario` | `{ name: "tayo" \| "maya" \| "returning" }` | Reset, place the clock, onboard, apply the preset (from `companion/content/sample-timetable.json`) |
| POST | `/demo/reset` | | Reset all data and the clock; the event log is **archived** to `data/companion/archive/`, never lost |
| POST | `/demo/participant` | `{ participant: "P03" \| null }` | Stamped on every event |
| POST | `/demo/engine` | `{ engine: "learnharness" \| "scripted" \| null }` | Engine for the next sessions |
