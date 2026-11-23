# Stage 8 demo: nudges v2 (F-114, N-5 from F-111)

**Branch:** `feat/v0.1` · **Commit:** `feat(nudges): N-1 v2 wording, 0-2 a day, N-5 and scheduleWeek (F-114, F-111)`

## What's new, in plain words

- **The after-lecture nudge *is* the question.** It reads "HCI just finished. One question:" with one practice question from that unit's study pack (stage 5) underneath. If no pack is ready yet, you get the old sentence: "HCI just finished. 5 questions on it, about 10 minutes?"
- **It works without slides on that exact lecture** (V-18). After any timetabled lecture you attended, it teaches the module's **current-week unit**.
- **Nudges a day: Off, One or Two** (Me). **Off** means nothing pops up, on the laptop or the phone; you start from Today.
- **Sunday check-in nudge (N-5):** on Sunday at your check-in time (19:00 by default), *"Next week: 3 lectures, 2 free gaps. Set your study blocks?"* It opens the check-in on Week, and counts as that day's nudge.
- **"Why now"** under every nudge, e.g. *"Why now: after HCI · you're free until 15:00"*.
- **The week ahead for the phone:** LockedIn now plans the next 7 days of nudges with exactly the same rules. The phone relay (stage 9) delivers these with the laptop closed. You can see the plan at `/api/companion/nudges/schedule`.

## Run it

```bash
cd ~/PycharmProjects/LockedIn
git checkout feat/v0.1 && git pull
nvm use 26
rm -rf runs/demo-s8
LH_DATA_DIR=$PWD/runs/demo-s8 COMPANION_DEMO=1 npm run dev
```

Onboard with your AI connected and **Use the sample timetable**. Open a few HCI lectures and let their study packs finish (stage 5), so N-1 has questions to use.

## Demo A: the question as the notification

1. Open the facilitator at http://localhost:3000/app/facilitator. Click **Scenario: Tayo**, then **Jump to the next lecture end**, then **+5 min**.
2. Go back to **Today**. A toast appears:
   - **"HCI just finished. One question:"**;
   - the question;
   - **"Why now: after HCI · you're free until …"**.
3. **Open** starts the session on that unit.

## Demo B: the Sunday check-in nudge

1. Set a weekly target on **Week** (e.g. 4 h).
2. Facilitator → **Sunday evening**. On Today, a toast appears: **"Next week: N lectures, M free gaps. Set your study blocks?"** If it doesn't show straight away, facilitator → **N-5** fires it now.
3. **Open** goes to **Week** with the check-in at the top.

## Demo C: Off means off

1. **Me → Nudges and sessions → Nudges a day → Off.**
2. Facilitator → jump to the next lecture end → +5 min. No toast.
3. Set it back to **One**.

## Demo D: the week's plan

Open http://localhost:3000/api/companion/nudges/schedule. You see the next 7 days of nudges:
- at most one a day (two if you chose Two);
- never in quiet hours;
- N-1s at the lecture end + 5 minutes, each with its question;
- Sunday's N-5.

## Automated checks

```bash
npx tsx --test tests/companion-nudges-v2.test.ts
npm run companion:check     # 414 companion tests
```

`companion-nudges-v2` (14 tests):
- Off is silent and plans nothing;
- N-5: once at the chosen time, only with a target, not on other days, counted toward the cap, and can be forced;
- N-1 teaches the lecture's own slides, or the current-week unit when the slot has none, and doesn't fire without any material;
- "why now";
- wording within 90 characters;
- the schedule: one N-1 per lecture day at end + 5 with its question, the cap held across the week, quiet hours kept, Sunday's N-5 included, no repeated questions, the v1 fallback, stable ids, and nothing already fired planned again.

## Known limits

- **On the laptop, opening N-1 v2 opens the session.** Answering the question straight from the notification is the phone's job (stage 9).
- **The block-start wording** is still the draft ("Your study block starts now. 50 minutes, at your own pace.") until the group confirms it (O-14).
