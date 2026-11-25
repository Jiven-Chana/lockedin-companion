/**
 * Learn (v2.0 step 5; V-47, V-54): the tutor teaching, loose on top of the
 * probe, learn, predict, check loop. Pure rules: what the tutor is told at
 * the start, how its chat record becomes ONE step on the screen, and how a
 * typed goal finds its topics.
 *
 * The screen shows one step at a time and never a chat log (AE-5, AFF-C,
 * AE2-3). A step is everything since the student's last answer.
 */

import { derivePlanStatusesLh, type PlanTree } from "../contracts.ts";
import { failedOutputCallIds, hasProbeDone, pendingQuestionOf, sendToUserText, type LhMessage } from "../native-messages.ts";
import { QUESTION_TOOLS } from "../pending.ts";
import type { QuestionAnswerData } from "../question-core.ts";
import { sideSegmentId } from "../side-chat.ts";
import { LEARN_COPY, LEARN_RULES, LEARN_SAYS } from "./policy.ts";
import { isGuess, isShowMeAnswer, questionDataFromCall, toSessionQuestion } from "./question-data.ts";
import { parseSlideRefs, trimSlides } from "./slides.ts";
import type { CompanionSession, LearnArtifactKind, LearnItem, LearnPlanView, LearnScope, Lecture, SessionSpec, SessionView } from "./types.ts";

/** How many opening questions the tutor may ask, sized to what was asked for. */
export function probeSize(scope: LearnScope): number {
	return LEARN_RULES.probe[scope];
}

// ─── what the tutor is told at the start ────────────────────────────────────

export interface LearnUnit {
	lecture: Lecture;
	slidesMarkdown: string;
	/** Where the tutor can read this unit's slides again (an absolute path). */
	slidesFile: string | null;
	/** The unit's concept map (mermaid graph TD), when its study pack has one. */
	conceptMap?: string | null;
}

export interface LearnOpeningInput {
	spec: SessionSpec;
	lecture: Lecture;
	moduleName?: string;
	units: LearnUnit[];
	now: Date;
	/** A study block's first step (V-44): where the tutor starts. */
	firstStep?: { stem: string; slide: number | null };
}

const COVERS: Record<LearnScope, (n: number) => string> = {
	lecture: () => "one lecture.",
	section: () => "one section of a lecture.",
	week: (n) => `this week's lectures (${n}).`,
};
const DEFAULT_WANT: Record<LearnScope, string> = {
	lecture: "Teach me this lecture.",
	section: "Teach me this part of the lecture.",
	week: "Teach me this week's lectures.",
};

const unitLine = (l: Lecture) => `${l.title}${l.week > 0 ? ` (week ${l.week})` : ""}${l.attended === false ? " (I missed it)" : ""}`;

/**
 * The first message of a Learn session. The tutor's instructions
 * (companion/seed/prompts) rely on these field names: change both together.
 */
export function buildLearnOpening(input: LearnOpeningInput): { text: string; slidesTrimmed: boolean } {
	const { spec, lecture } = input;
	const learn = spec.learn ?? { scope: "lecture" as const, minutes: LEARN_RULES.defaultMinutes };
	const week = learn.scope === "week" && input.units.length > 1;
	const lines = [
		"LEARN SESSION",
		`Module: ${input.moduleName ? `${lecture.module} (${input.moduleName})` : lecture.module}`,
		`Covers: ${COVERS[learn.scope](input.units.length)}`,
		...(week ? [] : [`Lecture: ${unitLine(lecture)}`]),
		`What I want: ${learn.goal?.replace(/\s+/g, " ").trim() || DEFAULT_WANT[learn.scope]}`,
		`Time: about ${learn.minutes} minutes. I may stop at any point and pick it up later.`,
		`Opening questions: at most ${probeSize(learn.scope)}.`,
		...(spec.nodes?.length ? [`Focus: only the ideas ${spec.nodes.join(", ")}.`] : []),
		...(input.firstStep ? [`First step: start on the same point as "${input.firstStep.stem}"${input.firstStep.slide ? ` (Slide ${input.firstStep.slide})` : ""}.`] : []),
	];
	let trimmed = false;
	if (week) {
		// A week in one session opens on the maps of its units; the slides are read as the plan reaches each idea.
		input.units.forEach((u, i) => {
			lines.push("", `UNIT ${i + 1}: ${unitLine(u.lecture)}`);
			if (u.conceptMap?.trim()) lines.push(`IDEAS (in your plan, write each slug as u${i + 1}-<slug>)`, "```mermaid", u.conceptMap.trim(), "```");
			if (u.slidesFile) lines.push(`SLIDES FILE: ${u.slidesFile}`);
		});
	} else {
		const u = input.units[0];
		if (u?.conceptMap?.trim()) lines.push("", "IDEAS (plan on these slugs)", "```mermaid", u.conceptMap.trim(), "```");
		if (u?.slidesFile) lines.push("", `SLIDES FILE: ${u.slidesFile}`);
		const slides = trimSlides(u?.slidesMarkdown ?? "", LEARN_RULES.slideTokenBudget);
		trimmed = slides.trimmed;
		lines.push("", 'SLIDES (cite as "(Slide n)")', slides.markdown.trim());
	}
	return { text: `${lines.join("\n")}\n`, slidesTrimmed: trimmed };
}

/** Which unit a plan idea belongs to: in a week session ideas are written `u2-<slug>`. */
export function learnNodeRef(nodeId: string, lectureIds: readonly string[] | undefined, fallbackLectureId?: string): { lectureId: string; nodeId: string } {
	const m = /^u(\d+)-(.+)$/.exec(nodeId);
	const unit = m && lectureIds ? lectureIds[Number(m[1]) - 1] : undefined;
	if (m && unit) return { lectureId: unit, nodeId: m[2]! };
	return { lectureId: lectureIds?.[0] ?? fallbackLectureId ?? "", nodeId };
}

// ─── the chat record as steps ───────────────────────────────────────────────

const OPENING_RE = /^(LEARN|APP) SESSION\b/;
/** Lines LockedIn sends for a button press. They are not something the student typed, so the step doesn't repeat them. */
const OWN_LINES: readonly string[] = Object.values(LEARN_SAYS);
const ARTIFACT_KINDS: readonly string[] = ["visual", "demo", "research"];
/** Markers that are bookkeeping, not something that happened in the lesson. */
const QUIET_MARKERS: readonly string[] = ["plan-block", "compaction", "side-question", "side-question-told", "graph-context"];

function userText(m: LhMessage): string {
	const c = (m as { content?: unknown }).content;
	if (typeof c === "string") return c;
	return Array.isArray(c) ? c.map((p: { type?: string; text?: string }) => (p?.type === "text" ? (p.text ?? "") : "")).join("") : "";
}

function answerOf(m: LhMessage): QuestionAnswerData | null {
	if (m.role !== "toolResult" || m.isError || !(QUESTION_TOOLS as readonly string[]).includes(m.toolName)) return null;
	const d = m.details as QuestionAnswerData | null | undefined;
	if (!d || typeof d !== "object" || d.dismissed || typeof d.kind !== "string") return null;
	return d;
}

function answeredItem(id: string, tool: string, d: QuestionAnswerData, type: unknown): LearnItem {
	const guess = isGuess(tool, d.questionType ?? (typeof type === "string" ? type : undefined));
	const correct = new Set(d.correctIndices ?? []);
	const picked = new Set(d.answers.map((a) => a.index));
	const written = d.text ?? d.other;
	const explanation = d.explanation ?? d.committed;
	const shown = isShowMeAnswer(d);
	return {
		type: "answered",
		id,
		stem: d.questionText,
		guess,
		options: (d.options ?? []).map((o) => ({ label: o.label, picked: picked.has(o.index), answer: correct.has(o.index) })),
		...(written ? { written } : {}),
		dontKnow: d.dontKnow,
		...(d.kind === "quiz" && !guess && !shown ? { correct: d.correct === true } : {}),
		...(explanation ? { explanation } : {}),
		...(d.thinking && !shown ? { why: d.thinking } : {}),
	};
}

function artifactItem(toolCallId: string, kind: string, result: unknown): LearnItem | null {
	const r = (result ?? {}) as Record<string, unknown>;
	if (kind === "visual" && typeof r.svg === "string") return { type: "visual", id: toolCallId, svg: r.svg, ...(typeof r.notes === "string" && r.notes ? { notes: r.notes } : {}) };
	if (kind === "demo" && typeof r.html === "string") return { type: "demo", id: toolCallId, title: typeof r.title === "string" ? r.title : "", html: r.html };
	if (kind === "research" && typeof r.brief === "string") {
		const sources = Array.isArray(r.sources) ? r.sources.filter((s): s is { title: string; url: string } => !!s && typeof s.title === "string" && typeof s.url === "string").map((s) => ({ title: s.title, url: s.url })) : [];
		return { type: "research", id: toolCallId, brief: r.brief, sources };
	}
	return null;
}

/**
 * Every step of the session, oldest first. A new step starts at each answer
 * and opens with what was answered. Something still being made stays in view
 * in the newest step; once made, it sits where it landed.
 */
export function learnSteps(messages: readonly LhMessage[]): LearnItem[][] {
	const failed = failedOutputCallIds(messages);
	const callTypes = new Map<string, unknown>();
	const settled = new Set<string>();
	const planOk = new Set<string>();
	for (const m of messages) {
		if (m.role === "assistant") {
			for (const b of m.content) if (b.type === "toolCall") callTypes.set(b.id, (b.arguments as { type?: unknown } | undefined)?.type);
		} else if (m.role === "toolResult" && m.toolName === "plan_init" && !m.isError && (m.details as { ok?: unknown } | null)?.ok !== false) {
			planOk.add(m.toolCallId);
		} else if (m.role === "custom" && (m.customType === "subagent-steer" || m.customType === "subagent-abort")) {
			const id = (m.details as { toolCallId?: unknown } | null)?.toolCallId;
			if (typeof id === "string") settled.add(id);
		}
	}

	const steps: LearnItem[][] = [[]];
	let step = steps[0]!;
	let planShown = false;
	for (const m of messages) {
		if (m.role === "user") {
			const t = userText(m).trim();
			if (t && !OPENING_RE.test(t) && !OWN_LINES.includes(t)) step.push({ type: "you", id: m.id, text: t });
		} else if (m.role === "assistant") {
			m.content.forEach((b, i) => {
				if (b.type === "text") {
					if (b.text.trim()) step.push({ type: "tutor", id: `${m.id}-${i}`, text: b.text.trim() });
					return;
				}
				if (b.type !== "toolCall") return;
				const said = failed.has(b.id) ? undefined : sendToUserText(b);
				if (said) step.push({ type: "tutor", id: `${m.id}-${i}`, text: said.trim() });
				else if (b.name === "plan_init" && planOk.has(b.id) && !planShown) {
					planShown = true;
					step.push({ type: "plan", id: b.id });
				} else if (ARTIFACT_KINDS.includes(b.name) && !settled.has(b.id)) {
					const title = (b.arguments as { title?: unknown } | undefined)?.title;
					step.push({ type: "making", id: b.id, kind: b.name as LearnArtifactKind, ...(typeof title === "string" && title ? { title } : {}) });
				}
			});
		} else if (m.role === "toolResult") {
			const d = answerOf(m);
			if (d) {
				step = [answeredItem(m.toolCallId, m.toolName, d, callTypes.get(m.toolCallId))];
				steps.push(step);
			}
		} else if (m.role === "custom" && (m.customType === "subagent-steer" || m.customType === "subagent-abort")) {
			const d = (m.details ?? {}) as { kind?: unknown; toolCallId?: unknown; result?: unknown };
			if (typeof d.kind !== "string" || typeof d.toolCallId !== "string" || !ARTIFACT_KINDS.includes(d.kind)) continue;
			const made = m.customType === "subagent-steer" ? artifactItem(d.toolCallId, d.kind, d.result) : null;
			step.push(made ?? { type: "failed", id: d.toolCallId, kind: d.kind as LearnArtifactKind });
		}
	}
	// Still on its way from an earlier step: keep it in view (AFF-H).
	const last = steps.at(-1)!;
	const waiting: LearnItem[] = [];
	for (const s of steps.slice(0, -1)) {
		for (let i = s.length - 1; i >= 0; i--) if (s[i]!.type === "making") waiting.unshift(...s.splice(i, 1));
	}
	if (waiting.length) last.splice(last[0]?.type === "answered" ? 1 : 0, 0, ...waiting);
	return steps;
}

/** The plan as the screen draws it: prerequisites first, each idea done, current or still to come. */
export function learnPlan(tree: PlanTree | null | undefined, messages: readonly LhMessage[]): LearnPlanView | undefined {
	if (!tree || tree.nodes.length === 0) return undefined;
	const statuses = derivePlanStatusesLh(tree, messages);
	// A stable order: an idea comes after everything it needs, otherwise as the tutor wrote it.
	const needs = new Map(tree.nodes.map((n) => [n.id, new Set<string>()]));
	for (const e of tree.edges) needs.get(e.to)?.add(e.from);
	const placed = new Set<string>();
	const ordered: PlanTree["nodes"] = [];
	while (ordered.length < tree.nodes.length) {
		const next = tree.nodes.find((n) => !placed.has(n.id) && [...needs.get(n.id)!].every((p) => placed.has(p))) ?? tree.nodes.find((n) => !placed.has(n.id))!;
		placed.add(next.id);
		ordered.push(next);
	}
	const nodes = ordered.map((n) => ({ id: n.id, title: n.title, state: statuses.current === n.id ? ("current" as const) : statuses.visited.has(n.id) ? ("done" as const) : ("todo" as const) }));
	const at = nodes.findIndex((n) => n.state === "current");
	const next = nodes.slice(at + 1).find((n) => n.state === "todo") ?? nodes.find((n) => n.state === "todo");
	return {
		nodes,
		edges: tree.edges.map((e) => ({ from: e.from, to: e.to })),
		index: at + 1,
		total: nodes.length,
		...(at >= 0 ? { current: nodes[at]!.title } : {}),
		...(next ? { next: next.title } : {}),
	};
}

/** The current idea has had a Check answered. */
function currentChecked(tree: PlanTree, messages: readonly LhMessage[]): boolean {
	const current = derivePlanStatusesLh(tree, messages).current;
	if (!current) return false;
	const checks = new Set<string>();
	for (const m of messages) {
		if (m.role !== "assistant") continue;
		for (const b of m.content) {
			if (b.type !== "toolCall" || (b.name !== "quiz" && b.name !== "explain")) continue;
			const a = b.arguments as { nodeId?: unknown; type?: unknown } | undefined;
			if (a?.nodeId === current && a.type !== "predict") checks.add(b.id);
		}
	}
	return messages.some((m) => m.role === "toolResult" && checks.has(m.toolCallId) && answerOf(m) !== null);
}

/**
 * The tutor reacted to an answer (or to something it had made) and stopped
 * without the next step. In the middle of teaching that is a stall, not a
 * pause for the student: LockedIn says "Carry on." for them, once per stop.
 * It waits instead when the tutor ended on a question of its own, when the
 * student had just said something, and when it has already been asked.
 */
export function tutorOwesNextStep(messages: readonly LhMessage[]): boolean {
	let said = "";
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i]!;
		if (m.role === "custom" && QUIET_MARKERS.includes(m.customType)) continue;
		if (m.role === "assistant") {
			if (m.stopReason === "error" || m.stopReason === "aborted") return false;
			// It asked its next question itself: nothing is owed.
			if (!said && m.content.some((b) => b.type === "toolCall" && (QUESTION_TOOLS as readonly string[]).includes(b.name))) return false;
			if (!said) said = m.content.flatMap((b) => (b.type === "text" ? [b.text] : sendToUserText(b) ? [sendToUserText(b)!] : [])).join("\n").trim();
			continue;
		}
		if (!said) return false;
		// What set this turn off.
		if (m.role === "toolResult" && !answerOf(m)) continue;
		if (/\?\s*$/.test(said)) return false;
		if (m.role === "toolResult") return true;
		return m.role === "custom" && (m.customType === "subagent-steer" || m.customType === "subagent-abort");
	}
	return false;
}

export interface LearnViewInput {
	messages: readonly LhMessage[];
	running: boolean;
	failure?: string;
	session: CompanionSession;
	lecture: Pick<Lecture, "id" | "title" | "module">;
	tree: PlanTree | null | undefined;
	now: Date;
}

/** LearnHarness chat record → the Learn screen's state. Never carries an open question's answer. */
export function mapLearnView(input: LearnViewInput): SessionView {
	const { messages, running, session, lecture, tree, now } = input;
	const learn = session.spec.learn ?? { scope: "lecture" as const, minutes: LEARN_RULES.defaultMinutes };
	const steps = learnSteps(messages);
	const step = [...steps.at(-1)!];
	const plan = learnPlan(tree, messages);
	const probed = hasProbeDone(messages as LhMessage[]);
	const phase = !probed ? ("probe" as const) : plan && plan.index > 0 ? ("teach" as const) : ("plan" as const);
	const pending = pendingQuestionOf(messages as LhMessage[]);
	const supported = !!pending && (QUESTION_TOOLS as readonly string[]).includes(pending.tool);
	const answered = steps.length - 1;
	const finished = !!tree && !!plan && plan.nodes.every((n) => n.state !== "todo") && currentChecked(tree, messages);
	const from = session.sittingFrom ?? session.openedAt;
	const endsAt = from ? new Date(new Date(from).getTime() + learn.minutes * 60_000) : null;

	if (pending && supported) {
		(session.asides ?? []).filter((a) => a.questionId === pending.toolCallId).forEach((a, i) => step.push({ type: "aside", id: `${pending.toolCallId}-${i}`, ask: a.ask, answer: a.answer }));
	}

	const cited = new Set<number>();
	for (const item of step) {
		if (item.type === "tutor") for (const n of parseSlideRefs(item.text)) cited.add(n);
		else if (item.type === "answered") for (const n of parseSlideRefs(item.explanation)) cited.add(n);
		else if (item.type === "aside") for (const n of parseSlideRefs(item.answer)) cited.add(n);
	}

	const base: SessionView = {
		id: session.id,
		engine: "learnharness",
		kind: session.spec.kind,
		mode: session.spec.mode,
		lecture: { id: lecture.id, title: lecture.title, module: lecture.module },
		goal: LEARN_COPY.goal(learn.minutes),
		status: "preparing",
		answered,
		budget: session.budget,
		canHint: false,
		slideRefs: [...cited].sort((a, b) => a - b),
		learn: {
			phase,
			step,
			earlier: steps.length - 1,
			...(plan ? { plan } : {}),
			minutes: learn.minutes,
			...(endsAt ? { endsAt: endsAt.toISOString() } : {}),
			timeUp: !!endsAt && now.getTime() >= endsAt.getTime(),
			finished,
		},
	};

	if (input.failure || session.state === "error") return { ...base, status: "error", error: session.error ?? input.failure ?? "engine_error" };
	if (session.state === "done") {
		return { ...base, status: "done", learn: { ...base.learn!, covered: (plan?.nodes ?? []).filter((n) => n.state !== "todo").map((n) => n.title) } };
	}
	const spoken = messages.some((m) => m.role === "assistant");
	// While the tutor is writing, no question is open: one still on the record was set aside by what the student just said.
	if (running) return spoken ? { ...base, status: "thinking", activity: LEARN_COPY.writing } : { ...base, status: "preparing", activity: LEARN_COPY.reading(lecture.module) };
	if (pending && supported) {
		const qd = questionDataFromCall(pending.toolCallId, pending.tool, pending.input);
		const canHint = qd.kind === "quiz" && sideSegmentId(messages as LhMessage[], pending.messageId) !== null;
		return { ...base, status: "question", question: toSessionQuestion(qd, pending.tool), canHint };
	}
	if (pending) return { ...base, status: "error", error: `unsupported_question:${pending.tool}` };

	if (!spoken) return session.state === "preparing" ? { ...base, status: "preparing", activity: LEARN_COPY.reading(lecture.module) } : { ...base, status: "error", error: "no_question" };
	// Nothing is running. If the newest thing in the lesson is the tutor's own words, it is waiting for the student.
	// Anything else (an answer, a message, a hand-over, something just made) means its next turn is about to start.
	const newest = [...messages].reverse().find((m) => !(m.role === "custom" && QUIET_MARKERS.includes(m.customType)));
	if (newest?.role === "assistant" && newest.stopReason !== "error" && newest.stopReason !== "aborted") return { ...base, status: "reply" };
	// A turn that never started (the app was closed mid-step) must not leave the student waiting: they can carry on.
	const age = typeof newest?.timestamp === "number" ? now.getTime() - newest.timestamp : 0;
	if (age > LEARN_RULES.stalledMs) return { ...base, status: "reply" };
	return { ...base, status: "thinking", activity: LEARN_COPY.writing };
}

// ─── a typed goal → topics in the module ────────────────────────────────────

export interface LearnTopic {
	lectureId: string;
	/** Set for an idea inside a lecture; unset for the lecture itself. */
	nodeId?: string;
	title: string;
	week: number;
}

const FILLER = new Set(["the", "and", "but", "for", "with", "from", "that", "this", "want", "need", "learn", "cover", "about", "have", "seen", "cant", "can", "not", "dont", "how", "what", "why", "its", "ive", "one", "find", "get", "just", "bit", "some", "more", "again", "really", "understand", "know", "did", "does", "any", "all", "you", "are", "was", "will"]);
const words = (s: string) => s.toLowerCase().replace(/['’]/g, "").split(/[^a-z0-9]+/).filter((w) => w.length >= 2);
const stem = (w: string) => w.replace(/(ies|es|s|y)$/, "");

function wordMatches(q: string, t: string): boolean {
	if (t.startsWith(q)) return true;
	const a = stem(q);
	return a.length >= 3 && a === stem(t);
}

/**
 * Topics in a module that a typed goal is about (the start sheet): the
 * student's words against lecture titles and idea titles. No AI and no wait.
 * Filler words never match by themselves; a lecture comes before its ideas
 * when they match equally well.
 */
export function matchTopics<T extends LearnTopic>(query: string, topics: readonly T[], limit: number = LEARN_RULES.suggestions): T[] {
	const q = words(query).filter((w) => !FILLER.has(w) && w.length >= 3);
	if (q.length === 0) return [];
	const scored = topics
		.map((t, i) => {
			const tw = words(t.title);
			return { t, i, score: q.filter((w) => tw.some((x) => wordMatches(w, x))).length };
		})
		.filter((x) => x.score > 0);
	scored.sort((a, b) => b.score - a.score || Number(!!a.t.nodeId) - Number(!!b.t.nodeId) || a.i - b.i);
	return scored.slice(0, limit).map((x) => x.t);
}

// ─── a demo the tutor built ─────────────────────────────────────────────────

/** Tells the page how tall the demo is, so its frame fits it. Runs inside the demo's own sandbox. */
const DEMO_SIZE_SCRIPT = `<script>(function(){var post=function(){try{parent.postMessage({type:"li-demo-height",height:Math.ceil(document.documentElement.scrollHeight)},"*")}catch(e){}};if(typeof ResizeObserver!=="undefined"){new ResizeObserver(post).observe(document.documentElement)}window.addEventListener("load",post);setTimeout(post,60);setTimeout(post,500)})();</script>`;

/**
 * The document for a demo's frame. The frame is sandboxed with scripts only:
 * no access to the app, its storage or the student's data.
 */
export function learnDemoDoc(html: string): string {
	return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, () => `${DEMO_SIZE_SCRIPT}</body>`) : `${html}${DEMO_SIZE_SCRIPT}`;
}

/** A demo's reported height, kept within sensible bounds; null for any other message. */
export function learnDemoHeight(data: unknown): number | null {
	const d = data as { type?: unknown; height?: unknown } | null;
	if (!d || d.type !== "li-demo-height" || typeof d.height !== "number" || !Number.isFinite(d.height) || d.height <= 0) return null;
	return Math.min(Math.max(Math.round(d.height), 120), 1_400);
}
