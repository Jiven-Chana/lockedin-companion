# Stage 6 demo: calendars that read correctly (F-108)

**Branch:** `feat/v0.1` · **Commit:** `feat(api): ical.js parser with time zones and refresh on open (F-108)` · **Spec:** F-108 (phase A: the parser and refresh on open; the mapping screen is phase B)

## What's new, in plain words

LockedIn used to read calendars with a home-made parser that got times wrong in other time zones and ignored most repeat rules. It now uses **ical.js**, a proper calendar library:

- **Time zones:** an 11:00 London lecture stays at 11:00 across the clocks going back in October. This includes Outlook's "GMT Standard Time" naming.
- **Repeat rules:** "every Tuesday and Thursday", "every two weeks", "Mon/Wed/Fri six times".
- **Cancelled lectures** disappear, and **moved lectures** move. A moved lecture keeps its slides and its "I wasn't there".
- **All-day events** (a reading day, a holiday) are kept as busy days, not lectures.
- Calendars with no time zone are read in **your** time zone, which the app now remembers.
- **A calendar link refreshes by itself** when you open the app and every 6 hours, as the onboarding screen always promised.
- **Me → What I read** shows the link masked, e.g. `calendar.google.com/…/basic.ics`, so the private part of it isn't on screen. It also shows when it last refreshed and which time zone it reads in.

## Run it

```bash
cd ~/PycharmProjects/LockedIn
git checkout feat/v0.1 && git pull
nvm use 26
npm ci                       # new package: ical.js
rm -rf runs/demo-s6
LH_DATA_DIR=$PWD/runs/demo-s6 COMPANION_DEMO=1 npm run dev
```

## Demo A: the test calendars

Four realistic calendars are in `tests/fixtures/companion/ics/`:

| File | What it shows |
|---|---|
| `google.ics` | HCI every Tue and Thu 11:00 in London time; Thu 22 Oct cancelled; Tue 27 Oct moved to Wed 28 Oct 15:00, after the clock change |
| `outlook.ics` | Game Theory on three Wednesdays, written with Outlook's Windows time-zone name |
| `apple.ics` | An HCI seminar every two weeks, with no time zone and a 90-minute duration |
| `multiday.ics` | A Mon/Wed/Fri problem class, an all-day reading day, and a cancelled extra lecture |

1. Onboard: connect your AI, then pick **Upload a calendar file** and choose `google.ics`. On the modules screen, **HCI** is found (from "HCI: Lecture").
2. Finish, then open **Library** or **Today**:
   - the lectures are at 11:00 every Tuesday and Thursday;
   - **no lecture on Thu 22 Oct**;
   - **Wed 28 Oct at 15:00** instead of Tue 27 Oct.

   Use the facilitator's demo clock (`/app/facilitator`) to look at those weeks.
3. **Me → Calendar → Import an .ics file** with `multiday.ics`. The reading day doesn't appear as a lecture, and the cancelled lecture doesn't appear at all.

## Demo B: a real link refreshes itself

1. Onboard with a calendar **link**, e.g. a Google Calendar "secret address in iCal format" or Outlook's "publish calendar" ICS link.
2. **Me → What I read** shows `Source: Your calendar link (host/…file)`, "Refreshed …", and "Times read in Europe/London".
3. Add an event to that calendar in Google or Outlook, stop the app, and start it again. Open Today, then reload Me. "Refreshed" shows the new time and the event is there. (Google can take a few minutes to update its feed.)

## Automated checks

```bash
npx tsx --test tests/companion-ics-v2.test.ts tests/companion-calendar.test.ts
npm run companion:check     # 339 companion tests
```

- `companion-ics-v2` (11 tests), on the four fixtures:
  - London times across the October clock change;
  - EXDATE (cancelled) and RECURRENCE-ID (moved), and the moved lecture keeping its original id;
  - Outlook's Windows zone, Apple's floating times with DURATION and an every-two-weeks rule;
  - Mon/Wed/Fri rules, all-day events as busy events, STATUS:CANCELLED;
  - wall-clock conversion for London summer and winter and New York;
  - garbage input giving no events instead of a crash.
- `companion-calendar` (5 tests):
  - the zone stored at onboarding and used for floating times; a bad zone ignored;
  - refresh on open once per run and again after 6 hours, never straight after connecting;
  - a failed refresh logged, not thrown;
  - the masked link never showing the token.

## Known limits

- **The screen that sorts unmatched calendar events into a module** (or marks them as a commitment) is phase B.
- **All-day events from outside your modules** (a bank holiday) are counted as "didn't match a module" for now. The weekly planner (stage 7) will treat all of them as busy days.
- **A Birmingham timetable link** still depends on MyUoB offering one (D-10). The calendar-first onboarding falls back to typing modules.
