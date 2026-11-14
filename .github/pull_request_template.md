## What and why

<!-- One or two sentences. Link the issue: Closes #… -->

## Journey and evidence

- Journey: <!-- J1 first run · J2 post-lecture nudge · J3 missed lecture · J4 resurfaced miss · J5 study block · J6 coming back · plumbing -->
- Evidence IDs: <!-- e.g. AE2-5, Q-8, R-4 (rubric criterion 8: every hi-fi element traceable to research) -->
- `design-log.md` entry (team repo): <!-- link, or "not needed: plumbing only" -->
- Decision record: <!-- DECISIONS.md B-… / D-…, if this makes or depends on a product choice -->

## How it was tested

- [ ] `npm run companion:check`, `npm run typecheck`, `npm run lint`, `npm test` (CI runs them)
- [ ] New behaviour has a test at the lowest layer that can express it (pure rule > service > route)
- [ ] Ran on the **scripted** engine
- [ ] Ran on the **learnharness** engine (or: not applicable, no session behaviour changed)
- [ ] Screenshots / screen recording attached (UI changes)

## Guardrails (plan §2, behaviour-change §6)

- [ ] No streaks, no "overdue", no red numbers; nothing references an ignored nudge
- [ ] Nudge wording under 90 characters; daily cap and quiet hours untouched or deliberately changed in `policy.ts`
- [ ] The lock stays off by default and always has a way out
- [ ] Simulated things (notifications, lock, sample timetable, scripted engine) are labelled as such
- [ ] No secrets or participant data committed (`.env.local`, `data/`, `runs/`)
- [ ] `docs/companion/API.md` updated if the HTTP surface changed
