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

## Open: the group decides (plan §14)

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
