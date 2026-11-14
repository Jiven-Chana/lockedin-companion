# Companion content

Demo lectures for the sample timetable, the scripted engine, and the seed. **Everything here is draft placeholder content**: there were no real slides in the team repo. Replace the slides with the module's real material and have the question sets reviewed before T23 (DECISIONS.md D-4).

```text
sample-timetable.json        modules, weekly slots, lectures in course order, labs, facilitator scenarios
<lectureId>/slides.md        one "## Slide n — Title" heading per slide (what the teacher cites)
<lectureId>/questions.json   scripted question set (optional; the T23 lectures must have one)
<lectureId>/slides.pdf       optional; enables the slide sheet (GET /api/companion/materials/:id/pdf)
```

## Real slides

Upload a PDF with `COMPANION_DEMO=1`: `curl -X POST --data-binary @slides.pdf -H 'content-type: application/pdf' localhost:3000/api/companion/materials/hci-w3-personas`. It converts with LearnHarness's `convertPdf`, writes `slides.md` and `slides.pdf` into the data directory, and lists the pages that came out empty (`needsCaption`). There is no OCR: caption image-only slides by hand. To ship real slides to every teammate, copy the checked `slides.md` (and PDF) into this folder in a PR.

## Scripted question sets

```json
{
  "lectureId": "hci-w3-personas",
  "goal": "5 questions on personas and scenarios, about 10 minutes",
  "questions": [
    {
      "id": "q1",
      "nodeId": "persona-purpose",
      "leadIn": "Start with what a persona is for (Slide 4).",
      "stem": "Which is the main purpose of a persona?",
      "options": ["…", "…", "…"],
      "correct": [0],
      "explanation": "… (Slide 4)",
      "hint": "…",
      "workedExample": "…"
    }
  ]
}
```

- Options are shuffled per session (seeded, like LearnHarness), so authoring the correct answer first is fine.
- Questions sharing a `nodeId` test the same idea. Retests ask a **sibling** (same `nodeId`, different `id`) so the wording is never reused; mark siblings `"retestOnly": true` so they are not used up by the first session.
- Every explanation must cite a slide that exists, and options must be bare claims (no reasoning that gives the answer away). `tests/companion-content.test.ts` checks the structure and the citations.
- The two T23 lectures need at least 5 main questions plus retest siblings.
