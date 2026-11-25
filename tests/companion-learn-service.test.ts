/**
 * Learn through CompanionService and the real LearnHarnessEngine, over a
 * stand-in tutor (a fake LhPort that answers like the engine's chat): start,
 * the opening guesses, talking to the tutor, gaps, stopping and finishing,
 * and the module's start sheet (v2.0 step 5; V-47, V-54).
 *
 * 17 Nov 2026 is a Tuesday. The sample timetable: HCI Tue 11–13, GT Wed 10–12.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { LEARN_COPY, LEARN_SAYS } from "../src/core/companion/index.ts";
import type { PlanTree } from "../src/core/contracts.ts";
import type { ChatInput } from "../src/core/input-events.ts";
import { newAnswerResult, newHandoffMessage, newUserMessage, type LhMessage } from "../src/core/native-messages.ts";
import { ManualClock } from "../src/server/companion/clock.ts";
import { CompanionContent } from "../src/server/companion/content.ts";
import { LearnHarnessEngine, type LhPort, type LhSendResult } from "../src/server/companion/engines/learnharness.ts";
import { ScriptedEngine } from "../src/server/companion/engines/scripted.ts";
import { CompanionError } from "../src/server/companion/errors.ts";
import type { Generate, GenerateRequest } from "../src/server/companion/generate.ts";
import { CompanionService } from "../src/server/companion/service.ts";
import { CompanionStore } from "../src/server/companion/store.ts";
import { assistant, quizCall, text } from "./helpers/companion-lh.ts";

const CONTENT = path.join(import.meta.dirname, "..", "companion", "content");
const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m);

const call = (id: string, name: string, args: Record<string, unknown>) => ({ type: "toolCall" as const, id, name, arguments: args });
const result = (toolCallId: string, toolName: string, details: unknown): LhMessage =>
	({ id: `r_${toolCallId}`, role: "toolResult", toolCallId, toolName, content: [{ type: "text", text: "ok" }], details, isError: false, timestamp: Date.now() }) as unknown as LhMessage;
const probe = (id: string) => call(id, "probe", { question: `Guess ${id}?`, options: [{ label: "Right", value: "right" }, { label: "Wrong", value: "wrong" }], explanation: "Because (Slide 4).", correctAnswer: "right" });
const tree: PlanTree = { version: 1, nodes: [{ id: "persona-purpose", title: "What personas are for" }, { id: "scenarios", title: "Scenarios" }], edges: [{ from: "persona-purpose", to: "scenarios" }] };

/** The tutor: an LhPort whose chat reacts to what it is sent. */
class Tutor implements LhPort {
	chats = new Map<string, LhMessage[]>();
	sent: { chatId: string; input: ChatInput }[] = [];
	sides: { chatId: string; anchor: string; text: string }[] = [];
	steered: string[] = [];
	busy = new Set<string>();
	trees = new Map<string, PlanTree>();
	sideFails = false;
	/** What the tutor does when something arrives. */
	react: (chatId: string, input: ChatInput, n: number) => void = () => {};
	createChat() {
		const id = `chat_${this.chats.size + 1}`;
		this.chats.set(id, []);
		return id;
	}
	messages = (id: string) => this.chats.get(id) ?? null;
	running = (id: string) => this.busy.has(id);
	failure = () => undefined;
	async send(chatId: string, input: ChatInput): Promise<LhSendResult> {
		if (this.busy.has(chatId)) return { status: 409, error: "A turn is already running for this session" };
		this.sent.push({ chatId, input });
		const record = this.chats.get(chatId)!;
		if (input.type === "text") record.push(newUserMessage(input.text));
		if (input.type === "answer") {
			const name = record.flatMap((m) => (m.role === "assistant" ? m.content : [])).find((b) => b.type === "toolCall" && b.id === input.toolCallId) as { name: string } | undefined;
			record.push(newAnswerResult(input.toolCallId, name?.name ?? "quiz", input.answer));
		}
		this.react(chatId, input, this.sent.length);
		return { status: 200 };
	}
	async askSide(chatId: string, anchor: string, t: string) {
		if (this.sideFails) throw new Error("The source is not a teaching segment in this session");
		this.sides.push({ chatId, anchor, text: t });
		return " Personas stand in for real users (Slide 4). ";
	}
	cost = () => 0.02;
	deleteChat(id: string) {
		this.chats.delete(id);
	}
	tree = (id: string) => this.trees.get(id) ?? null;
	async steer(chatId: string, t: string) {
		if (!this.busy.has(chatId)) return false;
		this.steered.push(t);
		return true;
	}
	say(chatId: string, ...m: LhMessage[]) {
		this.chats.get(chatId)!.push(...m);
	}
	texts = () => this.sent.flatMap((s) => (s.input.type === "text" ? [s.input.text] : []));
}

function setup(opts: { connected?: boolean; start?: Date; asked?: boolean; generate?: Generate } = {}) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "companion-learn-"));
	const store = new CompanionStore(dir);
	const content = new CompanionContent(store, CONTENT);
	const clock = new ManualClock(opts.start ?? at(17, 14));
	const tutor = new Tutor();
	let n = 0;
	const svc = new CompanionService({
		store, content, clock,
		clockControl: { set: (t) => clock.set(t), reset: () => clock.set(at(17, 14)) },
		engines: { scripted: new ScriptedEngine((id) => content.scriptedSet(id), (picks) => content.practiseSet(picks)), learnharness: new LearnHarnessEngine(tutor, { pollMs: 2 }) },
		defaultEngine: opts.connected === false ? "scripted" : "learnharness",
		readyTimeoutMs: 500,
		promptsDir: path.join(import.meta.dirname, "..", "companion", "prompts"),
		...(opts.generate ? { generate: opts.generate } : {}),
		newId: (p) => `${p}${++n}`,
	});
	svc.onboard({ modules: ["HCI", "GT"], timetableSource: "sample", nudgesPerDay: 1 });
	// The first-time card (V-52) has its own tests below; everywhere else these modules have already been asked.
	if (opts.asked !== false) store.saveNotes({ HCI: { asked: true }, GT: { asked: true } });
	const events = (type: string) => store.events().filter((e) => e.type === type).map((e) => e.data);
	return { svc, store, clock, tutor, events };
}

/** A tutor that opens with one guess, then proposes the plan and teaches it. */
function teachingTutor(tutor: Tutor) {
	tutor.react = (chatId, input) => {
		const say = (...m: LhMessage[]) => tutor.say(chatId, ...m);
		const record = tutor.chats.get(chatId)!;
		const posed = (id: string) => record.some((m) => m.role === "assistant" && m.content.some((b) => b.type === "toolCall" && b.id === id));
		const planned = () => {
			tutor.trees.set(chatId, tree);
			say(
				assistant([call("pd", "probe_done", { assessment: { strands: [{ strand: "Personas", assessment: "New." }] } }), text("Thanks.")]),
				result("pd", "probe_done", { ok: true }),
				newHandoffMessage(chatId),
				assistant([text("Two ideas, starting with what personas are for."), call("pi", "plan_init", { mermaid: "graph TD" })]),
				result("pi", "plan_init", { ok: true, tree }),
				assistant([text("Does that look right?")], "stop"),
			);
		};
		if (input.type === "text" && /^LEARN SESSION/.test(input.text)) return say(assistant([text("One quick guess before we start."), probe("p1")]));
		// Skip: said in words when nothing is open, or the open guess dismissed.
		if (input.type === "text" && input.text === LEARN_SAYS.skipProbe) return planned();
		if (input.type === "answer" && input.toolCallId === "p1") return planned();
		if (input.type === "text" && input.text === LEARN_SAYS.planOk) return say(assistant([text("A persona is a made-up but evidence-based user (Slide 4)."), quizCall("c1", { type: "check", nodeId: "persona-purpose" })]));
		if (input.type === "answer" && input.toolCallId === "c1") return say(assistant([text("Now scenarios."), quizCall("c2", { type: "check", nodeId: "scenarios" })]));
		if (input.type === "answer" && input.toolCallId === "c2") return say(assistant([text("That's the plan covered.")], "stop"));
		if (input.type === "text" && !posed("w1")) return say(assistant([text("Good question. In your own words:"), call("w1", "ask_user_question", { question: "Why do designers use personas?" })]));
		return say(assistant([text("Noted.")], "stop"));
	};
}

const pick = (v: { question?: { options: { index: number; label: string }[] } }, label: string) => v.question!.options.find((o) => o.label === label)!.index;

describe("starting Learn (V-47)", () => {
	it("\"Learn this\" on a lecture starts at once: the tutor is told the scope, the time and where the slides are", async () => {
		const { svc, store, tutor } = setup();
		teachingTutor(tutor);
		const { sessionId } = svc.startLearn({ lectureId: "hci-w3-personas" });
		await svc.whenReady(sessionId);
		const session = store.session(sessionId)!;
		assert.deepEqual([session.engine, session.spec.kind, session.spec.study, session.spec.learn?.scope, session.spec.learn?.minutes, session.budget], ["learnharness", "learn", "learn", "lecture", 50, 0]);
		assert.equal(session.state, "ready");
		const opening = tutor.texts()[0]!;
		assert.match(opening, /^LEARN SESSION\nModule: HCI/);
		assert.match(opening, /Opening questions: at most 2\./);
		assert.match(opening, /SLIDES FILE: .*hci-w3-personas[/\\]slides\.md/);
		assert.match(opening, /IDEAS \(plan on these slugs\)/);
		const v = await svc.view(sessionId);
		assert.deepEqual([v.status, v.study, v.learn?.phase, v.question?.guess], ["question", "learn", "probe", true]);
		assert.equal(v.goal, LEARN_COPY.goal(50));
	});

	it("what the student typed is handed over in their words, with the idea it matched", async () => {
		const { svc, store, tutor } = setup();
		teachingTutor(tutor);
		const { sessionId } = svc.startLearn({ lectureId: "hci-w3-personas", nodes: ["persona-purpose"], goal: "  personas,   I've seen them but don't get the point " });
		await svc.whenReady(sessionId);
		assert.equal(store.session(sessionId)!.spec.learn?.scope, "section");
		assert.match(tutor.texts()[0]!, /What I want: personas, I've seen them but don't get the point\n/);
		assert.match(tutor.texts()[0]!, /Opening questions: at most 1\./);
		assert.match(tutor.texts()[0]!, /Focus: only the ideas persona-purpose\./);
	});

	it("with no AI connected, Learn says so and nothing is started", () => {
		const { svc, store } = setup({ connected: false });
		assert.throws(() => svc.startLearn({ lectureId: "hci-w3-personas" }), (e: unknown) => e instanceof CompanionError && e.code === "not_connected" && e.status === 409 && e.message === LEARN_COPY.notConnected);
		assert.equal(store.sessions().length, 0);
	});

	it("a lecture with no slides can't be taught", () => {
		const { svc, store } = setup();
		store.saveLectures([...store.allLectures(), { id: "hci-x", module: "HCI", title: "No slides", week: 9, order: 99, kind: "lecture", hasMaterials: false }]);
		assert.throws(() => svc.startLearn({ lectureId: "hci-x" }), (e: unknown) => e instanceof CompanionError && e.code === "no_material");
	});

	it("this week: that module's lectures in the current teaching week, in one session", async () => {
		const { svc, store, tutor } = setup();
		teachingTutor(tutor);
		// Week one began on Mon 2 Nov, so 17 Nov is in teaching week 3. Two HCI units are in week 3.
		const profile = store.profile()!;
		store.saveProfile({ ...profile, modules: profile.modules.map((m) => ({ ...m, weekOneStart: "2026-11-02" })) });
		store.saveLectures(store.allLectures().map((l) => (l.id === "hci-w4-fieldwork" ? { ...l, week: 3 } : l)));
		const sheet = svc.learnSheet("HCI");
		assert.deepEqual(sheet.week, { week: 3, lectureIds: ["hci-w3-personas", "hci-w4-fieldwork"] });
		const { sessionId } = svc.startLearn({ module: "HCI", week: true });
		await svc.whenReady(sessionId);
		const spec = store.session(sessionId)!.spec;
		assert.deepEqual([spec.learn?.scope, spec.learn?.lectureIds, spec.lectureId], ["week", ["hci-w3-personas", "hci-w4-fieldwork"], "hci-w3-personas"]);
		const opening = tutor.texts()[0]!;
		assert.match(opening, /Covers: this week's lectures \(2\)\./);
		assert.match(opening, /Opening questions: at most 4\./);
		assert.match(opening, /UNIT 2: .*\nIDEAS \(in your plan, write each slug as u2-<slug>\)/);
		assert.doesNotMatch(opening, /\nSLIDES \(cite as/);
		// The header names the week; the slide panel follows the unit of the idea being taught.
		let v = await svc.view(sessionId);
		assert.deepEqual([v.lecture.title, v.learn?.unit], ["Week 3 · 2 lectures", undefined]);
		tutor.trees.set("chat_1", { version: 1, nodes: [{ id: "u1-persona-purpose", title: "Personas" }, { id: "u2-observation", title: "Observation" }], edges: [] });
		tutor.say("chat_1", assistant([text("Now fieldwork."), quizCall("wk1", { type: "check", nodeId: "u2-observation" })]));
		v = await svc.view(sessionId);
		assert.equal(v.learn?.unit?.id, "hci-w4-fieldwork");
		// An answer in a week session lands on its own unit and idea.
		await svc.answer(sessionId, { questionId: "wk1", indices: [pick(v, "Wrong A")], confidence: 90 });
		assert.deepEqual(store.misses().map((m) => [m.lectureId, m.nodeId]), [["hci-w4-fieldwork", "observation"]]);
	});

	it("this week with nothing to teach says so", () => {
		const { svc } = setup();
		assert.throws(() => svc.startLearn({ module: "GT", week: true }), (e: unknown) => e instanceof CompanionError && e.code === "nothing_this_week");
	});
});

describe("two modes only: what the old session kinds become", () => {
	it("a missed lecture is taught (Learn); a retest is quick questions (Practise)", () => {
		const { svc, store } = setup();
		const missed = svc.createSession(svc.parseSpec({ kind: "missed-lecture", lectureId: "hci-w3-personas" }));
		assert.deepEqual([store.session(missed.sessionId)!.engine, store.session(missed.sessionId)!.spec.study], ["learnharness", "learn"]);
		store.saveMisses([{ id: "m1", lectureId: "hci-w3-personas", sessionId: "s0", questionId: "q0", questionText: "Q?", correctLabels: ["A"], reason: "wrong", status: "open", timesSeen: 0, nextDue: at(16, 9).toISOString(), createdAt: at(15, 9).toISOString() }]);
		const retest = svc.createSession(svc.parseSpec({ kind: "retest", lectureId: "hci-w3-personas" }));
		assert.deepEqual([store.session(retest.sessionId)!.engine, store.session(retest.sessionId)!.spec.study], ["scripted", "practise"]);
	});
});

describe("the loop: guesses, the plan, checks", () => {
	it("a wrong guess is not a gap; a wrong check is", async () => {
		const { svc, store, tutor, events } = setup();
		teachingTutor(tutor);
		const { sessionId } = svc.startLearn({ lectureId: "hci-w3-personas" });
		await svc.whenReady(sessionId);
		let v = await svc.view(sessionId);
		assert.deepEqual(await svc.answer(sessionId, { questionId: "p1", indices: [pick(v, "Wrong")], confidence: 90 }), { correct: false, graded: false });
		assert.equal(store.misses().length, 0);
		assert.deepEqual([events("answer")[0]!.guess, events("answer")[0]!.graded], [true, false]);

		v = await svc.view(sessionId);
		assert.deepEqual([v.status, v.learn?.phase, v.learn?.plan?.total], ["reply", "plan", 2]);
		assert.ok(v.learn!.step.some((i) => i.type === "plan"));
		assert.deepEqual(await svc.say(sessionId, { say: "planOk" }), { queued: false, answer: null });

		v = await svc.view(sessionId);
		assert.deepEqual([v.status, v.learn?.phase, v.question?.guess, v.learn?.plan?.index], ["question", "teach", undefined, 1]);
		await svc.answer(sessionId, { questionId: "c1", indices: [pick(v, "Wrong A")], confidence: 90 });
		assert.deepEqual(store.misses().map((m) => [m.questionId, m.nodeId, m.reason, m.lectureId]), [["c1", "persona-purpose", "wrong", "hci-w3-personas"]]);
		assert.deepEqual(store.session(sessionId)!.learnAt, { index: 1, total: 2, title: "What personas are for", covered: ["What personas are for"], plan: [{ title: "What personas are for", state: "current" }, { title: "Scenarios", state: "todo" }] });
	});

	it("\"Skip, just teach me\" with a guess open dismisses the guess, which is how the tutor hears of it", async () => {
		const { svc, store, tutor, events } = setup();
		teachingTutor(tutor);
		const { sessionId } = svc.startLearn({ lectureId: "hci-w3-personas" });
		await svc.whenReady(sessionId);
		assert.equal((await svc.view(sessionId)).status, "question");
		await svc.say(sessionId, { say: "skipProbe" });
		// Left open, the engine refuses to end the opening questions (seen with the real AI), so the question is dismissed.
		const last = tutor.sent.at(-1)!.input;
		assert.ok(last.type === "answer" && last.toolCallId === "p1" && last.answer.dismissed === true);
		assert.equal(tutor.texts().includes(LEARN_SAYS.skipProbe), false);
		assert.equal(tutor.sides.length, 0);
		// A dismissed guess is not an answer: no step, no gap, no event.
		assert.equal(store.misses().length, 0);
		assert.equal(events("answer").length, 0);
		assert.equal((await svc.view(sessionId)).learn?.earlier, 0);
		assert.deepEqual([(await svc.view(sessionId)).status, (await svc.view(sessionId)).learn?.phase], ["reply", "plan"]);
		assert.deepEqual(events("learn_said"), [{ sessionId, how: "skipProbe", chars: 0 }]);
	});
});

describe("talking to the tutor (V-54)", () => {
	async function atCheck() {
		const s = setup();
		teachingTutor(s.tutor);
		const { sessionId } = s.svc.startLearn({ lectureId: "hci-w3-personas" });
		await s.svc.whenReady(sessionId);
		await s.svc.say(sessionId, { say: "skipProbe" });
		await s.svc.say(sessionId, { say: "planOk" });
		return { ...s, sessionId };
	}

	it("with a question open, it is answered beside the question, and the question stays", async () => {
		const { svc, store, tutor, sessionId, events } = await atCheck();
		const before = tutor.sent.length;
		const r = await svc.say(sessionId, { text: "what is a persona again?", questionId: "c1" });
		assert.deepEqual(r, { queued: false, answer: "Personas stand in for real users (Slide 4)." });
		assert.equal(tutor.sent.length, before, "nothing was sent into the lesson");
		assert.equal(tutor.sides[0]!.text, "what is a persona again?");
		const v = await svc.view(sessionId);
		assert.equal(v.status, "question");
		assert.deepEqual(v.learn!.step.at(-1), { type: "aside", id: "c1-0", ask: "what is a persona again?", answer: "Personas stand in for real users (Slide 4)." });
		assert.deepEqual(v.slideRefs, [4]);
		assert.equal(store.session(sessionId)!.asides?.length, 1);
		// What was said is never logged, only that it was.
		assert.deepEqual(events("learn_said").at(-1), { sessionId, how: "beside", chars: 24 });
	});

	it("where there is nothing to answer beside, it goes as a message", async () => {
		const { svc, tutor, sessionId } = await atCheck();
		tutor.sideFails = true;
		const r = await svc.say(sessionId, { text: "can we slow down?", questionId: "c1" });
		assert.deepEqual(r, { queued: false, answer: null });
		assert.equal(tutor.texts().at(-1), "can we slow down?");
	});

	it("while the tutor is writing, it is handed over at its next pause", async () => {
		const { svc, tutor, sessionId } = await atCheck();
		tutor.busy.add("chat_1");
		assert.deepEqual(await svc.say(sessionId, { text: "use a football example" }), { queued: true, answer: null });
		assert.deepEqual(tutor.steered, ["use a football example"]);
	});

	it("when the tutor is waiting, it is the student's turn; a written question takes their own words", async () => {
		const s = setup();
		teachingTutor(s.tutor);
		const { sessionId } = s.svc.startLearn({ lectureId: "hci-w3-personas" });
		await s.svc.whenReady(sessionId);
		await s.svc.say(sessionId, { say: "skipProbe" });
		await s.svc.say(sessionId, { text: "before we start, why personas at all?" });
		let v = await s.svc.view(sessionId);
		assert.deepEqual([v.status, v.question?.kind], ["question", "write"]);
		assert.ok(v.learn!.step.some((i) => i.type === "you" && i.text === "before we start, why personas at all?"));
		assert.deepEqual(await s.svc.answer(sessionId, { questionId: "w1", text: "so the team argues about a person, not opinions" }), { correct: false, graded: false });
		v = await s.svc.view(sessionId);
		const first = v.learn!.step[0]!;
		assert.ok(first.type === "answered" && first.written === "so the team argues about a person, not opinions");
		assert.equal(s.store.misses().length, 0);
	});

	it("refuses an empty message, an over-long one, and a session that isn't Learn", async () => {
		const { svc, sessionId, store } = await atCheck();
		await assert.rejects(svc.say(sessionId, { text: "   " }), /say something first/);
		await assert.rejects(svc.say(sessionId, { text: "x".repeat(2_001) }), /under 2000/);
		await assert.rejects(svc.say(sessionId, { say: "nope" }), /say must be one of/);
		store.saveMisses([{ id: "m1", lectureId: "hci-w3-personas", sessionId: "s0", questionId: "q0", questionText: "Q?", correctLabels: ["A"], reason: "wrong", status: "open", timesSeen: 0, nextDue: at(16, 9).toISOString(), createdAt: at(15, 9).toISOString() }]);
		const practise = svc.createSession(svc.parseSpec({ kind: "retest", lectureId: "hci-w3-personas" }));
		await assert.rejects(svc.say(practise.sessionId, { text: "hello" }), (e: unknown) => e instanceof CompanionError && e.code === "not_learn");
	});
});

describe("stopping, picking up and finishing: nothing ends by itself", () => {
	async function taught() {
		const s = setup();
		teachingTutor(s.tutor);
		const { sessionId } = s.svc.startLearn({ lectureId: "hci-w3-personas" });
		await s.svc.whenReady(sessionId);
		await s.svc.say(sessionId, { say: "skipProbe" });
		await s.svc.say(sessionId, { say: "planOk" });
		const v = await s.svc.view(sessionId);
		await s.svc.answer(sessionId, { questionId: "c1", indices: [pick(v, "Right")], confidence: 90 });
		return { ...s, sessionId };
	}

	it("time up is a line, not a stop", async () => {
		const { svc, clock, sessionId } = await taught();
		let v = await svc.view(sessionId);
		assert.deepEqual([v.learn?.timeUp, v.status], [false, "question"]);
		clock.set(at(17, 15, 1));
		v = await svc.view(sessionId);
		assert.deepEqual([v.learn?.timeUp, v.status], [true, "question"]);
	});

	it("Stop saves it with its plan; opening it again picks up where it was, with a fresh clock", async () => {
		const { svc, store, clock, sessionId, events } = await taught();
		await svc.view(sessionId);
		svc.stop(sessionId);
		assert.equal(store.session(sessionId)!.state, "stopped");
		assert.deepEqual(events("session_stopped").at(-1), { sessionId, answered: 1, budget: 0, engine: "learnharness", idea: 2, ideas: 2 });
		const sheet = svc.learnSheet("HCI");
		assert.deepEqual(sheet.suggestion, { type: "resume", sessionId, lectureId: "hci-w3-personas", title: "Scenarios", at: { index: 2, total: 2, title: "Scenarios", covered: ["What personas are for", "Scenarios"], plan: [{ title: "What personas are for", state: "done" }, { title: "Scenarios", state: "current" }] } });
		clock.set(at(18, 9));
		const v = await svc.view(sessionId);
		assert.deepEqual([v.status, v.question?.id, v.learn?.timeUp], ["question", "c2", false]);
		assert.equal(store.session(sessionId)!.state, "active");
		assert.equal(v.learn?.endsAt, at(18, 9, 50).toISOString());
	});

	it("the last idea checked offers Finish; only the student's Finish ends it, and the done screen names what was covered", async () => {
		const { svc, store, sessionId, events } = await taught();
		let v = await svc.view(sessionId);
		assert.equal(v.learn?.finished, false);
		await svc.answer(sessionId, { questionId: "c2", indices: [pick(v, "Right")], confidence: 90 });
		v = await svc.view(sessionId);
		assert.deepEqual([v.status, v.learn?.finished], ["reply", true]);
		assert.equal(store.session(sessionId)!.state, "active");
		svc.finish(sessionId);
		v = await svc.view(sessionId);
		assert.deepEqual([v.status, v.learn?.covered], ["done", ["What personas are for", "Scenarios"]]);
		assert.equal(events("session_done").length, 1);
		assert.deepEqual([events("session_done")[0]!.idea, events("session_done")[0]!.ideas], [2, 2]);
		// A finished lecture is no longer the suggestion: the next one is.
		assert.deepEqual(svc.learnSheet("HCI").suggestion?.type, "next");
		assert.notEqual(svc.learnSheet("HCI").suggestion?.lectureId, "hci-w3-personas");
	});

	it("Earlier: every step so far", async () => {
		const { svc, sessionId } = await taught();
		const { steps } = svc.steps(sessionId);
		assert.equal(steps.length, 2);
		assert.deepEqual(steps[1]!.map((i) => i.type), ["answered", "tutor"]);
	});
});

describe("a study block suggests a mode and offers the other", () => {
	const blockOn = (store: CompanionStore) => store.saveBlocks([{ id: "blk1", date: "2026-11-17", start: "15:00", minutes: 25, status: "accepted", source: "planner", lectureId: "hci-w3-personas", module: "HCI" }]);

	it("not learned yet: the block opens Learn for the block's own length, and Practise is offered beside it", async () => {
		const { svc, store, tutor } = setup();
		teachingTutor(tutor);
		blockOn(store);
		const card = svc.plan().blocks.find((b) => b.id === "blk1")!;
		assert.deepEqual(card.mode, { study: "learn", label: "Learn this · you haven't yet", other: { study: "practise", label: "Practise instead" } });
		assert.deepEqual(svc.today().nextBlock?.mode, card.mode);
		const { sessionId } = svc.startBlock("blk1");
		const session = store.session(sessionId!)!;
		assert.deepEqual([session.spec.kind, session.spec.study, session.spec.learn?.minutes, session.engine], ["block", "learn", 25, "learnharness"]);
		await svc.whenReady(sessionId!);
		assert.match(tutor.texts()[0]!, /Time: about 25 minutes\./);
	});

	it("the other mode can be chosen instead: Practise, on the bank", () => {
		const { svc, store } = setup();
		blockOn(store);
		const { sessionId } = svc.startBlock("blk1", { study: "practise" });
		assert.deepEqual([store.session(sessionId!)!.engine, store.session(sessionId!)!.spec.study], ["scripted", "practise"]);
		assert.throws(() => svc.startBlock("blk1", { study: "quiz" }), /study must be learn or practise/);
	});

	it("stopped part-way: the next block on that lecture picks it up, with the new block's time", async () => {
		const { svc, store, tutor } = setup();
		teachingTutor(tutor);
		const first = svc.startLearn({ lectureId: "hci-w3-personas" });
		await svc.whenReady(first.sessionId);
		await svc.say(first.sessionId, { say: "skipProbe" });
		await svc.view(first.sessionId);
		svc.stop(first.sessionId);
		blockOn(store);
		assert.equal(svc.plan().blocks.find((b) => b.id === "blk1")!.mode?.label, "Learn this · pick up where you stopped");
		const { sessionId } = svc.startBlock("blk1");
		assert.equal(sessionId, first.sessionId);
		assert.equal(store.session(sessionId!)!.spec.learn?.minutes, 25);
		assert.equal(store.sessions().length, 1);
	});

	it("learned once: the block suggests Practise, and Learn is still offered", async () => {
		const { svc, store, tutor } = setup();
		teachingTutor(tutor);
		const first = svc.startLearn({ lectureId: "hci-w3-personas" });
		await svc.whenReady(first.sessionId);
		svc.finish(first.sessionId);
		blockOn(store);
		assert.deepEqual(svc.plan().blocks.find((b) => b.id === "blk1")!.mode, { study: "practise", label: "Practise this · you've learned it", other: { study: "learn", label: "Learn instead" } });
		const { sessionId } = svc.startBlock("blk1");
		assert.equal(store.session(sessionId!)!.spec.study, "practise");
	});

	it("with no AI connected a block is Practise, with nothing else to offer", () => {
		const { svc, store } = setup({ connected: false });
		blockOn(store);
		assert.deepEqual(svc.plan().blocks.find((b) => b.id === "blk1")!.mode, { study: "practise", label: "Practise this · your AI isn't connected", other: null });
	});
});

describe("Today offers a stopped Learn session again", () => {
	it("with where it was saved, by idea, and nothing marked missed", async () => {
		const { svc, tutor } = setup();
		teachingTutor(tutor);
		const { sessionId } = svc.startLearn({ lectureId: "hci-w3-personas" });
		await svc.whenReady(sessionId);
		await svc.say(sessionId, { say: "skipProbe" });
		await svc.say(sessionId, { say: "planOk" });
		const v = await svc.view(sessionId);
		await svc.answer(sessionId, { questionId: "c1", indices: [pick(v, "Right")], confidence: 90 });
		await svc.view(sessionId);
		svc.stop(sessionId);
		const r = svc.today().resume!;
		assert.deepEqual([r.sessionId, r.study, r.answered, r.budget], [sessionId, "learn", 1, 2]);
		assert.equal(r.text, "Saved at Scenarios, idea 2 of 2. Pick up any time. Nothing is marked missed.");
	});

	it("before there is a plan, it is still saved", async () => {
		const { svc, tutor } = setup();
		teachingTutor(tutor);
		const { sessionId } = svc.startLearn({ lectureId: "hci-w3-personas" });
		await svc.whenReady(sessionId);
		await svc.view(sessionId);
		svc.stop(sessionId);
		assert.equal(svc.today().resume?.text, "Saved where you stopped. Pick up any time. Nothing is marked missed.");
	});
});

describe("the module's start sheet (AFF-K: one small step)", () => {
	it("one suggestion (the next lecture not yet learned), the lectures, and topics to match a typed goal against", () => {
		const { svc } = setup();
		const sheet = svc.learnSheet("HCI");
		assert.deepEqual(sheet.module, { code: "HCI", name: "Human-Computer Interaction" });
		assert.equal(sheet.connected, true);
		assert.equal(sheet.minutes, 50);
		assert.equal(sheet.suggestion?.type, "next");
		assert.equal(sheet.suggestion?.lectureId, sheet.lectures[0]!.id);
		assert.ok(sheet.lectures.length >= 3 && sheet.lectures.every((l) => l.id.startsWith("hci-")));
		assert.ok(sheet.topics.some((t) => t.lectureId === "hci-w3-personas" && t.nodeId === undefined));
		assert.ok(sheet.topics.some((t) => t.lectureId === "hci-w3-personas" && t.nodeId === "persona-purpose"));
		assert.equal(sheet.week, null);
	});

	it("says when the AI isn't connected, so the sheet can offer Practise", () => {
		assert.equal(setup({ connected: false }).svc.learnSheet("HCI").connected, false);
	});
});

describe("how you learn it: asked once per module, before its first Learn session (V-52)", () => {
	it("the first Learn session in a module waits on the card; the tutor is not started", async () => {
		const { svc, store, tutor } = setup({ asked: false });
		teachingTutor(tutor);
		const { sessionId } = svc.startLearn({ lectureId: "hci-w3-personas" });
		await svc.whenReady(sessionId);
		const v = await svc.view(sessionId);
		assert.deepEqual([v.status, v.study, v.ask], ["ask", "learn", { module: "HCI", name: "Human-Computer Interaction", canCopy: false }]);
		assert.equal(tutor.sent.length, 0);
		assert.equal(store.session(sessionId)!.chatId, undefined);
	});

	it("the taps are saved as the module's note, handed to the tutor, and the session starts", async () => {
		const { svc, store, tutor, events } = setup({ asked: false });
		teachingTutor(tutor);
		const { sessionId } = svc.startLearn({ lectureId: "hci-w3-personas" });
		await svc.view(sessionId);
		svc.answerHow(sessionId, { start: "examples", check: "often", more: "I hate analogies", steps: "sideways" });
		await svc.whenReady(sessionId);
		assert.deepEqual(store.notes().HCI, { asked: true, how: { text: "Start each idea with a worked example. Check me often. I hate analogies.", prefs: { start: "examples", check: "often", more: "I hate analogies" }, at: at(17, 14).toISOString() } });
		assert.match(tutor.texts()[0]!, /ABOUT ME IN THIS MODULE \(notes the app keeps; I can see and edit them\)\nHow I like to learn it: Start each idea with a worked example\. Check me often\. I hate analogies\.\n/);
		assert.equal((await svc.view(sessionId)).status, "question");
		// What was typed is never logged: only that something was.
		assert.deepEqual(events("how_answered"), [{ module: "HCI", how: "taps", rows: 2, typed: true }]);
	});

	it("it is asked once: the next Learn session in that module starts at once", async () => {
		const { svc, tutor } = setup({ asked: false });
		teachingTutor(tutor);
		const first = svc.startLearn({ lectureId: "hci-w3-personas" });
		svc.answerHow(first.sessionId, { skip: true });
		await svc.whenReady(first.sessionId);
		const second = svc.startLearn({ lectureId: "hci-w2-users" });
		await svc.whenReady(second.sessionId);
		assert.equal((await svc.view(second.sessionId)).status, "question");
	});

	it("Skip leaves no note, and the tutor runs its usual loop", async () => {
		const { svc, store, tutor, events } = setup({ asked: false });
		teachingTutor(tutor);
		const { sessionId } = svc.startLearn({ lectureId: "hci-w3-personas" });
		svc.answerHow(sessionId, { skip: true });
		await svc.whenReady(sessionId);
		assert.deepEqual(store.notes().HCI, { asked: true });
		assert.doesNotMatch(tutor.texts()[0]!, /ABOUT ME/);
		assert.equal(events("how_answered")[0]!.how, "skip");
	});

	it("from the second module: the same as my other modules", async () => {
		const { svc, store, tutor } = setup({ asked: false });
		teachingTutor(tutor);
		store.saveNotes({ HCI: { asked: true, how: { text: "Small steps. Check me often.", at: at(16, 9).toISOString() } } });
		const { sessionId } = svc.startLearn({ lectureId: "gt-w2-nash" });
		assert.equal((await svc.view(sessionId)).ask?.canCopy, true);
		svc.answerHow(sessionId, { same: true });
		await svc.whenReady(sessionId);
		assert.equal(store.notes().GT?.how?.text, "Small steps. Check me often.");
		assert.match(tutor.texts()[0]!, /How I like to learn it: Small steps\. Check me often\./);
	});

	it("\"the same\" with nothing to copy is refused", () => {
		const { svc } = setup({ asked: false });
		const { sessionId } = svc.startLearn({ lectureId: "hci-w3-personas" });
		assert.throws(() => svc.answerHow(sessionId, { same: true }), /no other module has an answer/);
	});

	it("a study block's first Learn in a module is asked too", async () => {
		const { svc, store } = setup({ asked: false });
		store.saveBlocks([{ id: "blk1", date: "2026-11-17", start: "15:00", minutes: 25, status: "accepted", source: "planner", lectureId: "hci-w3-personas", module: "HCI" }]);
		const { sessionId } = svc.startBlock("blk1");
		assert.equal((await svc.view(sessionId!)).status, "ask");
	});

	it("answered in another tab: a waiting session notices and starts", async () => {
		const { svc, store, tutor } = setup({ asked: false });
		teachingTutor(tutor);
		const { sessionId } = svc.startLearn({ lectureId: "hci-w3-personas" });
		store.saveNotes({ HCI: { asked: true } });
		assert.equal((await svc.view(sessionId)).status, "preparing");
		await svc.whenReady(sessionId);
		assert.equal((await svc.view(sessionId)).status, "question");
	});
});

describe("the three notes (V-53)", () => {
	async function stopped(generate?: Generate) {
		const s = setup({ ...(generate ? { generate } : {}) });
		teachingTutor(s.tutor);
		s.store.saveNotes({ HCI: { asked: true, how: { text: "Small steps.", at: at(16, 9).toISOString() } }, GT: { asked: true } });
		const { sessionId } = s.svc.startLearn({ lectureId: "hci-w3-personas" });
		await s.svc.whenReady(sessionId);
		await s.svc.say(sessionId, { say: "skipProbe" });
		await s.svc.say(sessionId, { say: "planOk" });
		const v = await s.svc.view(sessionId);
		await s.svc.answer(sessionId, { questionId: "c1", indices: [pick(v, "Wrong A")], confidence: 90, why: "a persona is a real user" });
		await s.svc.view(sessionId);
		s.svc.stop(sessionId);
		await s.svc.whenNoted(sessionId);
		return { ...s, sessionId };
	}

	it("the Library shows all three: how you learn it, where you are, and the last session's plan and where it stopped", async () => {
		const { svc, sessionId } = await stopped();
		const n = svc.moduleNotes("HCI");
		assert.deepEqual(n.module, { code: "HCI", name: "Human-Computer Interaction" });
		assert.deepEqual([n.asked, n.how?.text, n.where], [true, "Small steps.", null]);
		assert.deepEqual(n.last, { sessionId, lecture: "Personas and scenarios", at: at(17, 14).toISOString(), index: 2, total: 2, title: "Scenarios", plan: [{ title: "What personas are for", state: "done" }, { title: "Scenarios", state: "current" }], finished: false });
		assert.deepEqual(svc.moduleNotes("GT").last, null);
	});

	it("after a Learn session the AI rewrites \"where you are\" from what the session showed, on the cheap model", async () => {
		const asked: GenerateRequest[] = [];
		const generate = (async (req: GenerateRequest) => {
			asked.push(req);
			return { value: { note: "Secure: nothing checked yet.\nShaky: what personas are for (you took a persona to be a real user).\nNext: scenarios." }, model: "test/cheap", cost: null, ms: 5 };
		}) as Generate;
		const { svc, events } = await stopped(generate);
		assert.equal(asked.length, 1);
		assert.equal(asked[0]!.slot, "cheap");
		assert.match(asked[0]!.system, /where they are in one module/);
		assert.match(asked[0]!.user, /The note as it stands:\n\(empty\)/);
		assert.match(asked[0]!.user, /This session's plan: What personas are for \(done\); Scenarios \(stopped here\)/);
		assert.match(asked[0]!.user, /- Check: Question c1\? \| answered: Wrong A \| not right \| answer: Right \| their why: a persona is a real user/);
		const where = svc.moduleNotes("HCI").where!;
		assert.deepEqual([where.by, where.text.startsWith("Secure:")], ["ai", true]);
		assert.deepEqual(events("note_rewritten").map((e) => [e.module, e.words, e.model]), [["HCI", 20, "test/cheap"]]);
		// A note over its cap is sent back to be shortened.
		assert.match(asked[0]!.validate!({ note: Array.from({ length: 251 }, () => "w").join(" ") })!, /keep it under 250/);
		assert.equal(asked[0]!.validate!({ note: "Secure: x." }), null);
	});

	it("the next session in that module is handed all three notes", async () => {
		const generate = (async () => ({ value: { note: "Shaky: what personas are for." }, model: "test/cheap", cost: null, ms: 5 })) as Generate;
		const { svc, tutor } = await stopped(generate);
		const next = svc.startLearn({ lectureId: "hci-w2-users" });
		await svc.whenReady(next.sessionId);
		const opening = tutor.texts().filter((t) => t.startsWith("LEARN SESSION")).at(-1)!;
		assert.match(opening, /How I like to learn it: Small steps\.\nWhere I am: Shaky: what personas are for\.\nLast session: Personas and scenarios: stopped at idea 2 of 2, Scenarios\. Its plan: What personas are for \(done\); Scenarios \(stopped here\)\./);
	});

	it("a rewrite that fails leaves the note as it was, and says so in the log", async () => {
		const generate = (async () => { throw new Error("no answer"); }) as Generate;
		const { svc, events } = await stopped(generate);
		assert.equal(svc.moduleNotes("HCI").where, null);
		assert.deepEqual(events("note_rewrite_failed").map((e) => e.message), ["no answer"]);
	});

	it("a session with nothing answered shows nothing new: the note is not rewritten", async () => {
		let calls = 0;
		const { svc, tutor } = setup({ generate: (async () => { calls++; return { value: { note: "x" }, model: "m", cost: null, ms: 1 }; }) as Generate });
		teachingTutor(tutor);
		const { sessionId } = svc.startLearn({ lectureId: "hci-w3-personas" });
		await svc.whenReady(sessionId);
		await svc.view(sessionId);
		svc.stop(sessionId);
		await svc.whenNoted(sessionId);
		assert.equal(calls, 0);
	});

	it("each note can be edited, within its cap, and an edit is the student's", async () => {
		const { svc, events } = await stopped();
		let n = svc.saveModuleNote("HCI", { how: "  Examples first, always.  ", where: "Shaky: scenarios." });
		assert.deepEqual([n.how?.text, n.where?.text, n.where?.by], ["Examples first, always.", "Shaky: scenarios.", "you"]);
		assert.deepEqual(events("note_edited").map((e) => e.note), ["how", "where"]);
		n = svc.saveModuleNote("HCI", { how: "" });
		assert.deepEqual([n.how, n.where?.text, n.asked], [null, "Shaky: scenarios.", true]);
		const long = Array.from({ length: 121 }, () => "w").join(" ");
		assert.throws(() => svc.saveModuleNote("HCI", { how: long }), /Keep it under 120 words/);
		assert.throws(() => svc.saveModuleNote("HCI", {}), /nothing to save/);
		assert.throws(() => svc.saveModuleNote("NOPE", { how: "x" }), CompanionError);
	});

	it("\"Delete all my data\" removes the notes", async () => {
		const { svc, store } = await stopped();
		assert.ok(store.notes().HCI);
		await svc.deleteAll();
		assert.deepEqual(store.notes(), {});
	});
});
