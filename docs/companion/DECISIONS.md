# Decisions

Two lists: what the build decided (so nobody re-litigates it by accident, and anyone can challenge it with a PR), and what the group still has to decide (plan §14). Add an entry whenever a PR makes a product or architecture choice.

## Made in the plumbing build (14 Nov 2026)

| # | Decision | Why | Where |
|---|---|---|---|
| B-1 | Build on LearnHarness v0.6.1 (`cb25c8e`), included in this repository with fresh history; new code in `src/core/companion`, `src/server/companion`, `app/api/companion`; engine files changed only where listed in `NOTICE` | Plan §5.1 and §10.2: same origin, in-process calls; a clean repository for the coursework submission with credit kept | `NOTICE` |
| B-2 | `COMPANION_ENGINE` defaults to **scripted** when unset | A fresh checkout (a teammate, CI, a tester's laptop) must run with no key. `.env.local.example` sets `learnharness` explicitly | `default.ts` |
| B-3 | The plan's `prepare()` is split into `start()` + `waitUntilReady()`; engine state lives on the session record as a patch | `POST /sessions` returns at once and the screen shows progress (AE2-2); one store for all session state | `engines/types.ts` |
| B-4 | Lectures are materialised from the sample timetable at onboarding, relative to the (demo) clock, not written by the seed script | The sample week is always "this week", whatever day the test runs | `timetable.ts`, `seed.mjs` |
| B-5 | N-1 is not sent more than 60 minutes after the lecture ends | "HCI just finished" stops being true; found by the rule tests | `policy.ts` `n1ValidMinutes` |
| B-6 | N-2 is also held back while an N-1 is still expected later today | Otherwise a morning retest spends the daily cap and blocks the primary nudge (behaviour-change §5: N-2 only if N-1 has not fired) | `nudges.ts` |
| B-7 | "Show me first" does not count toward the question budget | It is a request, not an attempt (plan §6.7); counting it would cut the session short | `view-mapper.ts`, `scripted.ts` |
| B-8 | Retest answers map to misses in order (answer k ↔ miss k), and the retest opening message asks for one question per item in that order | The teacher's plan nodes are its own slugs, so nodeId matching is unreliable | `misses.ts`, `opening-message.ts` |
| B-9 | Scripted "show me first" shows the worked example and keeps the question; without an authored example it points at the cited slide | Revealing the answer and re-asking the same question would be a giveaway | `scripted.ts` |
| B-10 | Facilitator resets archive the event log instead of deleting it; the student's "delete all my data" deletes it | T23 data must survive a mis-click between participants; R-7 must still mean delete | `store.ts` `wipe` |
| B-11 | Automatic LearnHarness → scripted fallback exists but is **off** by default (`COMPANION_AUTO_FALLBACK=1`), and is logged as `engine_fallback` | Option C's condition: a script must be declared, never silent | `service.ts` |
| B-12 | Block starts do not count toward the daily nudge cap | Open decision D-6 below; one constant flips it | `policy.ts` `blockCountsTowardCap` |
| B-13 | Block start wording "Your study block starts now. N minutes, at your own pace." | Not in behaviour-change §5; draft | `policy.ts` |
| B-14 | All demo slides and question sets are placeholder drafts | No real slides were in the team repo. They follow standard HCI / game theory material and cite their own slides | `companion/content/` |
| B-15 | Upstream's desktop CI/release/website workflows and their pinning tests are removed; LockedIn has its own CI | The desktop app is not shipped; a three-OS desktop matrix per PR is wasted cost | `NOTICE` |

## Made for v0.1 (23 Nov 2026, Jiven)

The design is in [`v0.1-spec.md`](v0.1-spec.md). Section 3 of the spec lists where these choices depart from recorded evidence or earlier group decisions. Each departure still needs the group's sign-off and an entry in the team repo's `design-log.md` (spec O-7).

| # | Decision | Why | Supersedes |
|---|---|---|---|
| V-1 | Ship a desktop app (Electron) for the laptop and an installable web app (PWA) for the phone | 16 Nov sync: one app, the phone starts and the laptop teaches. T16 QOC: O2 (laptop only) fails B1 | plan.md §2.2 ("real phone push… simulated") |
| V-2 | Local-first: the laptop app is the source of truth. A thin hosted relay serves the phone app, holds 7 days of prepared nudges, sends web push, and collects phone events in an append-only log that the laptop replays | ChatGPT sign-in only works on the same machine as the server; the engine is single-user; the phone must reach the student with the laptop closed | SDLC "Phone on Wi-Fi" |
| V-3 | Connect AI (ChatGPT sign-in or an API key) on screen 1, then the first taste. LearnHarness is the default engine whenever a connection exists | Jiven's decision. Partly reverses 10 Nov "onboarding after a first taste of value" | B-2 (scripted default), D-1, D-2 |
| V-4 | The setup chat is optional, comes after the first taste, learns routine and a weekly target, proposes and never sets toggles | Keeps 16 Nov decision 5; AE2-P14, AFF-G | — |
| V-5 | Weekly hours: the student sets a target; the planner proposes blocks in free gaps; a Sunday check-in ("too much / about right / too little", blocks *started*) leads to a proposed change the student confirms. Never automatic, never "missed". A new hypothesis to test | X-7, option D, LIT-10, LIT-11, LIT-21, INT-05-h, R-6 | D-6 context; plan §7.7 (two fixed slots) |
| V-6 | Uploads generate a study pack: a clickable mermaid concept map, diagram-led explainers (behind "show me first" or a tap), and a bank of three-option questions | INT-02-g, INT-01-e, Q-7; constrained by Sam, LIT-17, AE2-7 | B-14 (placeholder content), D-4 |
| V-7 | Calendars: fixed `.ics` read with auto-refresh, routine captured through the chat, study blocks published as a subscribable `.ics` feed. No OAuth | Q-10; UI research Q4; the Birmingham timetable route is unknown | D-10 |
| V-8 | Phone block = an honest commitment screen: optional, off by default, can be ended any time, no real blocking | X-8; SYN T-5; LIT-10, LIT-11; UI research Q2 | D-5; the simulated lock (plan §7.7) |
| V-9 | No leaderboards or social features in v0.1 | INT-02-a, LIT-20, AFF-B, Q-11 | — |
| V-10 | Motion is purposeful and calm by default; a Calm / Full / Off setting; the system reduced-motion setting is always respected | AE2-P10; deck slide 21; AE2-P16 | `reduceMotion` boolean |
| V-11 | The phone notification opens the question in one tap; it is not answered on the lock screen | Web platform limits (Chrome allows 2 actions at most, iOS none) | T20 v2 R-1 and N-1 three-button form |
| V-12 | Phase A of v0.1 is built for the Thu 26 Nov user test; phase B follows | PLAN.md test date; deck due 4 Dec | plan.md §11 dates |
| V-13 | The repository is public (AGPL-3.0, as LearnHarness). kayzisland, JishnuMukherjee, LekanAkinwale01 and RPala2703 were invited with write access | Jiven, 23 Nov | D-7 |
| V-14 | Naming: `VERSIONS.md`, `v0.1-spec.md`, integration branch `feat/v0.1`, tags `lockedin-v0.x` | `SDLC.md` reserves `v*` tags | — |

## Made during the v0.1 build (23 Nov 2026, Jiven)

Taken while building stage 2 (spec §9 step 2). V-15 and V-17 change the spec; [`v0.1-spec.md`](v0.1-spec.md) F-101, J1′, §3 and §12 are updated to match.

| # | Decision | Why | Supersedes |
|---|---|---|---|
| V-15 | **The student picks a model per LearnHarness slot** (Strong = prober + teacher, Cheap = question banks, research, grading, Vision = diagrams and PDF reading), each with a thinking level, exactly as in LearnHarness's own Settings. **"Choose for me"** fills all three from a curated list (`models.ts`). The same rows are in Me → AI | Jiven: "It is crucial we have this delineation because in the LearnHarness engine they use a variety of agents to support learning." **Departs from** the Dev anti-persona ("Where do I pick the model?"); "Choose for me" keeps the no-knowledge path to one tap | F-101 "the student never sees model names"; J1′ "No model choice" |
| V-16 | **Connecting an AI is required** on onboarding screen 1; there is no "Not now". The scripted engine remains only as the declared fallback (after disconnecting, or `COMPANION_ENGINE=scripted` for CI and no-AI demos) | Jiven: "we need the sign in for them to actually use the tool" | — |
| V-17 | **Calendar first, modules read from it.** Onboarding: connect AI → connect a timetable (link, file, none, or the labelled sample) → confirm the modules found in its event titles (tick, rename, add) → try it now. Typing a module is the fallback when there is no calendar or one is missing. v0.0's "How often can I nudge you?" screen is dropped (1 a day by default, changed in Me) | Jiven: "if we can pick it up from the calendar why would we get the user to type it out again?" Modules came only from the sample timetable in v0.0. Birmingham's timetable (MyUoB) may not export iCal (D-10) and Canvas feeds hold deadlines, not lectures, hence the typing fallback | J1′ step 2 "Pick or type modules" |
| O-1 | Relay: **Cloudflare Workers + D1 + Cron on a team-owned account** (someone runs `npx wrangler login` before stage 9) | The spec's proposal | spec §12 O-1 |
| O-2 | "Choose for me", **Balanced**: ChatGPT and OpenAI Strong `gpt-6-sol` (thinking low), Cheap `gpt-6-luna`, Vision `gpt-6-sol`; Anthropic `claude-sonnet-5-5` / `claude-haiku-5-5` / `claude-sonnet-5-5`; OpenRouter the same Anthropic models. Each slot falls back down a short list when an account doesn't offer the first pick. Confirm with the checkpoint run | Cheap writes the question banks, so it runs most; Strong balances teaching quality and latency | spec §12 O-2 |
| O-3 | The first taste is **3 questions on the bundled HCI "Personas and scenarios" lecture**, labelled as a sample, on the student's AI, prepared while they confirm their modules | Nobody has added slides at that point; it has real authored slides | spec §12 O-3 |
| B-16 | ChatGPT **background use** is shown after sign-in as LearnHarness's toggle, **on by default**, with "LockedIn prepares your questions in the background, so this needs to be on." Off blocks sessions with a plain reason | The prober → teacher hand-off is a background turn; with background use off it is refused and question 1 never appears (`src/server/jobs.ts`, spec F-102 risk) | — |

## Made for v1.0 (24 Nov 2026, Jiven)

The plan is [`v1.0-plan.md`](v1.0-plan.md). It follows [`v1.0-issues.md`](v1.0-issues.md), with the causes corrected in the plan's section 1.

| # | Decision | Why | Supersedes |
|---|---|---|---|
| V-19 | **Three versions.** v1.0 fixes what fails, misleads or corrupts data. v2.0 is the polish stage ([`v2.0-direction.md`](v2.0-direction.md)). v3.0 is the desktop app, code clean-up and whatever v2.0 turns up | Jiven: a stable base to test first, then polish in detail. Large refactors would hide new bugs among old ones | `v1.0-issues.md` "ships as a desktop app"; V-12 phase B |
| V-20 | **Release route.** v0.1 merged into `main` as it stood and tagged `lockedin-v0.1`. v1.0 is built on `feat/v1.0`, merged when CI is green, tagged `lockedin-v1.0`, and tested from a production build | A tagged v0.1 to compare against if a fix makes something worse | — |
| V-21 | **Slides show the real PDF page**, drawn on the laptop by the engine's PDF renderer and kept on disk. The text view stays only where there is no PDF (sample lectures, pasted text). No AI-written summary in v1.0 | INT-01-g; both the issue list and the v2.0 direction say "show the real page" | The Markdown slide panel (v0.0) |
| V-22 | **The safety net also runs before question 1:** one "Next question, please.", then a plain error with a working "Try again" | The 23 Nov rule, extended. Verified twice: the teacher set its plan and ended its turn | — |
| V-23 | **Study packs retry** a failed stage 3 times (10 s, 30 s, 90 s), wait while the AI connection is down, and resume on their own after a restart | One dropped request failed five packs on 23 Nov | — |
| V-24 | **The smallest unit is 500 characters of text** | A pack needs at least 2 ideas and 12 questions. The failing unit was the words "Week 8" | — |
| V-25 | **An unknown week reads "Week not set"**, with a one-tap "Set week" on the unit | "Week 0" means nothing to a student | — |
| V-26 | **Sample lectures are hidden** once a real upload is saved or a real calendar is imported. Nothing is deleted; facilitator scenarios bring them back | The sample "Games in normal form" sat beside the student's own | — |
| V-27 | **`/` redirects to `/app` always.** The engine's pages stay reachable at their own addresses (`/chat/new`, `/chat/<id>`) | The engine's home screen confused real use | spec F-117 "when running as the desktop app" |
| V-28 | **Deadline events are never lectures:** a title with due, deadline, assignment, coursework, submission or hand-in is treated like a lab. Not "quiz" or "test", which can be taught sessions | A Canvas deadline would send "HCI just finished" at midnight | — |
| V-29 | **The phone install is a guided web install**, and the pairing is carried into the Home Screen app | iPhones only allow notifications from an installed web app. A native wrapper is considered only if this fails on a real phone | — |
| V-30 | **Event log:** double counts are fixed in v1.0. Renaming events and giving each type one shape waits for v3.0 | Renames two days before the 26 Nov test could break its analysis | — |
| V-31 | **Next.js 16.4.6** (the security patch) goes in last, behind the full test suite. If the gate fails it is reverted and moves to v3.0 | The warning interrupts every start | — |

## Made after Jiven's test of v1.0 (24 Nov 2026)

| # | Decision | Why | Supersedes |
|---|---|---|---|
| V-32 | **A phone pairs by a 6-digit code shown on the laptop.** On an iPhone the code is the way to pair every time: scanning only shows how to add LockedIn to the Home Screen, and the app there asks for the code. Android and desktop browsers still pair by scanning. Any phone with no pairing gets the code screen. The laptop shows one panel: QR code, three steps, the code, a live status line | On a real iPhone the Home Screen app never received the pairing (v1.0, v1.0.2), and the fallback asked for a long link the laptop did not clearly show. Jiven: "why can't I see my code? … We need solid design around this flow." He chose "always type the code on iPhone" over "code as a safety net", so the flow is the same for everyone | V-29 "the pairing is carried into the Home Screen app" |
| V-33 | **Visuals are drawn by LockedIn, from data the AI supplies** (the concept map first, then the explainer shapes). Not SVG written by the AI. For v2.0; not built yet | His concept maps came out as large tangled mermaid graphs. LockedIn's own drawing is always valid, tidy and in the app's style | Mermaid as the way maps and diagrams are drawn (V-6), once built |

## Made for v1.1 (24 Nov 2026, Jiven)

The plan is [`v1.1-plan.md`](v1.1-plan.md); the evidence is [`v1.1-research.md`](v1.1-research.md). **V-34 and V-35 depart from T20** ("gamification, streaks and points were considered and dropped") and from R-6's "no counts", and are owed an entry in the team's `design-log.md`.

| # | Decision | Why | Supersedes |
|---|---|---|---|
| V-34 | **Progress shows a cumulative learning score over time** (week, month, term) against a straight "steady pace" line to the end of term, with what each module contributed. Points for right answers (more for harder questions), for securing an idea and for getting one back; nothing lost for a wrong answer or "I don't know"; a small dip while an idea is fading | Jiven: "progression should mean something, and there should be reward for learning and being disciplined". He chose a cumulative score over a true Elo rating, because a skill rating levels off and has no honest "linear growth" beside it. Monitoring recorded progress helps goal attainment (Harkin 2016); compare with self and a goal, not peers (Jivet 2018) | R-6 "no counts or percentages"; the Progress roadmap and counters (v0.0) |
| V-35 | **Rewards are milestones you keep:** earned from real history, dated, never taken away, none needing an unbroken chain. No levels, no streaks, no leaderboard | Rewards that inform support competence (Sailer 2017); rewards given for doing a task undermine intrinsic motivation (Deci 1999); a badge-and-leaderboard course ended with lower motivation and exam scores (Hanus & Fox 2015); streaks work by threatening a loss (LIT-23, INT-01-i) | T20 "points … dropped" |
| V-36 | **Gaps drive attention.** Progress names the module done least on, ideas that are fading and modules with no material, each with one action; "ideas to revisit" lists the neglected module first | Jiven: the "revisit" should be informed by the parts you are not doing, for well-rounded progress. A dashboard alone does not raise achievement (Kaliisa 2024); interleaving and spacing help (Brunmair & Richter 2019, LIT-17) | — |
| V-37 | **The Week page is a timetable grid with drag and drop.** Study blocks snap to 15 minutes and can't land on a lecture, class, commitment, another block or quiet hours; the server checks the same rule. **Each block has a module**, set by the planner and changeable by the student | Jiven asked for drag and drop; dragging to a time needs a time scale. Time and growth can then be read per module | The day-columns Week view on wide screens (it stays on narrow ones) |
| V-38 | **Progress no longer lists lectures by week.** The Library is the place for lists. The timetable's week numbers (which count from the first week the import could see, not teaching week 1) are therefore no longer shown anywhere; renumbering them waits for "Your courses" in v2.0 | His Game Theory showed 18 rows with two sets of weeks 1 to 7 | — |

## Made for v2.0 (24 Nov 2026, Jiven)

The direction is [`v2.0-direction.md`](v2.0-direction.md), rewritten the same day from an audit of v1.1 against the team's lo-fi v13. It is not yet a plan: its section 17 lists what is still to settle.

| # | Decision | Why | Supersedes |
|---|---|---|---|
| V-39 | **"Ideas to revisit" becomes gaps by idea.** Module, then the study pack's idea, then the questions missed on it. From an idea, "Practise this idea" has the AI write new questions around the gap, using what the student chose and why. Only ideas with a gap are listed | The flat list "will just grow into a massive list" (Jiven). Students want the weak spot directly (INT-01-d, INT-02-e); a backlog is what nearly lost INT-01 (INT-01-i). Chosen over grouping by chapter and over topics named by the AI | The lecture grouping in V-36 |
| V-40 | **Two modes, Teach and Practise.** Teach is the engine's probe, learn, predict, check loop, on the laptop. Practise is fast multiple-choice questions mixed across a module's ideas and difficulties, with the slide beside them; the phone's question is its first question | "Having separation between the two lies at the heart of why we have differences between the phone and laptop. Phone is to onboard the user onto the laptop, laptop is to teach" (Jiven). R-8; AFF-N; X-4 | — |
| V-41 | **No app blocking in v2.0.** The phone stays questions, the week and the check-in. The Off / Gentle / Firm rules stay on the server, unused | A web app can't see or stop another app opening; a real block needs a native app with Apple's Screen Time (UI research Q2). The lock is unresolved in the research (X-8). Chosen over building the lo-fi's simulated focus screens, a Shortcuts-based shield and a native app | — |
| V-42 | **v2.0 is built as one release** on top of v1.1, with no separate cut for the hi-fi test | "Just build out the whole of v2.0, we have the primitives in place" (Jiven) | — |

**For the group:** V-41 means the "app blocking" feature chain (23 Nov core set) ends at the lo-fi, with the hi-fi link "not built, and why". V-40's "Practise mixes topics" rests on interleaving, which has no `LIT` id yet.

## Open: the group decides (plan §14)

Status on 23 Nov:
- D-1 and D-2 are superseded by V-3, with the fallback at spec O-8.
- D-5 is superseded by V-8.
- D-7 is answered by V-13.
- D-10 stays open, and V-7 adds the chat path for students whose timetable can't be imported.
- The v0.1 open questions are spec §12 (O-1 to O-14).

| # | Question | Default in the build until decided |
|---|---|---|
| D-1 | Confirm option D and the checkpoint (Mon 16 Nov, 18:00) | Built for option D |
| D-2 | Which engine runs T23: LearnHarness or scripted for everyone? | Facilitator chooses per session (`/demo/engine`); either way, declare it |
| D-3 | Model, provider, per-session cost ceiling, whose key | Seed has placeholders; `COMPANION_MODEL_*` or Settings fills them; cost visible at `/sessions/:id/cost` |
| D-4 | Demo content: which lectures for T23 | `hci-w3-personas` and `hci-w4-fieldwork` have full scripted sets; replace drafts with real slides |
| D-5 | Is the lock in the MVP at all? | Built, off by default, always overridable |
| D-6 | Does a study-block start count toward the 1–2 nudges a day? | No (B-12) |
| D-7 | Where does the repository live, and who can push? | A private repo on Jiven's account; teammates added as collaborators |
| D-8 | T23 setup: laptop phone frame or real phones on a hotspot? | Both work; real phones need `-H 0.0.0.0` on a private hotspot |
| D-9 | Session length stated as an estimate, stop or keep going, no up-front length question | As proposed |
| D-10 | Does Birmingham's timetable export iCal? | `.ics` import is built (stretch); the sample timetable is the MVP |

## How course material comes in (O-15, raised 23 Nov 2026)

**Decided the same day: option D, built in v0.1 (V-18 below).**

Raised by Jiven while specifying stage 4 (F-104). Recorded here with the reasoning because it shapes the data model, F-104, F-105 (study packs) and the 26 Nov test.

**The problem.** F-104 as specified assumes one file per lecture, matched to a timetable lecture by the week number in its name, its slide titles, or date order. Real material doesn't arrive that way:

| # | How a student's material can arrive | What F-104 as specified does with it |
|---|---|---|
| S1 | One PDF per lecture, labelled by week ("GT Week 3 – Nash.pdf") | Works, if there is a timetable to match to |
| S2 | One file for the whole semester (a single deck, a reading pack, a revision guide) | Fails: it has to be split into lectures or topics first |
| S3 | Files with no week or date on them ("Lecture slides.pdf", "notes.md") | Only date order is left, which guesses badly |
| S4 | Canvas module pages: a summary per week, as text, with the deadlines in the calendar | Not a file at all; the Canvas calendar holds deadlines, not lectures (seen 23 Nov) |
| S5 | No timetable at all: MyUoB doesn't appear to export iCal (D-10), so typed modules have no lectures | Nothing to match to; every upload is orphaned |

**What the rest of the app needs from material:**
- *content units* (a lecture or a topic) with their text and slide numbers, so a unit can be quizzed, cited and turned into a study pack;
- and, separately, *when* a unit was taught, so N-1 ("HCI just finished. One question:") can fire after it.

v0.0 fuses the two in one `Lecture` record: a timetable event that may have slides.

**Options considered:**
- **A. Heuristic matching only (spec F-104 as written).** Cheap and deterministic. Handles S1 with a timetable; fails S2 to S5.
- **B. Upload on each lecture's own page.** The student picks the lecture; no guessing. Handles S1 with a timetable. Still fails S2 and S5, and it's tedious for a whole term.
- **C. The AI proposes the structure.** The Cheap model reads the upload (per-page titles and text) and proposes units, each with a title, a page range and a week if one is found. The student confirms or edits them in one list. Units attach to timetable lectures when they line up; otherwise they stay as untimed topics. Handles S1 to S3; S4 can be pasted as text notes. It needs `lh-port.generate()` (stage 5) first, and costs one model call per upload.
- **D. Separate content from the timetable in the data model.** A module has *topics* (from material, in course order) and *events* (from the timetable, with times). A post-lecture nudge links "the lecture that just ended" to "the next topic not yet covered". Models S1 to S5 properly, including no timetable. It is the largest change: Library, study packs, nudges and the concept map all key on lectures today.

**Evidence:**
- Q-10: 19 of 22 share slides; 21 of 22 share a timetable.
- INT-06-e: "upload the material and the quiz is generated".
- AE2-1: every extra setup step costs.
- The Birmingham timetable route is unknown (D-10).

We have **no evidence** on how students' material is actually split across files. That is a research gap worth a question in T23 or in Kobi's findings.

**Risk to the 26 Nov test:** testers use the facilitator laptop and demo modules, so the test does not depend on solving this. The narrative does, though: "add your slides" is task T2.

### V-18 (23 Nov 2026, Jiven): learning separated from lectures

"Just change the v0.1 spec and build the thing." Option D above, combined with C (the AI proposes how material splits into units, and the student confirms). The model is in [`v0.1-spec.md`](v0.1-spec.md) section 5.5:
- **course units** per module, with weeks and material, from any input shape;
- a **module calendar** (current week, reading weeks) that works without a timetable;
- a **pacing rule**: keep up first, gap repair capped at a third of the weekly target, units more than 6 weeks back left for revision. This answers Jiven's concern that a student in week 10 must not be stuck on week 3.

Lecture times become a signal for N-1, not a requirement. F-104, F-109 and F-110 in the spec are revised to match.

Defaults chosen in the build, all tunable in `policy.ts` and open to the group (O-7):
- `gapShare` = 1/3;
- `maxGapWeeksBack` = 6;
- "keep up" covers the current and the previous week;
- reading weeks lift the cap.

**Evidence:** none direct for the pacing numbers. LIT-16 and LIT-17 (spaced practice testing) support revisiting weak units. INT-05-h supports planning in weeks. Jiven's reasoning (23 Nov): "If we have the app notifying the user to study xyz to meet their inputted time commitment for a given week then we have a better chance at maximising objectives since we can just structure learning around weaknesses."
