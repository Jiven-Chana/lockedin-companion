# Companion HTTP API

All routes live under `/api/companion/`. They are thin wrappers over `CompanionService` (`src/server/companion/service.ts`). Types are in `src/core/companion/types.ts` and importable by the UI from `@/src/core`.

**Conventions**
- JSON in and out. Errors are `{ error, code, detail? }` with a meaningful status: `400 bad_request`, `404 *_not_found`, `409` conflicts (`question_not_pending`, `turn_running`, `not_onboarded`, `nudge_already_handled`, `block_overlaps`, `block_not_today`), `422 no_scripted_set`, `502/503/504` engine failures (`models_not_configured`, `provider_key_missing`, `timeout`).
- `204` with no body where noted.
- LearnHarness's `proxy.ts` applies its host and same-origin write checks to every `/api` route. There is no login: localhost or a trusted hotspot only.
- Facilitator routes (marked **demo**) return `404` unless `COMPANION_DEMO=1`.
- Option indices are **1-based**, in display order, as LearnHarness records them.

## Setup and profile

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/health` | | `{ ok, ai: { connected, provider, modelsReady, ready, blocker } \| null, defaultEngine, engineOverride, autoFallback, onboarded, lectures, now, engines: { learnharness: { strongModel, providerKeyPresent } } }`. `defaultEngine` is `learnharness` once `ai.ready` (unless `COMPANION_ENGINE` is set) |
| POST | `/onboarding` | v0.1: `{ calendar: { kind: "sample" \| "link" \| "file" \| "none", url?, text? }, modules: [{ name, code? }], nudgesPerDay? }` (modules not needed for `sample`; a missing code is made from the name) | `{ profile, reads, calendar: { added, unmapped } \| null, firstTaste: { lectureId, title, module, sample: true, spec } \| null }`. A link is fetched before anything is saved. The v0.0 body `{ modules?: string[], timetableSource?, nudgesPerDay? }` still returns `{ profile, reads, tryNow }` |
| POST | `/onboarding/calendar` | `{ url }` or `{ text }` | `{ events, modules: [{ code, name, events, confident }] }`. Reads a calendar without saving anything; `confident` modules start ticked |
| POST | `/onboarding/first-taste` | | `{ sessionId, lectureId, title, module, sample, spec }`. Starts preparing the 3-question first taste on the bundled sample lecture (O-3). The only session allowed before onboarding |
| GET | `/profile` | | `{ profile: Profile \| null }` |
| PUT | `/profile` | `{ prefs?: { nudgesPerDay, quietHours: {from,to}, lock: "off"\|"gentle"\|"firm", defaultMode, eveningTime }, appearance?: { theme, accent, textSize, lineSpacing, motion: "calm"\|"full"\|"off" } }` (partial) | `Profile`. A motion change logs `motion_changed` (F-118) |
| GET | `/reads` | | "What I read": `{ source, label, events, lectures, modules, weekdays, lastReadAt, location: "never read", link, refreshedAt, timeZone }`. `link` is masked (host and the end of the file name, never the private token). A subscribed link is re-read when the app opens and every 6 hours (F-108) |
| DELETE | `/data` | | `{ deleted: true }`. Deletes the student's records, sessions (and their LearnHarness chats) and the event log; lecture materials stay |

## The first run (v2.0 step 7; V-45, V-63 to V-66)

Five steps (sign in, timetable, slides, week, phone); every step but sign-in can be left for later. A profile made here is not `onboarded` (in `GET /today`) until `POST /setup/done`.

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/setup` | | `SetupView`: `{ started, done, step: 1–5, phone: { available, paired }, calendar, modules: [{ code, name, units, preparing, ready, list: [{ id, title, week }] }], week: SetupWeek \| null, end: { lectureId, module, title } \| null }`. `started` is false until the timetable step has made the profile; `done` is true for anyone set up before v2.0 |
| POST | `/setup/timetable` | `{ calendar: { kind: "link", url } \| { kind: "file", text } \| { kind: "none" }, modules: [{ name, code? }], timeZone? }` | `SetupView`. Makes the profile the first time, with no modules if there are none ("Later"). Sent again, it adds what is new. `409 already_set_up` once setup is over |
| POST | `/setup/step` | `{ step: 2–5 }` | `SetupView`: the step reached, so a closed tab reopens there |
| POST | `/setup/week` | `{ energy?: ("morning" \| "afternoon" \| "evening")[], weeklyTargetMinutes? }` | `SetupWeek`: `{ energy, target, week, blocks: [{ id, date, start, minutes, module, title, why }], message }`. What isn't sent stays as it was; the total starts at 300. Suggests the week again each call, and plans next week when this one has no room left. "Looks good" is `POST /blocks/accept { week }` |
| DELETE | `/setup/week` | | `SetupView`. "Later": the total and the suggested blocks go. Blocks already accepted stay |
| POST | `/setup/done` | | `SetupView` with `done: true`. Logs `onboarding_done` (`flow: "v2.0"`) once |
| POST | `/modules` | `{ name }` | `{ code, name }`: "+ Add a module" (V-64), in setup and the Library. `400` for an empty or repeated name, or more than 20 modules |
| PUT | `/modules/:code/share` | `{ share: "less" \| "normal" \| "more" }` | The module with its share of the week (V-63). `GET /course` carries `share` when it isn't normal |
| POST | `/modules/:code/materials/quick` | multipart `file` fields | `{ units, skipped }`: read, split and save every unit with enough text, with no checklist (V-66). `400` when nothing is worth studying |
| PUT | `/lectures/:id/title` | `{ title }` (1 to 120 characters) | The unit. Only for a unit made from the student's own material |

`GET /plan` blocks carry `why` (a sentence, or null for a block the student made or moved) and each stored block `placed`: `{ by: "anchor" } \| { by: "energy", when } \| { by: "after-lecture", module } \| { by: "gap" }`.

## Connect your AI (v0.1 F-101)

The student's AI connection and LearnHarness's three model slots (Strong, Cheap, Vision). Every call goes through the engine's own sign-in, key and settings functions (`lh-port.ts` `createAiPort`). `AiStatus` = `{ provider, chatgpt: { connected, pending, allowBackgroundUse, email, error, available }, keys: { anthropic, openai, openrouter }, slots: { strong?, cheap?, vision? }, modelsReady, ready, blocker, catalog: [{ id, name, provider, input, reasoning, supportedLevels, cost }] }`. Events: `ai_connected`, `ai_disconnected`, `ai_error`, `engine_ready`.

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/ai` | | `AiStatus` (refreshes the catalogue) |
| POST | `/ai/chatgpt` | `{ op: "login" \| "cancel" \| "logout" \| "consent", enabled? }` | `{ browserAction?, error?, status: AiStatus }`. For `login`, open a tab synchronously in the click, then point it at `browserAction` (same machine only: the OpenAI callback is on 127.0.0.1). Poll `GET /ai` until `chatgpt.connected` |
| POST | `/ai/key` | `{ provider: "anthropic" \| "openai" \| "openrouter", key }` | `AiStatus`. The key is checked with one cheap request to that provider and only saved if it works; `400 key_rejected` with a plain message otherwise |
| PUT | `/ai/models` | `{ strong, cheap, vision }`, each `{ model: { provider, id }, thinkingLevel? }` | `AiStatus`. `400 models_invalid` with `detail` per slot (unknown model, Vision without image input) |
| POST | `/ai/models/auto` | `{ provider? }` | "Choose for me": `AiStatus & { missing, saved }`. Slots the account can't fill are returned unsaved in `missing` |
| POST | `/ai/voice` | `{ key: string \| null }` | Me → Voice (F-116): saves the student's own Deepgram key after checking it can mint a dictation token (Member permission), or removes it (`null`) → `AiStatus` with `voice`. `400 key_rejected` with the reason. The Speak button is shown only when `voice` is true |
| DELETE | `/ai` | `?provider=` | Signs out of ChatGPT or deletes the key, and clears slots that used it → `AiStatus` |

## Timetable, lectures, materials

| Method | Path | Body / query | Returns |
|---|---|---|---|
| POST | `/timetable/import` | `.ics` text, or `{ ics }` | `{ added, unmapped: [{ summary, start, end }] }`. Parsed with ical.js (v0.1 F-108): TZID and VTIMEZONE, RRULE, EXDATE, RECURRENCE-ID, DURATION; all-day events become busy events; floating times are read in the profile's `timeZone`. Re-imports merge (F-104) |
| POST | `/timetable/subscribe` | `{ url }` (`https://` or `webcal://`) | Same as import. The server fetches the link with guards: http(s) only, no private/loopback addresses, no redirects, 5 s, 2 MB. The link is remembered for refreshes |
| POST | `/timetable/refresh` | | Re-reads the subscribed link |
| GET | `/modules` | | `{ modules: [{ code, name }], label }` for onboarding |
| GET | `/lectures` | `?module=HCI&q=personas` | `{ lectures: (Lecture & { status: "answered" \| "revisit" \| "not-started", revisit })[] }` |
| POST | `/lectures/:id/missed` | `{ missed?: boolean }` (default true; false undoes) | `Lecture` |
| PUT | `/lectures/:id/week` | `{ week: 1–52 }` | The unit, with its week set (v1.0, V-25: "Set week" on a unit that reads "Week not set"). `400` for a timetabled lecture, whose week comes from the calendar. Logs `unit_week_set` |
| GET | `/roadmap` | | `{ [module]: LectureWithStatus[] }` in course order |
| GET | `/materials/:lectureId` | | `{ lectureId, hasMaterials, hasPdf, slides: [{ number, title }] }` |
| GET | `/materials/:lectureId/slides` | | `{ slides: [{ number, title, body }], hasPdf }` for the slide panel. Slide numbers are the original file's page numbers, so a unit can run 18 to 38. `hasPdf` is true only when the stored PDF has content |
| GET | `/materials/:lectureId/pages/:n` | | The picture (PNG) of page n of the unit's own PDF (v1.0, V-21). Drawn once and kept in `materials/<id>/pages/`. 404 `page_not_found` when the unit has no PDF or page n isn't one of its slides |
| GET | `/lectures/:id/map` | | The concept map: `{ source: "authored" \| "headings", mermaid, nodes: [{ id, title, slides, status: solid \| shaky \| revisit \| notyet, answers }], edges: [{ from, to }] }` |
| GET | `/misses` | `?lectureId=` | Ideas to revisit (open misses): `{ misses: [{ id, lectureId, lectureTitle, module, questionText, correctLabels, explanation, reason, createdAt, nextDue }] }` |
| GET | `/materials/:lectureId/pdf` | | the whole slide PDF. No screen uses it; the slide panel uses `/pages/:n` |
| POST | `/materials/:lectureId` | PDF bytes, or multipart `file` | Replaces the material of a lecture or course unit → `{ lectureId, slideCount, needsCaption: number[], slides }`. Pages in `needsCaption` had no text (no OCR). Open to everyone since v0.1 (F-104) |
| DELETE | `/materials/:lectureId` | | A course unit is hidden (history kept); a timetable lecture loses its uploaded material |

### Study packs (v0.1 F-105, F-106)

When units are saved and the student's AI is ready, each unit's pack is written in the background, one unit at a time:
1. read its slides;
2. the concept map (`map.mmd`; an authored one is kept), on the Strong slot;
3. 12 to 20 three-option questions (`bank.json`), on the Cheap slot;
4. one explainer per idea (`explainers.json`): ≤ 120 words, one mermaid diagram, slide citations, and a "Try it" question from the bank. Strong slot.

Every item is checked (`study-pack.ts`). The model retries while too few pass, and items that still fail are dropped and listed in `meta.dropped`. The bank is also the scripted engine's question set for that unit. Events: `pack_started`, `pack_stage`, `pack_retry`, `pack_ready`, `pack_failed`.

Since v1.0 (V-23), a pack survives a bad minute:
- a stage that fails is tried again after 10 s, 30 s and 90 s (`PACK_RULES.retryDelaysMs`), then the pack fails with `meta.error` in plain words and the provider's own message in `meta.errorDetail` and the `pack_failed` event;
- while the AI connection is down the pack waits (`meta.waiting.for: "connection"`) without using up a try, and the packs behind it stay `queued`;
- when the app next starts with the AI ready, packs that were queued or being written are picked up, and uploaded units with no pack get one. Failed and cancelled packs wait for the student;
- a unit with under 500 characters of text fails at once with `failure: "too_short"` (and can no longer be saved, V-24).

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/lectures/:id/pack` | | `{ meta: { state: "queued" \| "generating" \| "ready" \| "failed" \| "cancelled", waiting?, failure?, stages: { read, map, bank, explainers }, models, costUsd, ms, dropped, counts, error?, errorDetail? } \| null, explainers, questions, running }`. `packStatusLine(meta)` is the one line the lecture page shows |
| POST | `/lectures/:id/pack` | `{ fresh?: boolean }` | Starts or resumes (from the first unfinished stage); `fresh` regenerates everything. `409 not_connected` without a ready AI |
| DELETE | `/lectures/:id/pack` | | Cancels; resumable |

`POST /sessions` accepts `nodes: string[]` (concept-map node ids, F-106): the session asks only about those ideas.

### Course material and the module calendar (v0.1 F-104, V-18)

A **course unit** is a `Lecture` with no `start`/`end`, made from the student's material (spec §5.5). Calendar re-imports merge: units, uploads and "I wasn't there" survive, and events that vanished are archived (hidden, kept as history).

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/course` | | `[{ code, name, weekOneStart?, readingWeeks?, week, reading, units: LectureWithStatus[] }]` |
| PUT | `/modules/:code` | `{ week: 1–52 \| null, readingWeeks?: number[], inReadingWeek?: boolean }` | "This is week N": the module with `{ week, reading }` |
| POST | `/modules/:code/materials` | multipart: one or more `file` (PDF, `.md`, `.txt`, 25 MB each, at most 20), and/or `text` (+ `name`) for pasted notes | `{ uploadId, files: [{ file, name, kind, pageCount, noText, units: [{ title, week, pages: [from, to], chars }], via: "name" \| "ai" \| "fallback", note }] }`. `chars` is how much text the unit holds: under 500 it can't be saved (V-24). Nothing is saved as material yet; the proposal is held 24 h. A file with a week in its name, or "Week N" page headings, needs no AI; a longer unlabelled file is split by the Cheap slot |
| PUT | `/modules/:code/materials` | `{ uploadId, units: [{ file, title, week, pages }] }` | `{ units: Lecture[] }`. Each unit's `slides.md` holds only its pages, numbered as in the original file; one copy of each PDF is kept. `400` on overlapping or out-of-range pages, or a unit with too little text. On a profile still on the sample timetable, saving hides the sample lectures (archived, never deleted) and logs `sample_hidden` (V-26) |

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
| POST | `/sessions/:id/retry` | | 204. Recovers a failed or interrupted turn. On a session that never reached question 1 it asks the teacher again and the view goes back to `preparing` |
| POST | `/sessions/:id/practice` | | `{ sessionId }`: "Use practice questions". A new session for the same lecture on its question bank, without the AI. Only for a failed session whose view has `practiceAvailable: true`; logged as `engine_fallback {chosen: true}` |
| GET | `/learn?module=CODE` | | The module's Learn start sheet (v2.0 step 5): `{ module, connected, minutes, suggestion: { type: "resume", sessionId, lectureId, title, at } \| { type: "next", lectureId, title } \| null, week: { week, lectureIds } \| null, lectures, topics }`. `topics` are what a typed goal is matched against in the browser |
| POST | `/learn` | `{ lectureId, nodes?, goal? }` or `{ module, week: true, goal? }` | `{ sessionId }`: start Learn (V-47). `409 not_connected` with no AI connected, `409 no_material`, `409 nothing_this_week` |
| POST | `/sessions/:id/say` | `{ text, questionId? }` or `{ say: "skipProbe" \| "planOk" \| "carryOn" }` | `{ queued, answer }`. Learn only (`409 not_learn`). With `questionId` the tutor answers beside the open question (`answer`), which stays open. `queued: true` when the tutor was writing and takes it at its next pause |
| POST | `/sessions/:id/how` | `{ start?: "examples" \| "questions" \| "explanations", steps?: "small" \| "big", check?: "often" \| "end", more? }`, `{ same: true }` or `{ skip: true }` | `{ ok }`: the first-time card (v2.0 step 6, V-52). A module's first Learn session has `status: "ask"` and `ask: { module, name, canCopy }` until this is called; the tutor then starts. The module is never asked again |
| GET / PUT | `/modules/:code/notes` | PUT `{ how?: string, where?: string }` (120 and 250 words at most; an empty string clears) | `{ module, asked, how, where, last }`: what LockedIn knows about the student in that module (V-53). `where` is rewritten by the AI after each Learn session; `last` is the last session's plan and where it stopped |
| POST | `/sessions/:id/finish` | | `{ ok }`: the student's "Finish". A Learn session is never ended for them |
| GET | `/sessions/:id/steps` | | `{ steps: LearnItem[][] }`: every step of a Learn session so far, oldest first ("Earlier") |
| GET | `/sessions/:id/cost` | **demo.** | `{ sessionId, engine, cost }` (USD; checkpoint criterion 4) |

**Learn (v2.0 step 5).** `POST /sessions` also takes `kind: "learn"` and `study: "learn" | "practise"`; any session the tutor runs is Learn and any on the question bank is Practise. A Learn view has `status` `"reply"` as well (the tutor has spoken and waits), no question count, and `learn: { phase: "probe" | "plan" | "teach", step: LearnItem[], earlier, plan?, minutes, endsAt?, timeUp, finished, covered?, unit? }`. A step is everything since the last answer; the screen shows one step at a time. `question.kind` may be `"write"` (answer with `{ questionId, text }`), and `question.guess` marks a question that is never marked. Poll while `preparing` or `thinking`, and every few seconds while a step holds a `making` item.

`SessionView` (see `types.ts`): `{ id, engine, kind, mode, lecture, goal, status: "preparing" | "question" | "thinking" | "done" | "error", activity?, answered, budget, prose?, question?: { id, kind: "quiz" | "ask", stem, context?, options: [{ index, label }], multi, role }, feedback?: { questionId, correct, dontKnow, shown, correctLabels, explanation?, slideRefs }, canHint, endedEarly?, error?, slideRefs }`.

Screen logic in one line per state: **preparing**: show `activity` ("Reading your HCI slides → writing question 1"), never a bare spinner. **question**: render `prose` (Markdown, KaTeX) then `question`; show Hint only if `canHint`. **thinking**: show `feedback` for the answered question and `activity`. **done**: two-line summary from `prose`, "Keep going" → `/more`. **error**: offer Retry (`/retry`) or a new session. When `feedback.shown` is true it was a "show me first" request, not an attempt: don't render it as wrong.

## The week: target, plan, routine, check-in (v0.1 F-109, F-110, F-111, V-18)

The planner proposes blocks in free gaps. It never places one over a lecture, event, routine commitment or quiet hours, and puts at most 2 on a day. It prefers last week's slots, then the student's energy windows, then the gap right after a lecture. Each block's focus comes from the pacing rule (spec §5.5): keep up first, and catch-up on weak older units gets at most a third of the week (no limit in a reading week).

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/plan` | `?week=YYYY-MM-DD` (default this week) | `{ week, target, blockMinutes, committedMinutes, proposedMinutes, blocks: (StudyBlock & { focus: { title, module } \| null, module: string \| null, firstStep: string \| null, canStart: boolean })[], lectures, commitments, quietHours: { from, to }, modules: { code, name, hasMaterial }[] }`. A block's `module` is the student's choice, else its unit's, else `null` (free study). `quietHours` and `modules` are what the timetable needs (v1.1, V-37). `firstStep` is the block's tiny first step in words ("First step: slide 12, one question") and `canStart` says whether it can be started now (v1.1.1, V-44) |
| POST | `/plan` | `{ week? }` | Proposes blocks to meet the target, replacing that week's earlier proposals (accepted ones stay) → plan + `{ roomMinutes, fits, message }`. `message` is "Your week only has room for 3 h 20. I've planned that." when the target doesn't fit. `409 no_target` without a target |
| POST / DELETE | `/plan/replan` | | **v2.2.** POST: "Re-plan the rest of my week". Every kept block of this week whose time has passed without being started moves to a free time from now to Sunday (the emptiest day first, at most two blocks a day), or to next week when this one has no room → the plan + `{ message }` ("Moved 2 blocks to free times, 1 of them next week."). DELETE undoes the last re-plan, on the day it was made and while every moved block is still where it was put → the plan + `{ message }`; `409 nothing_to_undo` otherwise. `GET /plan` carries `replan: { open, moved, canUndo }` and, on each block, `notStarted` and `moved`. Events `plan_replanned`, `plan_replan_undone` |
| PUT | `/plan/settings` | `{ weeklyTargetMinutes?, blockMinutes?, sundayTime?, focusScreen? }` | The plan settings |
| POST | `/routine` | `{ routine: { energy, commitments, places, weeklyTargetMinutes, preferredBlockMinutes? }, source: "chat" \| "form", modules?: [{ code, week, readingWeeks? }] }` | Saves the confirmed routine (and module weeks), then proposes this week → `{ routine, plan }` |
| GET | `/checkin` | | `{ started, minutes, text, target, nextWeek, roomMinutes, feelings }`. On a Sunday it looks back on the week ending today. It counts blocks *started*, never missed ones |
| POST | `/checkin` | `{ feeling }`, then `{ target }` or `{ keep: true }` | A feeling only proposes a new target (±30 min, at least 30 min, at most next week's room). The target changes only on the confirm. Confirm or keep then proposes next week → `{ target, plan }` |

## Nudges v2 and the week ahead (v0.1 F-114, F-111)

- `prefs.nudgesPerDay` is 0, 1 or 2. 0 is silent on laptop and phone; the student starts from Today.
- **N-1 v2:** the notification *is* the question. `title` is "HCI just finished. One question:" and `text` is a bank question's stem (`questionId` is set). With no question ready it falls back to the v1 sentence. Under V-18 it fires after any timetabled lecture the student attended, and teaches that lecture's own material, or the module's current-week unit by the pacing rule.
- **N-5:** on Sunday at `plan.sundayTime`, once, when a weekly target is set. It counts as that day's nudge. Opening it returns `{ href: "/app/plan?checkin=1" }` instead of a session.
- **Why now:** every nudge carries `why` (R-7), e.g. "after HCI · you're free until 15:00".

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/nudges/schedule` | | `{ now, nudges: [{ id, fireAt, kind, title, body, why?, lectureId?, module?, opens: "question" \| "session" \| "checkin", question?: { id, lectureId, stem, options, correct, explanation, slides }, snoozeFireAt, expiresAt }] }`. The next 7 days, planned with the live rules (cap, quiet hours, priorities), for the phone relay (F-112). Ids are the nudge keys, so re-planning gives the same ids |

Facilitator: `POST /demo/clock { jump: "sunday-evening" }` jumps to the coming Sunday at the check-in time; `POST /demo/fire { type: "N-5" }` fires the check-in nudge.

## The phone (v0.1 F-112)

On when `COMPANION_RELAY_URL` is set (`501` otherwise). The laptop talks to the relay (`relay/README.md`) over outbound HTTPS only; it uploads the week from `/nudges/schedule` when it changes (and at least every 30 minutes) and pulls the phone's events every minute from the tick.

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/phone` | | `{ paired, relay, phoneSeenAt?, pushReady?, uploadedAt?, holds, reachable? }`. `holds` is the plain-words list of what the relay stores (R-7) |
| POST | `/phone/pair` | | `{ url, qrSvg, code, codeExpiresAt, address, …status }`. Pairs, or shows the pairing again. `url` is what the QR code holds; `code` is the 6-digit code an iPhone's Home Screen app asks for (v1.0.3; `null` when the relay can't be reached; it lasts 10 minutes and asking again returns the same one while it lasts); `address` is the phone app's address without the pairing, for typing when the camera won't scan |
| POST | `/phone/test` | | `{ nudgeId, title, body, arrivesWithinSeconds }`: "Send a test question to my phone" (v1.0.4). One question from the student's own study packs, on the phone within a minute. Its id starts `test:`, so it never counts toward the daily cap. `409 nothing_to_send` when no unit has a question bank; `409 phone_not_paired`. Logs `phone_test_sent` |
| POST | `/phone/unpair` | | `{ paired: false }`. Deletes the pair and everything the relay holds for it |
| POST | `/phone/sync` | | `{ uploaded, replayed }`. Upload now and pull events now (Me → Phone → Sync now) |

Phone events are replayed exactly once each, in order, logged under their own type with `source: "phone"`. `answered` marks the laptop's copy of that nudge handled (a wrong answer becomes an idea to revisit); `handover` creates a post-lecture session whose spec carries `seedAnswer`, so it opens at question 2, and a `handoff:<id>` nudge is the toast. Plan edits are last-write-wins; edits to blocks removed on the laptop are ignored and logged as `relay_error`.

**v2.2:** a block that is today or tomorrow is uploaded with `round`, up to five questions from its unit's bank, for "On the move". An answer given there is an `answered` event with `blockId` and `onTheMove: true`, saved like any phone answer. The place picked on a block's start is a `block_where` event, `{ blockId, place }`, which is logged and nothing more.

Facilitator: `POST /demo/phone { action: "answer" \| "handover" \| "done", correct?: boolean }` plays the phone's events on the laptop without a phone or relay.

## Study blocks and the simulated lock

| Method | Path | Body | Returns |
|---|---|---|---|
| GET / PUT | `/blocks` | `StudyBlock[]` or `{ blocks }` of `{ id, date: "YYYY-MM-DD", start: "HH:MM", minutes: 10–120, status, source, lectureId? }` (v0.1: dated blocks; v0.0's weekly slots are dropped on read) | `{ blocks }` |
| PUT | `/blocks/:id` | `{ status?: "accepted" \| "started" \| "removed", date?, start?, minutes?, source?, module?: string \| null }` | One action on a block (F-110). A move keeps its focus and chooses a proposal. A move onto a lecture, a routine commitment, another block, quiet hours or past midnight is refused: `409 block_overlaps`, `error` is the line to show, `detail.problem` is `lecture`, `commitment`, `block`, `quiet` or `past-midnight`, and the block stays where it was (v1.1, V-37). `module` is one of the student's module codes (the block then studies that module's next unit) or `null` for free study; `400` for an unknown code. Logs `plan_accepted`, `plan_moved`, `plan_removed`, `block_started` or `plan_module_set` |
| POST | `/blocks/:id/start` | `{ study?: "learn" \| "practise" }` | Start a study block (v1.1.1, V-44; v2.0 step 5: in the mode the block suggests, or the one given. `GET /plan` and `GET /today` carry each block's `mode: { study, label, other }`) → `{ block, sessionId \| null }`. Marks it `started` and opens a `block` session on its unit (else the latest lecture), beginning on its first step. A block starts on its own day: `409 block_not_today` otherwise, and `PUT /blocks/:id { status: "started" }` refuses the same way. Starting a started block opens a session again and counts once. Logs `block_started { via: "start" }`; opening the block's notification does the same with `via: "nudge"` (a `block_started` with no `via` is the notification firing) |
| POST | `/blocks/accept` | `{ ids? }` or `{ week? }` | Accepts the listed proposals, or every proposal that week → the plan |
| POST | `/blocks/:id/skip` | | Removes the block (one tap, X-7) → `StudyBlock` |
| GET | `/blocks/active` | | `{ active: { block, startedAt, endsAt, minutesLeft, onBreak, phaseEndsAt } \| null, lock, simulated: true }` |
| POST | `/blocks/app-open` | `{ app, confirmed?, reason? }` | `{ allowed: true, reason, until? }` or `{ allowed: false, prompt: "confirm" \| "why", message }`. Ask, then call again with `confirmed: true` (gentle) or `reason` (firm). There is always a way out |

## Progress and Today

| Method | Path | Returns |
|---|---|---|
| GET | `/today` | `{ now, onboarded, tryNow, lectures (today, with status), nextBlock, readyToRevisit, welcomeBack, banner, activeSession, resume }`. `nextBlock` is `{ blockId, start, end, status, canStart, firstStep } \| null`. `resume` is the session that was left with questions still to go, stopped or not: `{ sessionId, module, title, answered, budget, text } \| null`, offered for 7 days and not after a later session on the same lecture is finished (v1.1.1, R-5). Reading it does not reopen the session; `GET /sessions/:id` does |
| GET | `/progress` | The learning score and where it came from (v1.1, V-34 to V-36; the rules are `src/core/companion/score.ts` and `milestones.ts`, the numbers `SCORE_RULES` in `policy.ts`). `{ score, ideas, modules, attention, milestones, week, welcomeBack }`, described below |

`GET /progress` in full:

- `score`: `{ now, weekChange, series: { week, month, term }, term: { start, end, target }, ideasSecured, ideasTotal, fading }`. Each series is a list of points, `{ date, end, score, pace, gained, future, detail: { sessions, right, answered, secured, cameBack, blocks, modules }, milestones }`: seven days for `week`, thirty days for `month`, one point per week of term for `term`. `pace` is the steady-pace line (a straight line to `term.target`, every idea in the study packs secured, by `term.end`); `future` points carry the pace and no score. `detail.secured` and `detail.cameBack` are idea keys; `milestones` are the ids earned in that period.
- `ideas`: `{ [key]: { title, unit, module } }` for every idea the history mentions. A key is `lectureId#nodeId`.
- `modules`: `{ code, name, hasMaterial, lastActivity, shares: { week, month, term } }[]`, each share `{ points, minutes }`.
- `attention`: `{ kind: "module" \| "fading" \| "material", module, text, action: { label, session?, href? } }[]`. The module done least in the last 14 days, ideas that are fading, and modules with no material, each with one action. Empty when nothing needs attention.
- `milestones`: all fifteen, `{ id, group: "learning" \| "discipline" \| "rounded", title, how, earnedAt }[]`. A milestone is kept once earned: the first time it is seen it is saved to `milestones.json` and logged as `milestone_earned`.
- `week`: `{ sessions, questionsAnswered, readyToRevisit }`, kept for Today. `welcomeBack`: `{ text, spec, daysAway } \| null`.

The list of lectures by week (`roadmap`) is no longer part of this response (V-38): the Library shows it.

## Event log (T23)

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/events` | `{ type, data }` or an array (types: `CLIENT_EVENT_TYPES` in `src/core/companion/types.ts`, e.g. `onboarding_step`, `settings_changed`, `block_started`, `explainer_opened`, `dictation_used`, `error`) | `{ logged }` |
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
