/**
 * Learn (v2.0 step 5; V-47, V-54): the pure rules. What the tutor is told at
 * the start, how its chat record becomes one step on the screen, which
 * answers are guesses, and how a typed goal finds its topics.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	answerRecordFrom,
	resumableSession,
	suggestForBlock,
	tutorOwesNextStep,
	buildLearnOpening,
	gradeAnswer,
	isGuess,
	LEARN_RULES,
	LEARN_SAYS,
	learnNodeRef,
	mapLearnView,
	matchTopics,
	missFromAnswer,
	planSize,
	probeSize,
	questionDataFromCall,
	toSessionQuestion,
	type CompanionSession,
	type LearnItem,
	type LearnMade,
	type LearnSpec,
	type Lecture,
} from "../src/core/companion/index.ts";
import type { PlanTree } from "../src/core/contracts.ts";
import { newAnswerResult, newHandoffMessage, newUserMessage, type LhMessage } from "../src/core/native-messages.ts";
import { assistant, quizCall, text } from "./helpers/companion-lh.ts";

const lecture: Lecture = { id: "gt-w2-nash", module: "GT", title: "Nash equilibrium", week: 2, order: 2, hasMaterials: true };
const learn: LearnSpec = { scope: "lecture", minutes: 50 };
const session = (over: Partial<CompanionSession> = {}): CompanionSession => ({
	id: "s1", engine: "learnharness", chatId: "c1", budget: 0, answered: 0, createdAt: "2026-11-20T10:00:00.000Z", state: "active",
	spec: { kind: "learn", lectureId: lecture.id, mode: "question-first", budget: { questions: 0, minutes: 50 }, study: "learn", learn },
	sittingFrom: "2026-11-20T10:00:00.000Z",
	...over,
});
const now = new Date("2026-11-20T10:10:00.000Z");
const opening = () => newUserMessage("LEARN SESSION\nModule: GT\n…");

const call = (id: string, name: string, args: Record<string, unknown>) => ({ type: "toolCall" as const, id, name, arguments: args });
const result = (toolCallId: string, toolName: string, details: unknown, isError = false): LhMessage =>
	({ id: `r_${toolCallId}`, role: "toolResult", toolCallId, toolName, content: [{ type: "text", text: "ok" }], details, isError, timestamp: 0 }) as unknown as LhMessage;
const probeCall = (id: string) => call(id, "probe", { question: `Probe ${id}?`, options: [{ label: "Right", value: "right" }, { label: "Wrong", value: "wrong" }], explanation: "Because (Slide 3).", correctAnswer: "right" });
const probeDone = (chatId = "c1"): LhMessage[] => [
	assistant([call("pd", "probe_done", { assessment: { strands: [{ strand: "Nash", assessment: "New to it." }] } }), text("Thanks. Building your plan.")]),
	result("pd", "probe_done", { ok: true }),
	newHandoffMessage(chatId),
];
const tree: PlanTree = {
	version: 1,
	nodes: [{ id: "best-response", title: "Best response" }, { id: "nash", title: "Nash equilibrium" }, { id: "mixed", title: "Mixed strategies" }],
	edges: [{ from: "best-response", to: "nash" }, { from: "nash", to: "mixed" }],
};
const planInit = (id = "pi"): LhMessage[] => [
	assistant([text("Here is the plan: three ideas, starting from best responses."), call(id, "plan_init", { mermaid: "graph TD\n a-->b" })]),
	result(id, "plan_init", { ok: true, tree }),
	assistant([text("Does that look right?")], "stop"),
];

/** Answer a posed call the way the engine records it. */
function answered(messages: LhMessage[], toolCallId: string, pick: { indices?: number[]; dontKnow?: boolean; text?: string; confidence?: number; why?: string }): LhMessage {
	for (const m of messages) {
		if (m.role !== "assistant") continue;
		for (const b of m.content) {
			if (b.type !== "toolCall" || b.id !== toolCallId) continue;
			const qd = questionDataFromCall(toolCallId, b.name, b.arguments);
			const right = qd.options.findIndex((o) => o.value === "right") + 1;
			const indices = pick.indices?.map((i) => (i === 1 ? right : (qd.options.findIndex((o) => o.value !== "right") + 1)));
			return newAnswerResult(toolCallId, b.name, gradeAnswer(qd, { questionId: toolCallId, ...pick, ...(indices ? { indices } : {}) }, b.name));
		}
	}
	throw new Error(`no call ${toolCallId}`);
}

const view = (messages: LhMessage[], over: { running?: boolean; failure?: string; tree?: PlanTree | null; session?: CompanionSession; now?: Date; made?: LearnMade[] } = {}) =>
	mapLearnView({ messages, running: over.running ?? false, failure: over.failure, session: over.session ?? session(), lecture, tree: over.tree ?? null, now: over.now ?? now, made: over.made });
const types = (items: LearnItem[]) => items.map((i) => i.type);

describe("the opening questions are sized to what was asked for (V-47)", () => {
	const cases: [LearnSpec["scope"], number][] = [["week", 4], ["lecture", 2], ["section", 1]];
	for (const [scope, n] of cases) it(`${scope}: up to ${n}`, () => assert.equal(probeSize(scope), n));
	it("the numbers live in policy", () => assert.deepEqual(LEARN_RULES.probe, { week: 4, lecture: 2, section: 1 }));
});

describe("the plan is sized to the time: about one idea per ten minutes", () => {
	const cases: [number, number][] = [[10, 2], [25, 3], [50, 5], [90, 8], [120, 8]];
	for (const [minutes, ideas] of cases) it(`${minutes} minutes: at most ${ideas} ideas`, () => assert.equal(planSize(minutes), ideas));
});

describe("what the tutor is told at the start", () => {
	const base = { lecture, moduleName: "Game Theory", now, units: [{ lecture, slidesMarkdown: "## Slide 1: Games\nA game has players.\n\n## Slide 2: Best response\nBest reply to the others.", slidesFile: "/data/materials/gt-w2-nash/slides.md", conceptMap: "graph TD\n  best-response[\"Best response · S2\"] --> nash[\"Nash equilibrium · S3\"]" }] };

	it("one lecture: the scope, the time, the opening questions, the ideas, the slides and where to read them again", () => {
		const { text: t } = buildLearnOpening({ ...base, spec: { ...session().spec } });
		assert.match(t, /^LEARN SESSION\n/);
		assert.match(t, /Module: GT \(Game Theory\)/);
		assert.match(t, /Covers: one lecture\./);
		assert.match(t, /Lecture: Nash equilibrium \(week 2\)/);
		assert.match(t, /What I want: Teach me this lecture\./);
		assert.match(t, /Time: about 50 minutes\. I may stop at any point and pick it up later\./);
		assert.match(t, /Opening questions: at most 2\./);
		assert.match(t, /Plan: at most 5 ideas\./);
		assert.match(t, /IDEAS \(plan on these slugs\)\n```mermaid\ngraph TD/);
		assert.match(t, /SLIDES FILE: \/data\/materials\/gt-w2-nash\/slides\.md/);
		assert.match(t, /SLIDES \(cite as "\(Slide n\)"\)\n## Slide 1: Games/);
	});

	it("carries what the student typed, in their words, and sizes the questions to one section", () => {
		const { text: t } = buildLearnOpening({ ...base, spec: { ...session().spec, nodes: ["nash"], learn: { scope: "section", minutes: 25, goal: "nash, I've seen it but can't find one" } } });
		assert.match(t, /Covers: one section of a lecture\./);
		assert.match(t, /What I want: nash, I've seen it but can't find one/);
		assert.match(t, /Opening questions: at most 1\./);
		assert.match(t, /Focus: only the ideas nash\./);
		assert.match(t, /Time: about 25 minutes\./);
	});

	it("a study block's first step is where the tutor starts (V-44)", () => {
		const { text: t } = buildLearnOpening({ ...base, spec: { ...session().spec, kind: "block" }, firstStep: { stem: "What is a best response?", slide: 2 } });
		assert.match(t, /First step: start on the same point as "What is a best response\?" \(Slide 2\)\./);
	});

	it("a week: every unit's ideas with a prefix, the files to read, and no slides in the message", () => {
		const second: Lecture = { ...lecture, id: "gt-w2-b", title: "Finding equilibria", order: 3 };
		const { text: t } = buildLearnOpening({
			...base,
			spec: { ...session().spec, learn: { scope: "week", minutes: 50, lectureIds: [lecture.id, second.id] } },
			units: [base.units[0]!, { lecture: second, slidesMarkdown: "## Slide 1: Method\nUnderline best responses.", slidesFile: "/data/materials/gt-w2-b/slides.md", conceptMap: "graph TD\n  method[\"The method · S1\"]" }],
		});
		assert.match(t, /Covers: this week's lectures \(2\)\./);
		assert.match(t, /Opening questions: at most 4\./);
		assert.match(t, /UNIT 1: Nash equilibrium \(week 2\)\nIDEAS \(in your plan, write each slug as u1-<slug>\)/);
		assert.match(t, /UNIT 2: Finding equilibria \(week 2\)\nIDEAS \(in your plan, write each slug as u2-<slug>\)/);
		assert.match(t, /SLIDES FILE: \/data\/materials\/gt-w2-b\/slides\.md/);
		assert.doesNotMatch(t, /Underline best responses/);
	});

	it("a plan idea in a week session names its unit", () => {
		const ids = ["gt-w2-nash", "gt-w2-b"];
		assert.deepEqual(learnNodeRef("u2-method", ids), { lectureId: "gt-w2-b", nodeId: "method" });
		assert.deepEqual(learnNodeRef("u9-method", ids), { lectureId: "gt-w2-nash", nodeId: "u9-method" });
		assert.deepEqual(learnNodeRef("nash", undefined, "gt-w2-nash"), { lectureId: "gt-w2-nash", nodeId: "nash" });
	});
});

describe("a guess is never marked (V-47)", () => {
	const cases: [string, string | undefined, boolean][] = [
		["probe", undefined, true],
		["recall", undefined, true],
		["quiz", "predict", true],
		["explain", "predict", true],
		["quiz", "check", false],
		["quiz", undefined, false],
		["ask_user_question", undefined, false],
	];
	for (const [tool, type, guess] of cases) it(`${tool}${type ? ` (${type})` : ""}: ${guess ? "a guess" : "not a guess"}`, () => assert.equal(isGuess(tool, type), guess));

	it("a wrong guess is not graded, and so is not a gap", () => {
		const msgs = [assistant([text("Before we start:"), probeCall("p1")])];
		const r = answered(msgs, "p1", { indices: [2], confidence: 90 });
		const record = answerRecordFrom((r as unknown as { details: never }).details, "p1");
		assert.equal(record.guess, true);
		assert.equal(record.graded, false);
		assert.equal(missFromAnswer(record, { sessionId: "s1", lectureId: lecture.id, now }), null);
	});

	it("a wrong check is graded, and is a gap", () => {
		const msgs = [assistant([text("Now check:"), quizCall("q1", { type: "check", nodeId: "nash" })])];
		const r = answered(msgs, "q1", { indices: [2], confidence: 90 });
		const record = answerRecordFrom((r as unknown as { details: never }).details, "q1", "nash");
		assert.equal(record.guess, undefined);
		assert.equal(record.graded, true);
		assert.equal(missFromAnswer(record, { sessionId: "s1", lectureId: lecture.id, now })?.reason, "wrong");
	});
});

describe("questions the Learn screen can show", () => {
	it("a prediction is a multiple-choice guess", () => {
		const q = toSessionQuestion(questionDataFromCall("q1", "quiz", (quizCall("q1", { type: "predict" }) as { arguments: unknown }).arguments), "quiz");
		assert.equal(q.kind, "quiz");
		assert.equal(q.guess, true);
	});
	it("a question with no options is answered in the student's own words", () => {
		const q = toSessionQuestion(questionDataFromCall("a1", "ask_user_question", { question: "Why can't two variables enter at once?" }), "ask_user_question");
		assert.equal(q.kind, "write");
		assert.equal(q.options.length, 0);
	});
	it("a choice with no right answer also takes something else, typed", () => {
		const q = toSessionQuestion(questionDataFromCall("a2", "ask_user_question", { question: "Where next?", options: [{ label: "An example" }, { label: "The proof" }] }), "ask_user_question");
		assert.equal(q.kind, "ask");
		assert.equal(q.other, true);
	});
	it("a written answer goes to the tutor as text, ungraded", () => {
		const qd = questionDataFromCall("a1", "ask_user_question", { question: "Why?" });
		const a = gradeAnswer(qd, { questionId: "a1", text: "  because the basis has a fixed size " }, "ask_user_question");
		assert.equal(a.text, "because the basis has a fixed size");
		const record = answerRecordFrom(a, "a1");
		assert.equal(record.graded, false);
		assert.equal(record.written, "because the basis has a fixed size");
	});
	it("something else on a choice goes as the student's own text", () => {
		const qd = questionDataFromCall("a2", "ask_user_question", { question: "Where next?", options: [{ label: "An example" }, { label: "The proof" }] });
		assert.equal(gradeAnswer(qd, { questionId: "a2", text: "a past paper question" }, "ask_user_question").other, "a past paper question");
	});
	it("a written question with nothing written is refused", () => {
		const qd = questionDataFromCall("a1", "ask_user_question", { question: "Why?" });
		assert.throws(() => gradeAnswer(qd, { questionId: "a1", text: "  " }, "ask_user_question"), /write your answer/);
	});
});

describe("the chat record becomes one step on the screen", () => {
	it("before the tutor has said anything it is preparing", () => {
		const v = view([opening()], { running: true, session: session({ state: "preparing" }) });
		assert.equal(v.status, "preparing");
		assert.deepEqual(v.learn?.step, []);
	});

	it("the opening message is never shown as something the student said", () => {
		const v = view([opening(), assistant([text("One quick guess first."), probeCall("p1")])]);
		assert.deepEqual(types(v.learn!.step), ["tutor"]);
	});

	it("an opening question is a guess, in the probe phase", () => {
		const v = view([opening(), assistant([text("One quick guess first."), probeCall("p1")])]);
		assert.equal(v.status, "question");
		assert.equal(v.learn?.phase, "probe");
		assert.equal(v.question?.guess, true);
		assert.equal(v.question?.kind, "quiz");
		assert.equal(v.study, undefined);
	});

	it("after an answer the step starts with what was answered, and a guess carries no mark", () => {
		const msgs: LhMessage[] = [opening(), assistant([text("One quick guess first."), probeCall("p1")])];
		msgs.push(answered(msgs, "p1", { indices: [2] }));
		const v = view(msgs, { running: true });
		assert.equal(v.status, "thinking");
		assert.equal(v.learn?.earlier, 1);
		const first = v.learn!.step[0]!;
		assert.equal(first.type, "answered");
		if (first.type !== "answered") return;
		assert.equal(first.guess, true);
		assert.equal(first.correct, undefined);
		assert.deepEqual(first.options.filter((o) => o.picked).map((o) => o.label), ["Wrong"]);
		assert.deepEqual(first.options.filter((o) => o.answer).map((o) => o.label), ["Right"]);
		assert.equal(first.explanation, "Because (Slide 3).");
	});

	it("between the opening questions and the plan, nothing runs for a moment: still thinking", () => {
		const msgs: LhMessage[] = [opening(), assistant([text("One quick guess first."), probeCall("p1")])];
		msgs.push(answered(msgs, "p1", { indices: [1] }), ...probeDone());
		assert.equal(view(msgs).status, "thinking");
	});

	it("the opening questions are over and the tutor has said so, but the plan is still to come: thinking, not the student's turn", () => {
		// The order the real engine writes: the closing sentence lands before the hand-over marker does.
		const msgs: LhMessage[] = [opening(), assistant([call("pd", "probe_done", { assessment: { strands: [{ strand: "Nash", assessment: "Not asked." }] } })]), result("pd", "probe_done", { ok: true }), assistant([text("I'll start with the payoff matrix.")], "stop")];
		assert.equal(view(msgs).status, "thinking");
		msgs.push(newHandoffMessage("c1"));
		assert.equal(view(msgs).status, "thinking");
		msgs.push(...planInit());
		assert.equal(view(msgs, { tree }).status, "reply");
	});

	it("the plan is shown once, in the step where it was proposed, and the tutor waits", () => {
		const msgs: LhMessage[] = [opening(), assistant([text("One quick guess first."), probeCall("p1")])];
		msgs.push(answered(msgs, "p1", { indices: [1] }), ...probeDone(), ...planInit());
		const v = view(msgs, { tree });
		assert.equal(v.status, "reply");
		assert.equal(v.learn?.phase, "plan");
		assert.deepEqual(types(v.learn!.step), ["answered", "tutor", "tutor", "plan", "tutor"]);
		assert.equal(v.learn?.plan?.total, 3);
		assert.equal(v.learn?.plan?.index, 0);
		assert.deepEqual(v.learn?.plan?.nodes.map((n) => n.state), ["todo", "todo", "todo"]);
	});

	it("a plan written again later is not shown a second time", () => {
		const msgs: LhMessage[] = [opening(), ...probeDone(), ...planInit("pi1"), newUserMessage(LEARN_SAYS.planOk), ...planInit("pi2")];
		assert.equal(view(msgs, { tree }).learn!.step.filter((i) => i.type === "plan").length, 1);
	});

	it("what the student typed shows as theirs", () => {
		const msgs: LhMessage[] = [opening(), ...probeDone(), ...planInit(), newUserMessage("skip the first idea, I know it")];
		const v = view(msgs, { tree, running: true });
		assert.equal(v.status, "thinking");
		assert.deepEqual(v.learn!.step.at(-1), { type: "you", id: msgs.at(-1)!.id, text: "skip the first idea, I know it" });
	});

	it("a message sent with a question open sets the question aside while the tutor answers", () => {
		const msgs: LhMessage[] = [opening(), ...probeDone(), ...planInit(), newUserMessage(LEARN_SAYS.planOk), assistant([text("What do you expect?"), quizCall("q1", { type: "predict", nodeId: "nash" })]), newUserMessage("can you draw it?")];
		const v = view(msgs, { tree, running: true });
		assert.equal(v.status, "thinking");
		assert.equal(v.question, undefined);
	});

	it("teaching: the header says which idea, and which is next", () => {
		const msgs: LhMessage[] = [opening(), ...probeDone(), ...planInit(), newUserMessage(LEARN_SAYS.planOk), assistant([text("What do you expect?"), quizCall("q1", { type: "predict", nodeId: "best-response" })])];
		msgs.push(answered(msgs, "q1", { indices: [1] }), assistant([text("A best response is… (Slide 2)"), quizCall("q2", { type: "check", nodeId: "best-response" })]));
		msgs.push(answered(msgs, "q2", { indices: [1], confidence: 90 }), assistant([text("Right. Next:"), quizCall("q3", { type: "predict", nodeId: "nash" })]));
		const v = view(msgs, { tree });
		assert.equal(v.status, "question");
		assert.equal(v.learn?.phase, "teach");
		assert.deepEqual(v.learn?.plan?.nodes.map((n) => n.state), ["done", "current", "todo"]);
		assert.equal(v.learn?.plan?.index, 2);
		assert.equal(v.learn?.plan?.current, "Nash equilibrium");
		assert.equal(v.learn?.plan?.next, "Mixed strategies");
		assert.equal(v.learn?.finished, false);
		const first = v.learn!.step[0]!;
		assert.ok(first.type === "answered" && first.correct === true && !first.guess);
		assert.equal(v.learn?.earlier, 2);
	});

	it("the plan reads prerequisites first, whatever order the tutor wrote it in", () => {
		const shuffled: PlanTree = { version: 1, nodes: [tree.nodes[2]!, tree.nodes[0]!, tree.nodes[1]!], edges: tree.edges };
		const v = view([opening(), ...probeDone(), ...planInit()], { tree: shuffled });
		assert.deepEqual(v.learn?.plan?.nodes.map((n) => n.id), ["best-response", "nash", "mixed"]);
	});

	it("finished when every idea has been reached and the last one checked", () => {
		const msgs: LhMessage[] = [opening(), ...probeDone(), ...planInit()];
		for (const [i, node] of ["best-response", "nash", "mixed"].entries()) {
			msgs.push(assistant([text(`Idea ${i + 1}.`), quizCall(`c${i}`, { type: "check", nodeId: node })]));
			if (i < 2) msgs.push(answered(msgs, `c${i}`, { indices: [1], confidence: 90 }));
		}
		assert.equal(view(msgs, { tree }).learn?.finished, false);
		msgs.push(answered(msgs, "c2", { indices: [1], confidence: 90 }), assistant([text("That's the plan covered.")], "stop"));
		const v = view(msgs, { tree });
		assert.equal(v.learn?.finished, true);
		assert.equal(v.status, "reply");
	});

	it("a written question is shown for the student's own words", () => {
		const msgs: LhMessage[] = [opening(), ...probeDone(), ...planInit(), assistant([text("In your own words:"), call("w1", "ask_user_question", { question: "Why can a game have no pure equilibrium?" })])];
		const v = view(msgs, { tree });
		assert.equal(v.status, "question");
		assert.equal(v.question?.kind, "write");
		msgs.push(answered(msgs, "w1", { text: "every cell has someone who wants to move" }));
		const first = view(msgs, { tree, running: true }).learn!.step[0]!;
		assert.ok(first.type === "answered" && first.written === "every cell has someone who wants to move" && first.correct === undefined);
	});

	it("something being made shows as on its way, then in place, where it landed", () => {
		const msgs: LhMessage[] = [opening(), ...probeDone(), ...planInit(), assistant([text("Let me draw the payoff matrix."), call("v1", "visual", { brief: "A 2x2 payoff matrix" })]), result("v1", "visual", "Dispatched (job j1)."), assistant([text("Meanwhile:"), quizCall("q1", { type: "predict", nodeId: "nash" })])];
		const making = view(msgs, { tree }).learn!.step;
		assert.deepEqual(making.find((i) => i.type === "making"), { type: "making", id: "v1", kind: "visual" });
		msgs.push(answered(msgs, "q1", { indices: [1] }));
		// Dispatched in an earlier step and still not here: it stays in view.
		assert.deepEqual(types(view(msgs, { tree, running: true }).learn!.step), ["answered", "making"]);
		msgs.push({ id: "steer_j1", role: "custom", customType: "subagent-steer", content: "The visual is ready.", display: true, details: { jobId: "j1", kind: "visual", toolCallId: "v1", result: { svg: "<svg></svg>", notes: "Rows are player 1." } }, timestamp: 0 } as unknown as LhMessage);
		msgs.push(assistant([text("Look at the picture: the rows are player 1.")], "stop"));
		const landed = view(msgs, { tree }).learn!.step;
		assert.deepEqual(types(landed), ["answered", "visual", "tutor"]);
		assert.deepEqual(landed[1], { type: "visual", id: "v1", svg: "<svg></svg>", notes: "Rows are player 1." });
	});

	it("a picture that is finished shows at once, even while a question is open and the engine is still holding it back", () => {
		const msgs: LhMessage[] = [opening(), ...probeDone(), ...planInit(), assistant([text("Let me draw the payoff matrix."), call("v1", "visual", { brief: "A 2x2 payoff matrix" })]), result("v1", "visual", "Dispatched (job j1)."), assistant([text("Meanwhile:"), quizCall("q1", { type: "check", nodeId: "nash" })])];
		const cases: { name: string; made: LearnMade[]; want: LearnItem }[] = [
			{ name: "nothing finished yet", made: [], want: { type: "making", id: "v1", kind: "visual" } },
			{ name: "another call's picture", made: [{ toolCallId: "v9", kind: "visual", result: { svg: "<svg></svg>" } }], want: { type: "making", id: "v1", kind: "visual" } },
			{ name: "finished", made: [{ toolCallId: "v1", kind: "visual", result: { svg: "<svg></svg>", notes: "Rows are player 1." } }], want: { type: "visual", id: "v1", svg: "<svg></svg>", notes: "Rows are player 1." } },
			{ name: "finished with nothing to show", made: [{ toolCallId: "v1", kind: "visual", result: {} }], want: { type: "failed", id: "v1", kind: "visual" } },
			{ name: "failed", made: [{ toolCallId: "v1", kind: "visual", failed: true }], want: { type: "failed", id: "v1", kind: "visual" } },
		];
		for (const c of cases) {
			const v = view(msgs, { tree, made: c.made });
			assert.equal(v.status, "question", c.name);
			// It sits where the tutor said it would draw it, above the question.
			assert.deepEqual(types(v.learn!.step).slice(-3), ["tutor", c.want.type, "tutor"], c.name);
			assert.deepEqual(v.learn!.step.at(-2), c.want, c.name);
		}
		// Once answered, the engine hands it over and it sits where it landed: shown once, not twice.
		msgs.push(answered(msgs, "q1", { indices: [1] }));
		msgs.push({ id: "steer_j1", role: "custom", customType: "subagent-steer", content: "The visual is ready.", display: true, details: { jobId: "j1", kind: "visual", toolCallId: "v1", result: { svg: "<svg></svg>" } }, timestamp: 0 } as unknown as LhMessage);
		const after = view(msgs, { tree, running: true, made: cases[2]!.made });
		assert.deepEqual(types(after.learn!.step), ["answered", "visual"]);
	});

	it("a demo and a look-up arrive as themselves; one that failed says so", () => {
		const steer = (job: string, kind: string, toolCallId: string, r: unknown) => ({ id: `steer_${job}`, role: "custom", customType: "subagent-steer", content: "ready", display: true, details: { jobId: job, kind, toolCallId, result: r }, timestamp: 0 }) as unknown as LhMessage;
		const msgs: LhMessage[] = [opening(), ...probeDone(),
			assistant([text("Three things."), call("d1", "demo", { title: "Best-response explorer", brief: "…" }), call("r1", "research", { question: "Who was Nash?" }), call("v9", "visual", { brief: "…" })]),
			result("d1", "demo", "Dispatched"), result("r1", "research", "Dispatched"), result("v9", "visual", "Dispatched"),
			steer("j1", "demo", "d1", { title: "Best-response explorer", html: "<html></html>", tested: true }),
			steer("j2", "research", "r1", { brief: "John Nash, 1950.", sources: [{ title: "Nobel", url: "https://example.org" }] }),
			{ id: "steer_j3", role: "custom", customType: "subagent-abort", content: "failed", display: true, details: { jobId: "j3", kind: "visual", toolCallId: "v9", failure: "x" }, timestamp: 0 } as unknown as LhMessage,
		];
		const step = view(msgs, { running: true }).learn!.step;
		assert.deepEqual(step.slice(-3), [
			{ type: "demo", id: "d1", title: "Best-response explorer", html: "<html></html>" },
			{ type: "research", id: "r1", brief: "John Nash, 1950.", sources: [{ title: "Nobel", url: "https://example.org" }] },
			{ type: "failed", id: "v9", kind: "visual" },
		]);
	});

	it("a question asked beside the open question sits under it, and the question stays", () => {
		const msgs: LhMessage[] = [opening(), ...probeDone(), ...planInit(), assistant([text("What do you expect?"), quizCall("q1", { type: "predict", nodeId: "nash" })])];
		const v = view(msgs, { tree, session: session({ asides: [{ questionId: "q1", ask: "what does basis mean?", answer: "The variables allowed to be non-zero.", at: "" }, { questionId: "old", ask: "x", answer: "y", at: "" }] }) });
		assert.equal(v.status, "question");
		assert.deepEqual(v.learn!.step.at(-1), { type: "aside", id: "q1-0", ask: "what does basis mean?", answer: "The variables allowed to be non-zero." });
		assert.equal(v.learn!.step.filter((i) => i.type === "aside").length, 1);
	});

	it("the clock: time left, then time up, and nothing ends", () => {
		const msgs: LhMessage[] = [opening(), ...probeDone(), ...planInit()];
		const early = view(msgs, { tree });
		assert.equal(early.learn?.timeUp, false);
		assert.equal(early.learn?.endsAt, "2026-11-20T10:50:00.000Z");
		const late = view(msgs, { tree, now: new Date("2026-11-20T10:51:00.000Z") });
		assert.equal(late.learn?.timeUp, true);
		assert.equal(late.status, "reply");
	});

	it("a finished session is done and names what it covered", () => {
		const msgs: LhMessage[] = [opening(), ...probeDone(), ...planInit(), assistant([text("Idea 1."), quizCall("c0", { type: "check", nodeId: "best-response" })])];
		msgs.push(answered(msgs, "c0", { indices: [1], confidence: 90 }), assistant([text("Next."), quizCall("c1", { type: "predict", nodeId: "nash" })]));
		const v = view(msgs, { tree, session: session({ state: "done" }) });
		assert.equal(v.status, "done");
		assert.deepEqual(v.learn?.covered, ["Best response", "Nash equilibrium"]);
	});

	it("a turn that never started does not leave the student waiting: after a while they can carry on", () => {
		const msgs: LhMessage[] = [opening(), assistant([text("One quick guess first."), probeCall("p1")])];
		msgs.push(answered(msgs, "p1", { indices: [1] }));
		assert.equal(view(msgs).status, "thinking");
		assert.equal(view(msgs, { now: new Date(Date.now() + LEARN_RULES.stalledMs + 1_000) }).status, "reply");
	});

	it("a failed turn is an error the screen can retry", () => {
		assert.equal(view([opening()], { failure: "boom" }).status, "error");
	});

	it("the slides a step cites are collected for the slide panel", () => {
		const v = view([opening(), ...probeDone(), ...planInit(), assistant([text("See (Slide 4) and (Slide 2).")], "stop")], { tree });
		assert.deepEqual(v.slideRefs, [2, 4]);
	});
});

describe("a tutor that reacts to an answer and stops is asked to carry on, once", () => {
	const upTo = (): LhMessage[] => {
		const msgs: LhMessage[] = [opening(), ...probeDone(), ...planInit(), newUserMessage(LEARN_SAYS.planOk), assistant([text("A best response is… (Slide 2)"), quizCall("c1", { type: "check", nodeId: "best-response" })])];
		msgs.push(answered(msgs, "c1", { indices: [1], confidence: 90 }));
		return msgs;
	};
	const steer = { id: "steer_j1", role: "custom", customType: "subagent-steer", content: "ready", display: true, details: { jobId: "j1", kind: "visual", toolCallId: "v1", result: { svg: "<svg></svg>" } }, timestamp: 0 } as unknown as LhMessage;
	const cases: [string, (m: LhMessage[]) => LhMessage[], boolean][] = [
		["it gave feedback and stopped", (m) => [...m, assistant([text("That reasoning is right.")], "stop")], true],
		["it ended on a question of its own: the student's turn", (m) => [...m, assistant([text("Right. Shall we look at an example first?")], "stop")], false],
		["it has just been asked to carry on: not again", (m) => [...m, assistant([text("Right.")], "stop"), newUserMessage(LEARN_SAYS.carryOn), assistant([text("Good.")], "stop")], false],
		["the student had said something: their turn", (m) => [...m, assistant([text("Right.")], "stop"), newUserMessage("slow down please"), assistant([text("Of course.")], "stop")], false],
		["something it made arrived and it explained it", (m) => [...m, assistant([text("Right.")], "stop"), newUserMessage("ok"), assistant([text("Sure.")], "stop"), steer, assistant([text("In the figure, the rows are player 1.")], "stop")], true],
		["it asked the next question itself", (m) => [...m, assistant([text("Right. Next:"), quizCall("c2", { type: "predict", nodeId: "nash" })])], false],
		["its turn failed", (m) => [...m, assistant([text("Right.")], "error")], false],
		["it has said nothing since the answer", (m) => m, false],
	];
	for (const [name, add, expected] of cases) it(name, () => assert.equal(tutorOwesNextStep(add(upTo())), expected));

	it("lines LockedIn sends for a button press are not shown as something the student typed", () => {
		const msgs = [...upTo(), assistant([text("Right.")], "stop"), newUserMessage(LEARN_SAYS.carryOn), assistant([text("Next idea.")], "stop")];
		assert.deepEqual(types(view(msgs, { tree }).learn!.step), ["answered", "tutor", "tutor"]);
	});
});

describe("a typed goal finds its topics in the module (start sheet)", () => {
	const topics = [
		{ lectureId: "gt-w1", nodeId: undefined, title: "Dominance", week: 1 },
		{ lectureId: "gt-w3", nodeId: undefined, title: "Mixed strategies", week: 3 },
		{ lectureId: "gt-w3", nodeId: "mixed-eq", title: "Mixed-strategy equilibrium", week: 3 },
		{ lectureId: "gt-w3", nodeId: "indifference", title: "The indifference condition", week: 3 },
		{ lectureId: "gt-w2", nodeId: "nash", title: "Nash equilibrium", week: 2 },
	];
	const titles = (q: string) => matchTopics(q, topics).map((t) => t.title);

	const cases: [string, string, string[]][] = [
		["a prefix while typing", "mixed strat", ["Mixed strategies", "Mixed-strategy equilibrium"]],
		["words in a sentence", "nash, I've seen it but can't find one", ["Nash equilibrium"]],
		["plurals and case", "DOMINANCE", ["Dominance"]],
		["nothing in the module", "simplex pivots", []],
		["too little to go on", "a", []],
		["filler words alone match nothing", "I want to do the", []],
	];
	for (const [name, q, expected] of cases) it(name, () => assert.deepEqual(titles(q), expected));

	it("offers at most three, lectures before their ideas when equally good", () => {
		const many = Array.from({ length: 6 }, (_, i) => ({ lectureId: `l${i}`, nodeId: i % 2 ? `n${i}` : undefined, title: `Equilibrium ${i}`, week: 1 }));
		const got = matchTopics("equilibrium", many);
		assert.equal(got.length, LEARN_RULES.suggestions);
		assert.ok(got.every((t) => t.nodeId === undefined));
	});
});

describe("a study block suggests one mode and offers the other (AFF-N: the mode is a choice per visit)", () => {
	const at = new Date("2026-11-20T10:10:00.000Z");
	const learnt = (state: CompanionSession["state"], over: Partial<CompanionSession> = {}): CompanionSession => session({ id: `s-${state}`, state, lastActivityAt: "2026-11-19T10:00:00.000Z", ...over });
	const cases: [string, { sessions: CompanionSession[]; canLearn: boolean; canPractise: boolean }, { study: string; why: string; resume?: string; other: string | null }][] = [
		["never learned: Learn, you haven't yet", { sessions: [], canLearn: true, canPractise: true }, { study: "learn", why: "not-yet", other: "practise" }],
		["stopped part-way: Learn, pick up where you stopped", { sessions: [learnt("stopped")], canLearn: true, canPractise: true }, { study: "learn", why: "unfinished", resume: "s-stopped", other: "practise" }],
		["left open in a tab counts as part-way too", { sessions: [learnt("active")], canLearn: true, canPractise: true }, { study: "learn", why: "unfinished", resume: "s-active", other: "practise" }],
		["learned once: Practise, and Learn is still offered", { sessions: [learnt("done")], canLearn: true, canPractise: true }, { study: "practise", why: "learned", other: "learn" }],
		["a week session that covered this lecture counts as learned", { sessions: [learnt("done", { spec: { ...session().spec, lectureId: "other", learn: { scope: "week", minutes: 50, lectureIds: ["other", lecture.id] } } })], canLearn: true, canPractise: true }, { study: "practise", why: "learned", other: "learn" }],
		["a session stopped more than a week ago is not offered again: start fresh", { sessions: [learnt("stopped", { lastActivityAt: "2026-11-01T10:00:00.000Z" })], canLearn: true, canPractise: true }, { study: "learn", why: "not-yet", other: "practise" }],
		["no AI connected: Practise, and nothing else to offer", { sessions: [], canLearn: false, canPractise: true }, { study: "practise", why: "no-ai", other: null }],
		["no question bank yet: Learn only", { sessions: [learnt("done")], canLearn: true, canPractise: false }, { study: "learn", why: "learned", other: null }],
		["a Learn session on another lecture changes nothing", { sessions: [learnt("stopped", { spec: { ...session().spec, lectureId: "other" } })], canLearn: true, canPractise: true }, { study: "learn", why: "not-yet", other: "practise" }],
	];
	for (const [name, input, expected] of cases) it(name, () => assert.deepEqual(suggestForBlock({ lectureId: lecture.id, now: at, ...input }), expected));
});

describe("a Learn session that was left is offered again (R-5)", () => {
	const at = new Date("2026-11-20T10:10:00.000Z");
	it("it has no question count, so being stopped or left open is what counts", () => {
		assert.equal(resumableSession([session({ state: "stopped", endedAt: "2026-11-20T09:00:00.000Z" })], at)?.id, "s1");
		assert.equal(resumableSession([session({ state: "active", lastActivityAt: "2026-11-20T09:00:00.000Z" })], at)?.id, "s1");
		assert.equal(resumableSession([session({ state: "done" })], at), null);
		assert.equal(resumableSession([session({ state: "ready" })], at), null);
	});
});
