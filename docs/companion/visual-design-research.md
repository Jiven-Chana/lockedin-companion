# Evidence for how LockedIn looks: colour, type, widgets and layout

**Status:** research note, 25 Nov 2026, written for Jiven. It covers the hi-fi as released in `lockedin-v2.0`. Nothing in the build was changed. Section 8 lists proposed changes; each one needs a decision before it is built.

**Why it exists.** The team's research repository justifies what LockedIn does. It says almost nothing about how LockedIn looks: a search of every research file for colour, font, contrast, icon and layout found six relevant lines (section 2). The hi-fi already has a full visual system, so most of its look is currently unexplained. Rubric criterion 6 penalises "large quantities of unexplained features", and criterion 8 asks that "almost all the elements in the hi-fi are justified". This note closes that gap, and says plainly where the evidence is thin or against us.

**How it was done.** Three techniques, chosen over the alternatives for these reasons:

| Technique | What it produced | Why this and not something else |
|---|---|---|
| **Audit of the build** | Every colour, font, size and control read from `palette.ts`, `lockedin.css`, `relay/web/styles.css` and saved screenshots | A heuristic evaluation needs testers and belongs to T22. An audit gives exact values that can be measured |
| **Measurement** | Contrast ratios for 18 colour pairs at 72 hues in light and dark, target sizes, line length, text size as a visual angle (section 6) | Guidelines give thresholds. Measuring against them gives a result, not an opinion |
| **Targeted literature check** | 30 sources, each checked on 25 Nov 2026 against its Crossref, OpenAlex, ERIC or W3C record (section 11) | A systematic review does not fit the time. A targeted check is honest if it also looks for evidence against us, which this one did (section 7) |

**The ids.** Finding ids (`Q-1`, `AFF-C`, `LIT-27`) are the team's, from `research/findings-register.md`. The new sources have no id until KAYZ adds them, so this note cites them by author and year.

---

## 1. The short version

**Well supported, by our own data and by the literature:**
- one step at a time in Learn, and one column;
- status shown with an icon and a word as well as a colour, in blue and orange;
- confidence as four taps with nothing preselected, in place of a slider;
- a plain legible sans-serif for everyone, with no separate "dyslexia font" or neurodivergent mode;
- pictures and slide links placed inside the step they belong to;
- calm motion that can be switched off;
- text contrast: every text pair passes 4.5:1 at every hue, in light and dark.

**Designer judgement, with no evidence either way:**
- violet as the default colour;
- Bricolage Grotesque for headings;
- the time-of-day background and greeting;
- four confidence points, not three or five.

**Where the evidence is against the build today (section 7):**
1. Lines in Learn are about 112 characters long. The guidance is 80 at most.
2. Body text at 16 px sits at the bottom edge of the range the eye reads fluently on a laptop.
3. Input borders are 1.3:1 against the card. The standard asks for 3:1.
4. Two modules can be given almost the same colour (HCI 285°, AI 288°, ECON 293°).
5. The phone app uses different fonts and a different "right answer" colour from the laptop.
6. The navigation rail drops its labels on narrow windows and becomes icons only.

**One claim to stop making.** "No red because red harms test performance" does not hold: the effect failed a 2020 meta-analysis (section 3). "No red" still stands, on our own evidence (R-6, INT-01-i) and on colour blindness.

---

## 2. What our own research already says about the look

Six findings touch it. Everything else in the register is about behaviour.

| Finding | What it says | What it supports |
|---|---|---|
| **AE2-P10** | A theme picker that changed the app at once produced "the walkthrough's only delight": "that makes it feel like home" | A live appearance setting. One participant, one day |
| **AE2-P16** | The profile reveal had "so much information, so much going on". The override sliders were valued | Low density; settings the student can override |
| **AE2-P11** | Accessibility options phrased as system settings, asked before any content, felt "so technical" | Appearance lives in Me, never in setup |
| **AFF-C, AE-5, C-3** | "Too much at once": one step at a time stays under the load ceiling | One column, one step, panels on request |
| **AFF-H, AE2-2** | "I can't tell what it's doing": a wait with no progress signal was called long | A visible signal for every wait |
| **INT-02-g** | Visual cues help; symbol-heavy pages make his "brain switch off" | Pictures in the step; plain typography |

Also relevant: **Q-12** (no clear neurodivergent difference at n = 22, so no separate mode), **S-66** (accessibility first-run sketch), the lo-fi's switch to Atkinson Hyperlegible in version 11, **R-6** (no guilt, no loss framing), and the personas' context of use (Maya studies in bed at night; Tayo in a loud hub).

**The limit of this evidence:** nobody in our research was asked about colour or type. AE2-P10 is a single reaction from a teammate. The hi-fi test is the first chance to get user evidence on the look (section 9).

---

## 3. Colour

### What the build does
- Every colour is generated from **one hue** in the OKLCH colour space (`src/core/companion/palette.ts`). Default hue 285° (violet). Light, dark, follow-the-system and a fixed high-contrast theme.
- **Each module has its own hue** ("Auto"): HCI 285°, Game Theory 160°, any other module a hue computed from its code.
- **Status is blue and orange, never red:** right or secure is blue (240°), a miss or "to revisit" is orange (50° to 60°), "not yet" is grey. Each has an icon and a word.
- **A session deepens the background** and removes the navigation ("focus mode"). The question stays on a card.
- **The page background shifts with the time of day** (dawn, day, dusk, night).

### Decisions, alternatives and evidence

| Decision | Alternatives considered | Our evidence | Literature | Verdict |
|---|---|---|---|---|
| **Colour, not greyscale minimalism** | A grey "distraction-free" interface | AE2-P10 | Um et al. (2012): in a lesson for 118 college students, materials designed with colour and round shapes raised comprehension and transfer and lowered perceived difficulty. Brom et al. (2018): a meta-analysis of 33 samples (N = 2,924) found positive effects of pleasant colours and friendly shapes on retention (d = 0.39), comprehension (0.32) and transfer (0.33), and lower perceived difficulty (−0.21) | **Supported.** The studies used warm colours in the learning material itself, so they support "colour over grey", not violet in particular |
| **One generated palette from one hue** | A fixed brand palette; the onboarding spike's preset themes | AE2-P10 (choice created buy-in); LIT-10 (self-chosen tools were still used months later) | Reinecke et al. (2013): colourfulness and visual complexity, measured from a screenshot, explain about half the variance in first-impression appeal. One hue keeps colourfulness low and constant | **Supported in principle; default hue is judgement.** Measured: every text pair passes at every hue (section 6) |
| **A hue per module** | One colour everywhere; colours the student picks | INT-01-e (material arrives with "no order"); AFF-K | WCAG 2.2 SC 1.4.1: colour must not be the only way information is conveyed. Module names are always shown, so this passes | **Partly.** The idea is sound, the method is not: hues come from a hash, so two modules can land 3° apart (section 6) |
| **Blue and orange for status, never red** | Green and red (the convention, and what the lo-fi used) | R-6, LIT-23, INT-01-i: no loss framing, no guilt | Birch (2012): red-green colour deficiency affects about 8% of men and 0.4% of women of European descent. Blue and orange stay distinct for them. WCAG 1.4.1. **Against the usual argument:** Elliot et al. (2007) found red before a test impaired performance, but Gnambs (2020), a meta-analysis of 67 effect sizes, found "no evidential value" for it after correcting for publication bias | **Supported, for two of the three reasons usually given.** Drop the "red harms performance" reason |
| **Status never by colour alone** | Colour-only dots | Sketch rule; S-66 | WCAG 1.4.1; Birch (2012) | **Supported.** Tags carry an icon and a word; question dots change size as well as colour; the pace line on the chart is dashed |
| **Light, dark or follow the system** | Dark only (the "focus" look); light only | AE2-P10; Maya studies in bed at night (S-2) | Piepenbrock et al. (2013): dark text on a light background gave better visual acuity and proofreading for younger and older adults; they recommend it "for all ages" | **Supported as a choice. Open as a default** (see "two readings" below) |
| **Focus mode: the background deepens, the navigation goes** | Keep the full app around the question | Q-2 (staying focused is the second problem); AFF-C | Sundararajan & Adesope (2020): interesting but irrelevant material in a lesson hinders learning. LIT-7: students were on task about 65% of the time | **Supported.** In the light theme the question card stays dark-on-light, so reading keeps the better polarity |
| **High-contrast theme that ignores the hue** | Rely on the system setting only | Q-12; S-66 | WCAG 1.4.3 and 1.4.6. Measured 21:1 | **Supported** |
| **Background follows the time of day; greeting such as "Still up?"** | A fixed background | None | None found | **Judgement. The weakest item in the system.** Under criterion 6 it is an unexplained feature. A greeting at 02:00 can also read as a telling-off, which R-6 and Maya's persona rule out |

### Two readings of the dark-mode evidence
The build follows the laptop's setting, and every saved screenshot of the test build is dark. Piepenbrock et al. favour light for reading. Two interpretations are open:
1. **Keep "follow the system".** The student already chose it, choice is what AE2-P10 valued, and Maya reads in bed at night where a bright screen is worse.
2. **Open Learn in light unless the student chose dark in LockedIn.** Learn is the one reading-heavy screen, and reading is where the polarity evidence applies.

The study used pure black and white and a proofreading task, so it does not settle this. Recommended: keep (1), and record each tester's theme in the hi-fi test so results are comparable.

---

## 4. Type

### What the build does
- **Body:** Atkinson Hyperlegible, 16 px, line height 1.5. Settings: Large (18.5 px), Extra large (21 px), Loose spacing (1.9).
- **Headings and numbers:** Bricolage Grotesque, 700 to 800 weight.
- **The phone app:** the phone's own system font at 17 px.

### Decisions, alternatives and evidence

| Decision | Alternatives considered | Our evidence | Literature | Verdict |
|---|---|---|---|---|
| **One legible sans-serif for everyone** | A "dyslexia font" switch (OpenDyslexic, Dyslexie); a neurodivergent mode | Q-12; S-66; lo-fi v11; design log, 8 Nov ("a separate ND mode is not supported") | Rello & Baeza-Yates (2013): with 48 dyslexic readers and eye tracking, sans-serif, roman, monospaced styles read best. Kuster et al. (2018): the Dyslexie font gave no benefit to 170 children with dyslexia, and most preferred Arial. Wery & Diliberto (2017): no benefit from OpenDyslexic | **Supported.** Special fonts do not help; a plain sans-serif does |
| **Atkinson Hyperlegible in particular** | Arial or Verdana (the fonts actually tested in the studies above); the system font | Lo-fi v11 | The Braille Institute designed it "to differentiate characters" for low-vision readers. **No peer-reviewed test of this font was found**, and the Institute's own page cites none | **Partly.** The category is evidenced, this face is not. Say "designed for legibility", never "proven" |
| **16 px body text** | 18 px or larger | AFF-C | Rello et al. (2016): on Wikipedia with 104 readers, readability rose with size and comprehension was best at 18 and 26 points; they recommend 18 points or larger. Legge & Bigelow (2011): text is read at full speed when its x-height is between about 0.2° and 2° of visual angle | **Against us at the default** (section 6: 16 px is 0.15° to 0.20° on a laptop). "Large" clears the lower edge |
| **Text size and spacing settings** | One fixed size | AE2-P16 (overrides valued); AE2-P12 | Wallace et al. (2022): reading speed differed by 35% between a person's fastest and slowest font, and "one font does not fit all" | **Supported.** The same paper argues for a choice of font, which we do not offer |
| **Line height 1.5; "Loose" at 1.9** | Tighter default | None | WCAG 1.4.12 uses 1.5 as its reference value. Rello et al. (2016): default spacing was best, and the extremes tested (0.8 and 1.8) impaired readability | **Default supported. "Loose" is beyond the largest value tested**, and that value hurt |
| **Long lines in Learn** (not a decision: it fell out of the layout) | A narrower text column | INT-02-g | WCAG 1.4.8 (AAA): no more than 80 characters per line. Dyson (2004), reviewing screen studies, names characters per line as the critical variable. Dyson & Haselgrove (2001): a medium line length supported effective reading at normal and fast speeds | **Against us.** Measured at about 112 characters |
| **A characterful heading face** | The body face for headings too | None | None | **Judgement.** It is brand, and should be described as that |
| **Easy-to-read type, not deliberately hard type** | "Desirable difficulty" fonts, which were once claimed to improve memory | AFF-C | Xie et al. (2018): across 25 articles and 3,135 participants, hard-to-read text had no effect on recall (d = −0.01) or transfer (0.03); it only made people slower and less confident | **Supported.** A good "alternative we rejected" for the deck |

---

## 5. Widgets and layout

| Element in the build | Alternatives considered | Our evidence | Literature | Verdict |
|---|---|---|---|---|
| **Learn shows one step at a time, in one column** | A chat log; the engine's own three-pane screen | AE-5, AFF-C, C-3, AE2-3 | Rey et al. (2019): a meta-analysis of 56 investigations found that learner-paced segments improve retention and transfer and reduce cognitive load. Mayer & Moreno (2003) name segmenting and weeding as ways to cut overload | **Strongly supported** |
| **Pictures, demos and slide links appear inside their step** | A separate gallery or side panel only | INT-01-g (link to the exact slide); INT-02-g | Schroeder & Cenkci (2018): across 58 comparisons (n = 2,426), placing related words and pictures together improved learning (g = 0.63) | **Supported** |
| **The slide panel opens only when asked for** | Slide always beside the question (v1.1) | AE-5, AFF-C; Jiven's "cluttered" verdict on the first drafts | The same contiguity result argues the other way: the cited slide helps most when it is next to the text | **Two readings.** Less clutter, or closer source. The chip that opens the slide is the compromise. Worth watching in the test |
| **Answers are large full-width buttons; three options on the phone** | Small radio buttons; four or more options | UI research Q1 (Android shows three notification actions) | Hick (1952): choice time rises with the number of alternatives. Parhi et al. (2006): thumb targets of about 9.2 mm are large enough without loss of accuracy | **Supported** |
| **Confidence is four taps, none preselected** | The engine's slider, starting in the middle | AE2-5, AE2-6, AE2-8; LIT-27 | Funke et al. (2011): sliders caused more drop-outs (odds ratio 6.9) and slower answers than buttons. Liu & Conrad (2019): on a 101-point slider, a starting value pulls answers towards itself | **Supported.** Four points and no midpoint is judgement |
| **Progress is shown small and near: "Question 2 of 5", dots, "Step 4 of 4"** | A percentage bar; no indicator | C-5, AE2-P14 (15 questions felt like 60), AE2-2 | Myers (1985): people prefer to see progress. Conrad et al. (2010): progress feedback helps when progress beats expectation, and raises abandonment when early progress looks slow | **Supported.** Short sets make each step a visible jump, which is the favourable case |
| **Waits show a pulsing dot and a line of text** | A percentage bar; nothing | AFF-H, AE2-2, AE2-4 | Myers (1985). Harrison et al. (2010): how a wait is drawn changes how long it feels | **Partly.** Fine for a 5-second turn. A picture took 67 seconds in our own run, and a dot does not say that |
| **Status tags: icon, word and colour** | Colour dot only | S-66 | WCAG 1.4.1. Wiedenbeck (1999): icon-plus-label was rated easiest; icon-only was much slower at first | **Supported** |
| **Navigation rail: icon and label** | Icons only | AFF-K | Wiedenbeck (1999) | **Supported at full width. Against us under 1,024 px**, where the labels are hidden |
| **Week: drag a block, or tap it for options** | Drag only | INT-05-h, LIT-18, S-16, change blindness (Wk 4) | WCAG 2.5.7: anything done by dragging must also be possible with a single tap | **Supported.** The tap route exists |
| **Rounded cards and pill buttons** | Square corners | None | Bar & Neta (2006): people prefer curved objects to sharp-angled ones. Um et al. (2012) used round shapes in their positive design | **Supported, lightly.** Preference studies, not learning studies |
| **Buttons at least 44 px high on the laptop, 48 px on the phone** | Denser controls | Tayo and Maya use phones one-handed, in a hub or in bed | WCAG 2.5.8 (AA): 24 by 24 px. WCAG 2.5.5 (AAA) and Apple: 44. Material Design: 48 dp | **Supported**, with five smaller controls listed in section 6 |
| **Motion only for a change the student caused; Calm, Full, Off** | Lively motion; none | AFF-G, AFF-H; no finding mentions animation | WCAG 2.3.3: motion from interaction can be disabled. Bartram et al. (2003): motion in the corner of the eye is noticed more readily than colour or shape, which is why nothing should move to pull the student back | **Supported as a rule; the timings are judgement** |
| **"Make it yours": theme and hue with a live preview, in Me** | In setup; not offered | AE2-P10; AE2-P11; Dev anti-persona | Wallace et al. (2022) on individual differences; LIT-10 | **Supported**, on one participant. The test can replicate it |
| **Today shows several cards and buttons at once** | One next step only | AFF-K, INT-04-e ("the very, very first, tiniest step") | Hick (1952); Reinecke et al. (2013) on visual complexity | **Against our own principle.** Already recorded as clutter in the v2.0 direction, section 14, and deferred |

**A caution for the test, from the same literature.** Tractinsky et al. (2000) found that how good an interface looks changes how usable people say it is, even after using it, while its real usability did not change their rating. Lindgaard et al. (2006) found appeal is judged within 50 milliseconds. A polished hi-fi will therefore be rated kindly. In T23, trust what testers do (where they hesitate, what they miss) over what they say they liked.

---

## 6. Measurements

### 6.1 Contrast (72 hues, light and dark, measured with the build's own `contrastRatio`)

| Pair | Standard | Light: lowest across all hues | Dark: lowest | Result |
|---|---|---|---|---|
| Body text on a card | 4.5:1 | 16.5 | 13.3 | Pass |
| Muted text on a card | 4.5:1 | 7.2 | 8.1 | Pass |
| Primary button label | 4.5:1 | 5.0 (hue 190°) | 9.2 | Pass |
| Link or chip text | 4.5:1 | 6.7 | 7.7 | Pass |
| "Right" feedback text | 4.5:1 | 11.3 | 10.0 | Pass |
| "Miss" feedback text | 4.5:1 | 8.3 | 9.6 | Pass |
| Session header text | 4.5:1 | 11.5 | 14.4 | Pass |
| Accent against a card (selected state, focus ring) | 3:1 | 4.9 | 7.7 | Pass |
| **Input border against a card** | 3:1 | **1.3** | **1.6** | **Fail** |
| **"Not yet" dashed border** | 3:1 | **1.8** | 3.8 | **Fail in light** |
| High-contrast theme, text | 7:1 | 21.0 | | Pass |
| **Phone: "right" text on its note** | 4.5:1 | **4.4** | 8.2 | **Fail in light, narrowly** |

**What this shows.** Generating colours in OKLCH did what it was chosen for: the lowest and highest ratios for any text pair differ by little across the whole hue wheel, so a student can pick any colour and stay readable. **What it missed:** the automated test checks nine text pairs and no borders, so the border failures were never caught. An unselected text box is marked only by a border at 1.3:1.

### 6.2 Text size as the eye sees it
Atkinson Hyperlegible's x-height is 0.496 of its size (read from the font file). On a laptop a CSS pixel is about 0.20 to 0.22 mm.

| Setting | x-height on screen | At 50 cm | At 60 cm |
|---|---|---|---|
| Normal, 16 px | 1.6 to 1.8 mm | 0.18° to 0.20° | 0.15° to 0.17° |
| Large, 18.5 px | 1.8 to 2.0 mm | 0.21° to 0.23° | 0.18° to 0.19° |
| Extra large, 21 px | 2.1 to 2.3 mm | 0.24° to 0.26° | 0.20° to 0.22° |

Legge & Bigelow (2011) put the lower edge of fluent reading at about 0.2°. **The default is at or just under that edge**; Rello et al. (2016) point the same way. These figures assume normal eyesight and the pixel sizes above; they are a calculation, not a test.

### 6.3 Line length
Counted from a screenshot of Learn at a 1,440 px window: **about 112 characters per line** (the text column is 816 px wide; the font averages a little over 7 px per character at 16 px). With the slide panel open the column is narrower and the line is shorter.

### 6.4 Target sizes (from the stylesheets)
- **At or above 44 px:** buttons (44), large buttons (52), answer options (56), confidence taps (44), text inputs (44), close and icon buttons (44), setup steppers (48), hue swatches (44), phone buttons (48).
- **Between 24 and 44 px:** segmented controls (38), the Plan and Slide buttons in Learn (40), question rows in the gaps list (38), buttons on a week block (30), the "share of your week" control (30), small phone buttons (36).
- **Result:** everything passes WCAG's AA minimum of 24 px. Six controls are under the 44 px that Apple and WCAG's AAA level ask for. The small phone buttons matter most, because they are touched with a thumb.

### 6.5 Module colours
Hues given to 18 plausible module codes: CV 3°, OS 12°, DB 14°, CS101 26°, PHYS 114°, SE 122°, GT 160°, GTAMDM 202°, SEC 249°, LAW 258°, LI 269°, HCI 285°, AI 288°, ECON 293°, ML 303°, NC 325°, MATH 328°, NLP 354°.
**Result:** three pairs or groups are within 8° of each other, which the eye cannot tell apart. A student taking HCI and AI would see the same violet for both.

### 6.6 Phone and laptop compared
| | Laptop | Phone |
|---|---|---|
| Body font | Atkinson Hyperlegible | The phone's system font |
| Colours | Generated from the student's hue | Fixed violet, written in by hand |
| "Right answer" colour | Blue, with a tick | Green, text only |
| Theme | Light, dark, system, high contrast | Follows the phone only |

One product should look like one product (Nielsen's "consistency and standards", Wk 8). The system font on the phone is defensible: it needs no download on a patchy signal (S-4). The green is not: it breaks the status rule the laptop follows.

---

## 7. Honest criticism, ranked

For criterion 8 ("appropriate criticism of final product"). Most serious first.

1. **Lines too long to read comfortably in the main learning screen** (6.3). This is the screen where students read most.
2. **Default text at the edge of fluent reading** (6.2), and the test laptops will show it at that size.
3. **The time-of-day background and greeting have no evidence at all**, and the greeting may break our own no-guilt rule.
4. **Input borders fail the 3:1 standard** (6.1).
5. **Module colours can collide** (6.5), which defeats their purpose.
6. **The phone and laptop disagree** on font and on the colour for "right" (6.6).
7. **Today shows more than one next step.** Known and deferred.
8. **Atkinson Hyperlegible is not itself evidenced.** We chose a well-designed face in an evidenced category.
9. **A long wait looks the same as a short one.**
10. **None of the look has been in front of a user yet.** Every "supported" above means supported by studies of other people using other interfaces.

---

## 8. Proposed changes (not built; each needs Jiven's decision)

The hi-fi test is on 26 and 27 Nov. Changing the look the night before a test is a risk, so the recommendation is: **test what is released, then make these as T24 changes, with the test results beside them.** That also gives the deck a clean "data changed the design" story.

| | Change | Evidence | Size |
|---|---|---|---|
| P1 | Cap prose in Learn at about 70 characters a line | 6.3; WCAG 1.4.8; Dyson (2004) | One CSS rule |
| P2 | Make 18 px the default body size (or in Learn only) | 6.2; Rello et al. (2016); Legge & Bigelow (2011) | One token; check every screen |
| P3 | Darken input and "not yet" borders to 3:1, and add border pairs to the palette test | 6.1; WCAG 1.4.11 | Two tokens, one test |
| P4 | Space module hues apart as modules are added, and let the student change one | 6.5; WCAG 1.4.1 | Small rule in `palette.ts` plus a setting |
| P5 | Phone: blue with a tick for "right"; fix the 4.4:1 note | 6.6; R-6; Birch (2012) | Small; needs a relay deploy |
| P6 | Keep the rail's labels on narrow windows | Wiedenbeck (1999) | One CSS rule |
| P7 | For waits that usually pass ten seconds, say how long they usually take | AFF-H, AE2-2; Myers (1985) | Wording in `policy.ts` |
| P8 | Remove the time-of-day background and greeting, or keep them and say in the deck that they are judgement | Section 3; criterion 6; R-6 | Small |
| P9 | Bring "Loose" spacing down to about 1.7 | Rello et al. (2016) | One token |

---

## 9. What the hi-fi test can add (26 and 27 Nov)

These cost the facilitator almost nothing and turn judgement into `HF-n` findings.

1. **Record each tester's theme** (light or dark) and window size. Without it, reading results cannot be compared.
2. **Five-second look at Today**, then: "What would you do first?" Tests whether one next step is visible (AFF-K) and the first impression (Lindgaard et al.).
3. **During Learn, watch for** leaning in, zooming, or losing the line. Ask afterwards: "Was anything hard to read?" Tests P1 and P2.
4. **Point at a blue and an orange result:** "What is this colour telling you?" Then at the week: "What do the colours mean?" Tests the status and module colours.
5. **Confidence taps:** the build logs whether they are used or skipped. No question needed.
6. **At any wait over ten seconds,** note what the tester says or does. Ask: "What did you think was happening?" Tests AFF-H and P7.
7. **At the end, open "Make it yours"** and let them change it. Note the reaction in their words. This repeats AE2-P10 with more than one person.
8. **Weigh behaviour over ratings** (Tractinsky et al.).

---

## 10. Using this in the deck, the viva deck and the poster

### Where it earns marks
| Rubric criterion | What to take from this note |
|---|---|
| 2. Techniques, with reasons over alternatives | The three techniques in the opening table, and why not a heuristic evaluation or a systematic review |
| 3. Data produced, with limitations | Section 6's tables; section 12 |
| 4. How information influenced design | P1 to P9, each tied to a measurement; the two "two readings" passages for alternative interpretations |
| 6. No unexplained features | The verdict column: every visual element is supported, partly supported, or declared as judgement |
| 8. Justification and criticism | Section 7, as it stands |

**For the feature chains** (`deck/feature-chains.md`): each chain has a hi-fi screenshot link. Add one line under it, "why it looks like this", taken from the matching row in sections 3 to 5.

**For the viva deck:** this belongs on the "refinement to hi-fi" and "commentary on final product" slides. One table is enough: three things the evidence supports, three it is against, and what the test changed.

### The poster and slides are a design problem too
The same evidence applies to them.

- **Use the product's own look.** Atkinson Hyperlegible for text, Bricolage Grotesque for headings, and the light-theme colours: ink `#1b1a2d`, accent `#5d4fb9`, tint `#e9eaff`, status blue `#006aa0`, status orange `#c46016`. The poster then shows the design system by being made of it.
- **Print on a light background** with dark text (Piepenbrock et al. 2013).
- **Size type for three distances.** Using Legge & Bigelow's 0.2° lower edge and an x-height of half the type size, the smallest sizes that can be read at speed on an A3 poster are:

| Distance | What must be readable | Smallest size | Aim for |
|---|---|---|---|
| Far, 3 m | The name and one line saying what it solves | 60 pt | 80 pt or more |
| Medium, 1.5 m | Section headings and the feature names | 30 pt | 36 to 44 pt |
| Close, 0.5 m | Body text, finding ids, limits | 10 pt | 12 to 14 pt |

- **One message per distance:** from far, what LockedIn is; from the middle, the features and how the design evolved; up close, the evidence and the criticism.
- **Colour never alone:** about 1 in 12 men cannot separate red from green (Birch 2012). Label charts directly.
- **Cut decoration.** Irrelevant but interesting material hinders learning (Sundararajan & Adesope 2020). Each slide should carry one claim and the evidence for it.
- **Signal what matters:** a highlighted row, a bold finding id, an arrow from finding to feature (signalling; see the caveat on Schneider et al. in section 11).

---

## 11. Sources, and how each was checked

All checked on 25 Nov 2026. "Record" means the Crossref record for authors, year, venue, volume and pages. Quoted findings come from the abstract unless marked.

**Colour**
- Elliot, Maier, Moller, Friedman & Meinhardt (2007). Color and psychological functioning: the effect of red on performance attainment. *Journal of Experimental Psychology: General*, 136(1), 154-168. doi:10.1037/0096-3445.136.1.154. Record and abstract.
- Gnambs (2020). Limited evidence for the effect of red color on cognitive performance: a meta-analysis. *Psychonomic Bulletin & Review*, 27(6), 1374-1382. doi:10.3758/s13423-020-01772-1. Record and abstract.
- Um, Plass, Hayward & Homer (2012). Emotional design in multimedia learning. *Journal of Educational Psychology*, 104(2), 485-498. doi:10.1037/a0026609. Record and abstract.
- Brom, Stárková & D'Mello (2018). How effective is emotional design? A meta-analysis on facial anthropomorphisms and pleasant colors during multimedia learning. *Educational Research Review*, 25, 100-119. doi:10.1016/j.edurev.2018.09.004. Record; abstract from Semantic Scholar.
- Piepenbrock, Mayr, Mund & Buchner (2013). Positive display polarity is advantageous for both younger and older adults. *Ergonomics*, 56(7), 1116-1124. doi:10.1080/00140139.2013.790485. Record and abstract.
- Birch (2012). Worldwide prevalence of red-green color deficiency. *Journal of the Optical Society of America A*, 29(3), 313-320. doi:10.1364/JOSAA.29.000313. Record and abstract.
- Reinecke, Yeh, Miratrix, Mardiko, Zhao, Liu & Gajos (2013). Predicting users' first impressions of website aesthetics with a quantification of perceived visual complexity and colorfulness. *CHI '13*, 2049-2058. doi:10.1145/2470654.2481281. Record and abstract.
- Lindgaard, Fernandes, Dudek & Brown (2006). Attention web designers: you have 50 milliseconds to make a good first impression! *Behaviour & Information Technology*, 25(2), 115-126. doi:10.1080/01449290500330448. Record and abstract.
- Tractinsky, Katz & Ikar (2000). What is beautiful is usable. *Interacting with Computers*, 13(2), 127-145. doi:10.1016/S0953-5438(00)00031-X. Record and abstract.

**Type**
- Rello & Baeza-Yates (2013). Good fonts for dyslexia. *ASSETS '13*. doi:10.1145/2513383.2513447. Record and abstract.
- Kuster, van Weerdenburg, Gompel & Bosman (2018). Dyslexie font does not benefit reading in children with or without dyslexia. *Annals of Dyslexia*, 68(1), 25-42. doi:10.1007/s11881-017-0154-6. Record and abstract.
- Wery & Diliberto (2017). The effect of a specialized dyslexia font, OpenDyslexic, on reading rate and accuracy. *Annals of Dyslexia*, 67(2), 114-127. doi:10.1007/s11881-016-0127-1. Record and abstract.
- Rello, Pielot & Marcos (2016). Make it big! The effect of font size and line spacing on online readability. *CHI '16*, 3637-3648. doi:10.1145/2858036.2858204. Record and abstract. *The abstract gives sizes in points and does not say how a point maps to a screen pixel. If it is the CSS point, 18 points is 24 px.*
- Legge & Bigelow (2011). Does print size matter for reading? A review of findings from vision science and typography. *Journal of Vision*, 11(5):8. doi:10.1167/11.5.8. Record and abstract.
- Wallace, Bylinskii, Dobres, Kerr, Berlow, Treitman, Kumawat, Arpin, Miller, Huang & Sawyer (2022). Towards individuated reading experiences: different fonts increase reading speed for different individuals. *ACM Transactions on Computer-Human Interaction*, 29(4), article 38. doi:10.1145/3502222. Record and abstract.
- Dyson (2004). How physical text layout affects reading from screen. *Behaviour & Information Technology*, 23(6), 377-393. doi:10.1080/01449290410001715714. Record and abstract.
- Dyson & Haselgrove (2001). The influence of reading speed and line length on the effectiveness of reading from screen. *International Journal of Human-Computer Studies*, 54(4), 585-612. doi:10.1006/ijhc.2001.0458. Record only. **The abstract could not be read** (the publisher's page refused the request). The finding given here is from a machine summary. The often-quoted "55 characters per line" is not confirmed and is not used above.
- Xie, Zhou & Liu (2018). Null effects of perceptual disfluency on learning outcomes in a text-based educational context: a meta-analysis. *Educational Psychology Review*, 30(3), 745-771. doi:10.1007/s10648-018-9442-x. Record; abstract from ERIC.
- Braille Institute. *Atkinson Hyperlegible font.* https://www.brailleinstitute.org/freefont/. Read in full. A publisher's page: design intent only, no test data.

**Widgets and layout**
- Rey, Beege, Nebel, Wirzberger, Schmitt & Schneider (2019). A meta-analysis of the segmenting effect. *Educational Psychology Review*, 31(2), 389-419. doi:10.1007/s10648-018-9456-4. Record; abstract from ERIC.
- Schroeder & Cenkci (2018). Spatial contiguity and spatial split-attention effects in multimedia learning environments: a meta-analysis. *Educational Psychology Review*, 30(3), 679-701. doi:10.1007/s10648-018-9435-9. Record; abstract from ERIC.
- Sundararajan & Adesope (2020). Keep it coherent: a meta-analysis of the seductive details effect. *Educational Psychology Review*, 32(3), 707-734. doi:10.1007/s10648-020-09522-4. Record; abstract from ERIC.
- Mayer & Moreno (2003). Nine ways to reduce cognitive load in multimedia learning. *Educational Psychologist*, 38(1), 43-52. doi:10.1207/S15326985EP3801_6. Record and abstract. The names "segmenting" and "weeding" are from the paper's body, not its abstract.
- Schneider, Beege, Nebel & Rey (2018). A meta-analysis of how signaling affects learning with media. *Educational Research Review*, 23, 1-24. doi:10.1016/j.edurev.2017.11.001. Record only. **The abstract could not be read.** A secondary page reports 103 studies and effects of 0.53 on retention and 0.33 on transfer; these numbers are not used above and must be checked before the deck quotes them.
- Hick (1952). On the rate of gain of information. *Quarterly Journal of Experimental Psychology*, 4(1), 11-26. doi:10.1080/17470215208416600. Record and abstract.
- Parhi, Karlson & Bederson (2006). Target size study for one-handed thumb use on small touchscreen devices. *MobileHCI '06*, 203-210. doi:10.1145/1152215.1152260. Record and abstract.
- Funke, Reips & Thomas (2011). Sliders for the smart: type of rating scale on the web interacts with educational level. *Social Science Computer Review*, 29(2), 221-231. doi:10.1177/0894439310376896. Record and abstract.
- Liu & Conrad (2019). Where should I start? On default values for slider questions in web surveys. *Social Science Computer Review*, 37(2), 248-269. doi:10.1177/0894439318755336. Record and abstract.
- Myers (1985). The importance of percent-done progress indicators for computer-human interfaces. *CHI '85*, 11-17. doi:10.1145/317456.317459. Record and abstract.
- Conrad, Couper, Tourangeau & Peytchev (2010). The impact of progress indicators on task completion. *Interacting with Computers*, 22(5), 417-427. doi:10.1016/j.intcom.2010.03.001. Record and abstract.
- Harrison, Yeo & Hudson (2010). Faster progress bars: manipulating perceived duration with visual augmentations. *CHI '10*, 1545-1548. doi:10.1145/1753326.1753556. Record and abstract.
- Wiedenbeck (1999). The use of icons and labels in an end user application program: an empirical study of learning and retention. *Behaviour & Information Technology*, 18(2), 68-82. doi:10.1080/014492999119129. Record and abstract.
- Bar & Neta (2006). Humans prefer curved visual objects. *Psychological Science*, 17(8), 645-648. doi:10.1111/j.1467-9280.2006.01759.x. Record and abstract.
- Bartram, Ware & Calvert (2003). Moticons: detection, distraction and task. *International Journal of Human-Computer Studies*, 58(5), 515-545. doi:10.1016/S1071-5819(03)00021-1. Record only; the finding is from a machine summary, so treat it as indicative.

**Standards**
- W3C. *Web Content Accessibility Guidelines (WCAG) 2.2*, Understanding pages for success criteria 1.4.1, 1.4.3, 1.4.8, 1.4.11, 1.4.12, 2.3.3, 2.5.5, 2.5.7 and 2.5.8. https://www.w3.org/WAI/WCAG22/Understanding/. The wording of each criterion was read from W3C's own page.
- Apple's 44-point and Material Design's 48 dp target sizes were confirmed only through pages that quote them, not from the two companies' own guideline pages.

**Looked at and left out:** Mehta & Zhu (2009, *Science*) on blue and red: the same line of work that Gnambs (2020) could not support. The British Dyslexia Association's style guide: guidance, not a study, and sources disagree about what the current edition says.

---

## 12. Limitations of this note

- **It is a targeted check, not a systematic review.** It started from a design that already existed. It did look for evidence against that design and reports what it found, but it will have missed some.
- **Abstracts, not full texts.** Every paper should be opened before the deck quotes a number from it. Three records could not be read at all and are marked.
- **Most studies are about something nearby, not about us.** Colour studies used lesson materials, not app chrome. Slider studies used surveys. Reading studies used Wikipedia and Arial. Each "supported" is a transfer, and the note says where.
- **The measurements are of the code and of saved screenshots,** not of the app on the test laptops. Line length and visual angle change with window size, zoom and screen.
- **Guidelines are not evidence.** WCAG, Apple and Material thresholds are agreed good practice. Meeting them shows care, and it does not show that students read or learn better.
- **No user has yet given an opinion on any of it.** Section 9 is how that changes.
- **This note was researched and drafted with an AI assistant (Claude)** from the build's own code and the team's research. Declare it with the rest of the project's AI use.
