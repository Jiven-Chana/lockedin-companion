# Stage 11 demo: calm motion (F-118)

**Branch:** `feat/v0.1` · **Commit:** `feat(ui): calm motion system (F-118)`

## What's new, in plain words

**Me → Appearance → Motion** now offers three choices: **Calm** (the default), **Full** and **Off**.

**Calm** moves something only when it explains a change, and always briefly (0.15 to 0.3 seconds):

| What moves | What it tells you |
|---|---|
| The ring at the top of a session fills | How far through the session you are |
| Right answer: a soft ✓ pops in. Wrong: the explanation slides in (no shake, no red) | The result, without punishment |
| Study pack stages tick ✓ as they finish | Background work progressing |
| Concept-map ideas appear one after another the first time; an idea whose status changed pulses once | The structure, and what just changed |
| Diagrams fade in | No jump when they finish drawing |
| Proposed study blocks slide into the week, day by day | Where time was found |
| The hand-off card's ✓ pops | Your phone answer arrived |
| Changing theme or colour cross-fades | The change, without a flash |

**Full** adds two things, as you decided on 23 Nov, so Full and Calm can be compared in T6:
- pages fade and rise in when you move between them;
- the background's time-of-day colours drift slowly (a 24-second cycle), never during a session.

**Off** stops all of it. So does the computer's own **Reduce motion** setting, whatever you pick here. Inside a session, the only thing that ever loops is the "working…" dot.

Old profiles carry over: anyone who had chosen "Reduce" gets **Off**, and everyone else gets **Calm**.

## Run the demo

```bash
cd ~/PycharmProjects/LockedIn && git checkout feat/v0.1 && git pull && nvm use 26 && npm ci
rm -rf runs/demo-s11
LH_DATA_DIR=$PWD/runs/demo-s11 COMPANION_DEMO=1 npm run dev
```

1. Onboard (**sample timetable**). In `/app/facilitator`, load **Tayo**.
2. **Calm (the default):**
   - Open the HCI lecture's session. Answer one right: the ring fills and a ✓ pops beside "Right".
   - Answer one wrong: the explanation slides up into place.
   - **Week:** pick a target, then **Plan my week**. The proposed blocks slide in day by day.
   - **Library** → a lecture → **Map**: the ideas appear in order.
3. **Me → Appearance:** switch **Dark ↔ Light** and click a colour. Everything cross-fades.
4. **Full:** select **Full**, then move between Today, Library and Week. Each page rises in. Wait on Today: the background slowly shifts. Open a session: the background holds still.
5. **Off:** select **Off** and repeat step 2. Nothing moves.
6. **The system setting:** choose **Full**, then turn on macOS System Settings → Accessibility → Display → **Reduce motion**. Nothing moves.

## Automated checks

```bash
npm run companion:check     # 446 companion tests
```

`companion-motion` checks:
- Calm is the default;
- migration: reduce → Off, otherwise Calm, and a v0.0 profile on disk is read correctly;
- only calm, full and off are accepted;
- `motion_changed` is logged once per real change;
- interactions take 150 to 300 ms, and the drift cycle is 20 s or longer.

I also checked the running app in headless Chrome by reading the live animation state:

| Setting | Result |
|---|---|
| Calm | no page motion, no drift |
| Full | page rise and drift |
| Off | nothing, and the ring has no transition |
| Full + system Reduce motion | nothing |
| Full in a session | no drift |

Proposed blocks animate staggered by day (0.06 s, 0.12 s). Today and Week look the same as before.

## Known limits

- The map pulse is on the drawn map. The list under it updates without motion.
- The working indicator is still the v0.0 pulsing dot.
