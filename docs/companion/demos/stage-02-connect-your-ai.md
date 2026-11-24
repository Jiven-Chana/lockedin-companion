# Stage 2 demo: connect your AI, real engine by default (F-101, F-102)

**Branch:** `feat/v0.1` · **Commits:** `feat(engine): connect your AI and default to LearnHarness (F-101, F-102)`, `feat(ui): connect your AI and calendar-first onboarding (F-101, V-17)` · **Decisions:** DECISIONS.md V-15, V-16, V-17, O-1, O-2, O-3, B-16

## What's new, in plain words

1. **You connect your own AI first.** Sign in with ChatGPT, or paste an API key (Anthropic, OpenAI or OpenRouter). There is no skip.
2. **You choose a model for each part of the teacher,** like in LearnHarness:
   - **Strong:** the prober and the teacher.
   - **Cheap:** writing questions, research and grading.
   - **Vision:** diagrams and reading PDFs.

   Each slot has its own thinking level. **"Choose for me"** fills all three in one tap: on ChatGPT, `gpt-6-sol` / `gpt-6-luna` / `gpt-6-sol`.
3. **Your calendar comes before your modules.** LockedIn reads the modules out of your calendar's event titles. You tick, rename or add to them, and you only type a module when there's no calendar.
4. **The first 3 practice questions** are on a labelled sample lecture (HCI, "Personas and scenarios"). LockedIn writes them while you're checking your modules.
5. **Real teaching by default.** Once your AI is ready, every session runs on LearnHarness with your models. Until then, Today shows a banner saying sessions use the built-in practice questions.
6. **Me → Your AI** has the same connection and model rows, so you can change models or disconnect later.

## Before you start

- You need a **ChatGPT account**, or an API key for Anthropic, OpenAI or OpenRouter.
- Sign in **on this laptop**. ChatGPT sends you back to `127.0.0.1` on the same machine, so it won't work from a phone.

## Run it

```bash
cd ~/PycharmProjects/LockedIn
git checkout feat/v0.1 && git pull
nvm use 26
rm -rf runs/demo-s2
LH_DATA_DIR=$PWD/runs/demo-s2 COMPANION_DEMO=1 npm run dev
```

Wait for `✓ Ready`. If it stops after a message about a Next.js security vulnerability, run the last line again. Then open **http://localhost:3000/app**.

## Demo A: first run with ChatGPT (about 2 minutes)

| Step | Do | You should see |
|---|---|---|
| 1 | Open `/app` | **Connect your AI**, step 1 of 3. Continue is greyed out |
| 2 | Click **Sign in with ChatGPT** | A new tab opens at OpenAI's sign-in. The button says "Waiting for ChatGPT…" |
| 3 | Sign in, then come back to the LockedIn tab | Within a few seconds: "✓ Connected: ChatGPT (your email)", the **background use** checkbox ticked, and **2. Pick your models** with three rows |
| 4 | Click **Choose for me** | Strong `gpt-6-sol`, thinking **low**; Cheap `gpt-6-luna`; Vision `gpt-6-sol`. Then "✓ Ready. Your sessions run on ChatGPT." Continue turns on |
| 5 | *(optional)* Change a model or thinking level | A **Save models** button appears. Saving keeps "Ready" |
| 6 | Continue | **Connect your timetable**, with four options |
| 7 | Choose **No calendar, I'll type my modules**, then Continue | **Your modules**, empty, with an "Add a module" box |
| 8 | Type two modules (e.g. "Organic Chemistry", "Statistics"), pressing Enter after each | Each appears ticked |
| 9 | Finish | **You're set.** "2 modules added…", and a card **Try it now · sample lecture · HCI — Personas and scenarios**, "3 questions on a sample lecture, about 3 minutes" |
| 10 | Click **Start** | A session with question 1 **written by your ChatGPT**. It's often already waiting, because it was prepared during step 8 |
| 11 | Answer the 3 questions | Feedback cites slides. The session ends after 3 |
| 12 | Go to Today | **No** "Not connected" banner |

**Things to note for the test write-up:** how long from step 1 to question 1 on screen (target ≤ 90 s, excluding the time spent signing in), and whether "Choose for me" was enough.

## Demo B: a calendar with modules in it

1. Run demo A again on a fresh folder (`rm -rf runs/demo-s2-cal` and use that as `LH_DATA_DIR`).
2. At step 7, choose **Upload a calendar file**. Use any `.ics` export where event titles name the module. A Canvas export works as a test: it holds deadlines, not lectures, but its titles carry the module tag `[CODE(n) - Name]`.
3. Continue. **Your modules** lists what it found:
   - Tagged modules start **ticked**.
   - Titles that only repeat (like "Mid-Module Survey") start **unticked**.
4. Untick or rename anything, then Finish. The "You're set" line says how many events were read.

## Demo C: errors and the fallback

1. **Bad key:** in Me → Your AI, click **Use an API key**, pick OpenAI, paste `sk-not-a-real-key-123` and press Save. You should see "OpenAI didn't accept that key. Check it and try again." Nothing is saved.
2. **Background use off:** in Me → Your AI, untick background use. You should see "Background use is off for ChatGPT, so sessions can't start." Tick it again.
3. **Disconnect:** in Me → Your AI, click **Disconnect** next to ChatGPT. The model rows disappear. Today now shows the banner *"Not connected to your AI. Sessions use LockedIn's built-in practice questions until you reconnect."* with a **Connect** button that goes to Me.
4. **`/api/companion/health`** shows `ai.ready` and `defaultEngine` changing between `learnharness` and `scripted` as you connect and disconnect.

## Demo D: the checkpoint (needs your AI, about 15 minutes; we fill in CHECKPOINT.md together)

With ChatGPT connected and "Choose for me" done (demo A, steps 1 to 5), **stop the server first** (Ctrl+C). One process per data folder, and the tracer uses the same ChatGPT sign-in. Then run:

```bash
LH_DATA_DIR=$PWD/runs/demo-s2 npm run companion:tracer -- hci-w3-personas --runs 3 --answer
LH_DATA_DIR=$PWD/runs/demo-s2 npm run companion:tracer -- hci-w4-fieldwork --runs 3 --answer
```

Copy the printed latencies, any errors and the cost lines back to me. I'll record them in `CHECKPOINT.md` as the F-102 checkpoint commit. Also check that the session in demo A step 10 reached question 2 after you answered question 1. That is the prober → teacher hand-off the spec flags as a risk on ChatGPT.

## Automated checks

```bash
npm run companion:check      # 219 companion tests
npx tsx --test tests/companion-models.test.ts tests/companion-module-detect.test.ts tests/companion-connect.test.ts tests/companion-http.test.ts
```

- `companion-models`: "Choose for me" per provider, falling back down the list, Vision skipping text-only models, unsupported thinking levels dropped, slot validation, readiness.
- `companion-module-detect`: Canvas-style tags, `CODE: title`, repeating plain titles, one-offs ignored, codes from typed names.
- `companion-connect`: ChatGPT and key connection with a fake engine port; a refused key isn't saved; background use off blocks; disconnect clears slots; the engine flips scripted → LearnHarness → scripted; an explicit `COMPANION_ENGINE` is never overridden; onboarding by link, file, none and sample; a failed link leaves nothing half-made; the first taste starts before onboarding and opens after.
- `companion-http`: service errors map to their status even across Next's per-route module copies.

## What's simulated or not done yet

- **Not clicked through by me.** I can't sign in to ChatGPT on your behalf. The screens were checked as compiling and serving, and every server route was exercised live (including the real ChatGPT login hand-off, which I cancelled). Demo A is the first full run, so tell me anything that looks wrong.
- **The checkpoint isn't recorded yet** (demo D). It needs your real AI.
- **The desktop app** (Electron) isn't wired for this sign-in yet. That's F-117, phase B. This stage works in the browser build.
- **The model list is "Balanced" (O-2)** until the checkpoint confirms it.
- **Your Canvas deadlines become "events"**, not lectures, so they don't trigger post-lecture questions. Real timetable import is stage 6.
