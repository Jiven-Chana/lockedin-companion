/**
 * The laptop shows what the phone did (v2.3 part D): one quiet line on
 * Today, and a unit practised only on the phone no longer reads "not
 * started". Counts and module names only: never how many were right (R-6).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lectureStatus, lecturesWithStatus, phoneToday, TODAY_COPY, type EventLogEntry, type Lecture } from "../src/core/companion/index.ts";

const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m);
const NOW = at(27, 20);
const lectures = [
	{ id: "hci-l7", module: "HCI" },
	{ id: "hci-l8", module: "HCI" },
	{ id: "gt-nash", module: "GT" },
] as Lecture[];
const answered = (lectureId: string, when: Date, over: Record<string, unknown> = {}, heard = when): EventLogEntry => ({ t: heard.toISOString(), wall: heard.toISOString(), type: "answered", data: { source: "phone", phoneAt: when.toISOString(), lectureId, questionId: `${lectureId}-q`, choice: 0, correct: true, ...over } });

describe("what was answered on the phone today", () => {
	const cases: { name: string; events: EventLogEntry[]; want: { questions: number; modules: string[] } }[] = [
		{ name: "nothing", events: [], want: { questions: 0, modules: [] } },
		{ name: "one question", events: [answered("hci-l7", at(27, 13))], want: { questions: 1, modules: ["HCI"] } },
		{ name: "several, two modules, in the order first answered", events: [answered("gt-nash", at(27, 9)), answered("hci-l7", at(27, 13)), answered("hci-l8", at(27, 13, 5)), answered("gt-nash", at(27, 18))], want: { questions: 4, modules: ["GT", "HCI"] } },
		{ name: "right and wrong count the same", events: [answered("hci-l7", at(27, 13), { correct: false })], want: { questions: 1, modules: ["HCI"] } },
		{ name: "yesterday's are not today's", events: [answered("hci-l7", at(26, 23, 50))], want: { questions: 0, modules: [] } },
		{ name: "answered yesterday, heard by the laptop today: still yesterday's", events: [answered("hci-l7", at(26, 22), {}, at(27, 9))], want: { questions: 0, modules: [] } },
		{ name: "an answer given on the laptop is not the phone's", events: [{ ...answered("hci-l7", at(27, 13)), data: { lectureId: "hci-l7", correct: true } }], want: { questions: 0, modules: [] } },
		{ name: "a question from a unit that is gone still counts, with no module to name", events: [answered("deleted", at(27, 13))], want: { questions: 1, modules: [] } },
	];
	for (const c of cases) it(c.name, () => assert.deepEqual(phoneToday(c.events, lectures, NOW), c.want));
});

describe("the line on Today", () => {
	const names = { HCI: "HCI", GT: "Game Theory", NC: "Neural Computation" };
	const cases: [number, string[], string | null][] = [
		[0, [], null],
		[1, ["HCI"], "On your phone today: 1 question, HCI."],
		[4, ["HCI", "GT"], "On your phone today: 4 questions, HCI and Game Theory."],
		[7, ["HCI", "GT", "NC"], "On your phone today: 7 questions, HCI, Game Theory and Neural Computation."],
		[2, [], "On your phone today: 2 questions."],
		[3, ["XX"], "On your phone today: 3 questions, XX."],
	];
	for (const [n, modules, want] of cases) it(`${n} from ${modules.join(", ") || "no module"}`, () => assert.equal(TODAY_COPY.onPhone(n, modules.map((m) => names[m as keyof typeof names] ?? m)), want));

	it("never says how many were right, and never anything about falling short", () => {
		assert.doesNotMatch(TODAY_COPY.onPhone(4, ["HCI"]) ?? "", /right|wrong|correct|missed|only|behind/i);
	});
});

describe("a unit practised only on the phone", () => {
	it("no longer reads \"not started\"", () => {
		assert.equal(lectureStatus("hci-l7", [], []), "not-started");
		assert.equal(lectureStatus("hci-l7", [], [], ["hci-l7"]), "answered");
		assert.equal(lectureStatus("hci-l8", [], [], ["hci-l7"]), "not-started");
	});

	it("is carried by the state the screens and the week planner read", () => {
		const full = [{ id: "hci-l7", module: "HCI", title: "L7", week: 7, order: 7, kind: "lecture", hasMaterials: true }, { id: "hci-l8", module: "HCI", title: "L8", week: 8, order: 8, kind: "lecture", hasMaterials: true }] as Lecture[];
		const got = lecturesWithStatus({ lectures: full, sessions: [], misses: [], phoneAnswered: ["hci-l7"] });
		assert.deepEqual(got.map((l) => [l.id, l.status]), [["hci-l7", "answered"], ["hci-l8", "not-started"]]);
	});
});
