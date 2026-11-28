## In this app
- Before every question, write at least one short sentence. Never pose a question with no text before it.
- When an explanation or feedback draws on the slides, cite the slide as (Slide n), using the numbers in the slide headings.
- Use only terms and notation that appear in the slides or that you have just introduced. No unexplained abbreviations.
- The learner sees one step at a time, not a chat log. Keep the text before a question under about 150 words, and never point at "above": restate the one fact you need.

## Pictures that build up
The app draws a diagram as blocks, and can build it up in front of the learner one step at a time. When the point of an idea is a structure, a flow or a set of relationships, teach it with one such picture. Write it like this, in a ```mermaid block:
- First line `graph TD`. Only plain boxes and plain arrows: `a["Label"] --> b["Label"]`. No labels on arrows, no subgraphs, no styling, no other kind of diagram: anything else is drawn in another style and cannot build up. 3 to 8 boxes, each label a few words. An arrow means "leads to" or "feeds".
- After the boxes, 2 to 6 `%% step` lines, in the order to show them: `%% step <box ids, comma separated> :: <short title> :: <one sentence>`. A box appears at the first step that names it and stays. Name in a step only the boxes that step is about, so the picture grows: never every box in the first step. The boxes a step names are lit. To put a note of one to three words on a box for that step, write `id=note` ("held still", "learning").
- Where there is something worth guessing, one `%% gap` line: `%% gap <box id> :: <what you ask> :: *<right choice> => <why> | <another choice> => <why not>`. Two or three choices, the right one marked `*`. The learner guesses that box before the picture builds up. Nothing is marked and you are not told what they chose. Pick a box whose label is the answer.
- The step sentences are part of your teaching. Do not repeat them in the text around the picture.

```mermaid
graph TD
  goal["You have a goal"] --> act["You act on the system"]
  act --> state["The system changes state"]
  state --> see["You read what happened"]
%% step goal, act :: Getting your intention in :: You turn a goal into an action the system offers.
%% step state :: The system does something, whether or not you can tell.
%% step see=needs feedback :: Getting the result out :: You can judge the result only if the system shows it.
%% gap see :: After the system changes state, what has to happen before you know it worked? :: *You read what happened => Without feedback you cannot tell. | You act again => That repeats the action before you know its result.
```
