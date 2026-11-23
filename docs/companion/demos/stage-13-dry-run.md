# Stage 13: the dry run (facilitator runbook)

**Branch:** `feat/v0.1` · **Commits:**
- `test: dry-run fixes for the 26 Nov test`
- `feat(ui): send a question to the phone now, from the facilitator (F-119)`
- `docs(companion): record the dry run's real-engine evidence in the checkpoint (F-102)`

This page is **how to drive the app** for each test task. **The test script itself is Lekan's**: the task wording, questions, consent and timing.

The spec asks for a teammate to run J1′, J2′, J5′, J7, J8 and J9 from the script on Wed 25 Nov in the evening. This runbook is the "how" for that dry run and for Thursday.

## What my own dry run found and fixed

I ran J1′ (first run) and J7 (study pack) on the **real engine** (your ChatGPT sign-in) in a production build. That found six problems; all are fixed and tested:

| Found | Fix |
|---|---|
| **The teacher stopped after question 1 of 3.** It gave feedback on a 50%-sure answer, then waited for a reply the session screen can't send | The opening message now tells it the learner can't type replies. If it still stops early, LockedIn sends "Next question, please." once (your decision, 23 Nov). **Rerun: 3 of 3.** |
| A hand-off session on the real engine would have asked 5 more questions instead of 4 | The phone answer now counts toward the budget on the real engine too |
| Going Back and forward on the modules screen prepared the first taste twice on your AI | An unopened first taste is reused |
| `onboarding_done` was logged twice per tester | Logged once, so T23 counts are right |
| Explainers ended with "Try question hci-w3-personas-q5." | Sentences naming internal ids are removed. The **Try it** button already does that job |
| Mind-map diagrams drew black boxes | They use the theme's colours now |

**Real-engine timings:**
- the first taste is ready about **20 s** after the modules screen opens, so it's waiting by the time a tester presses Finish;
- a study pack takes about **1 minute**.

These are recorded in `CHECKPOINT.md`. The full checkpoint (5 runs on two lectures) is still to do.

## Before the session (once per laptop)

```bash
cd ~/PycharmProjects/LockedIn && git checkout feat/v0.1 && git pull && nvm use 26 && npm ci
npm run build                      # test on a production build: faster, and what the dry run used
```

- **Your AI:** the facilitator laptop's ChatGPT sign-in is shared by every data folder. Which account participants use is open decision **O-6**.
- **Phone (T4):** deploy the relay once (stage 9 guide), then put `COMPANION_RELAY_URL=…` in `.env.local`. Without a phone, the facilitator's **Phone (no phone needed)** buttons play the phone's part.

## Before each participant (about 1 minute)

```bash
LH_DATA_DIR=$PWD/runs/P07 COMPANION_DEMO=1 npx next start -p 3000      # one folder per participant (SDLC.md)
```

1. On the facilitator laptop, open `http://localhost:3000/app/facilitator`. It's not in the rail, so testers won't see it.
2. **Participant → P07 → Set.** Every event from now on carries P07.
3. Give the tester `http://localhost:3000/app` and **Me → Appearance**: Calm (the default).

## Each task: setup and how to trigger it

| Task | Setup (facilitator) | The tester does | Check it worked |
|---|---|---|---|
| **T1 First run (J1′)** | A fresh participant folder. Nothing else | Connect AI (or it's already connected) → **Choose for me** → **Continue** → a calendar (**Use the sample timetable** if they have no link) → modules → **Finish** → **Start** | CSV: `onboarding_step` per screen, `onboarding_done` once, `session_opened`, `question_shown` (`msSinceOpen`) |
| **T2 Add slides, open an explainer (J7)** | Have a slide file ready (a PDF, or `companion/content/gt-w2-nash/slides.md` as a stand-in) | **Library** → **Add course material** → pick the file → **Continue** → check the proposed units → **Save N units** → open the unit → **Write the study pack** (about 1 min) → the **Explainers** tab → read one → **Try it** | `materials_uploaded`, `materials_proposed`, `materials_saved`, `pack_ready`, `explainer_opened` |
| **T3 Plan my week (J8 + J5′)** | Facilitator → **J2 · Tayo** (or keep T1's state) | **Week** → **Plan my week with me** (chat) → confirm → tick, move or remove blocks | `setup_chat_*`, `plan_proposed`, `plan_accepted` / `plan_moved` / `plan_removed` |
| **T4 Phone question and hand-off (J9 + J2′)** | Tester pairs: **Me → Phone → Get questions on your phone**, scan, Add to Home Screen (iPhone), Allow notifications. Then facilitator → **Phone relay → Send a question to the phone now** | Answer on the phone → **4 more on your laptop** → back at the laptop, **Open** the card | Within a minute the phone rings. Then `answered`, `handover` (source phone), the laptop card "Question 1 answered on your phone ✓ 4 more ready.", and the session opens at question 2 |
| **T4 without a phone** | Facilitator → **J2 · Tayo** → **Answer + hand-off** (or **Wrong + hand-off**) | **Open** the card | Same as above, from the facilitator's simulation |
| **T5 Sunday check-in (J5′ step 4)** | The tester has a weekly target (T3). Facilitator → **Sunday evening**, then **Fire a nudge now → N-5** | Open the check-in → how did it feel → accept or keep the proposed target | `checkin_shown`, `checkin_answered`, `target_changed` or `target_kept` |
| **T6 Make it yours** | Nothing | **Me → Appearance**: theme, colour, **Motion: Calm / Full / Off** | `settings_changed`, `motion_changed` |

**After each participant:** Facilitator → **Export CSV** (`events.csv`). Save it under the participant's id. Then stop the server.

## If something goes wrong mid-session

- **The real AI fails or is slow:** Facilitator → **Engine for new sessions → scripted** runs the generated question banks without the AI. Whether to switch, and whether to tell testers, is open decision **O-8**.
- **The phone never rings:** check Facilitator → **Phone relay** for "reachable", "paired" and "notifications on". On an iPhone, LockedIn must be opened from the Home Screen. Fall back to **Answer + hand-off**.
- **A tester wants to start again:** Facilitator → **J1 · Reset to first run**. This archives the event log, it doesn't delete it.

## Known limits for Thursday

- **The relay runs on real time.** While the demo clock is moved (J2 · Tayo, Sunday evening), the phone's own nudges are on the wrong day. Use **Send a question to the phone now** for T4.
- **Real speech** (the Speak button) needs a Deepgram key in Me → Voice. It isn't needed for any task.
- **Not yet done:** the relay hasn't been deployed to the team account, and no test on a real phone has happened yet. Both are needed before T4 with a phone.
