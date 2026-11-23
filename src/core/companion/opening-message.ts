/**
 * The structured first message of every companion session (plan Appendix B).
 * The prompt overrides (companion/seed/prompts) rely on this exact
 * structure: keep the field names and order stable, and change the
 * overrides in the same PR if you change them.
 */

import { PREPARE_RULES, TEACHER_RULES } from "./policy.ts";
import { trimSlides } from "./slides.ts";
import { formatHM, relativeDay } from "./time.ts";
import type { Lecture, Miss, SessionSpec } from "./types.ts";

export interface OpeningMessageInput {
	spec: SessionSpec;
	lecture: Lecture;
	/** Module display name; falls back to the code. */
	moduleName?: string;
	slidesMarkdown: string;
	/** Retests: the misses being revisited, in order. */
	misses?: Miss[];
	now: Date;
	slideTokenBudget?: number;
	/** The lecture's concept map (mermaid graph TD); the teacher plans on its node slugs. */
	conceptMap?: string;
}

const GOALS: Record<SessionSpec["kind"], string> = {
	"post-lecture": "help me recall and use the main ideas from this lecture.",
	block: "help me recall and use the main ideas from this lecture.",
	"try-now": "help me recall and use the main ideas from this lecture.",
	"missed-lecture": "learn the main ideas of a lecture I missed, one short piece at a time.",
	retest: "revisit the ideas I got wrong or was unsure about.",
};

function budgetLine(spec: SessionSpec): string {
	const { questions, minutes, parts } = spec.budget;
	if (spec.kind === "missed-lecture" && parts) {
		const perPart = Math.max(1, Math.round(questions / parts));
		const minutesPerPart = Math.max(1, Math.round(minutes / parts));
		return `${parts} parts. Each part: one short worked example, then ${perPart} questions, about ${minutesPerPart} minutes. I may stop after any part.`;
	}
	return `${questions} questions, about ${minutes} minutes.`;
}

function lectureLine(lecture: Lecture, kind: SessionSpec["kind"], now: Date): string {
	const week = lecture.week > 0 ? ` (week ${lecture.week})` : "";
	const missed = kind === "missed-lecture" ? " (I missed it)" : "";
	// A course unit made from material has no time (V-18).
	if (!lecture.start || !lecture.end) return `${lecture.title}${week}${missed}`;
	const end = new Date(lecture.end);
	const when = end <= now ? `ended ${formatHM(end)} ${relativeDay(end, now)}` : `on ${relativeDay(new Date(lecture.start), now).replace(/^on /, "")}`;
	return `${lecture.title}${week}, ${when}${missed}`;
}

function revisitBlock(misses: Miss[] | undefined): string[] {
	if (!misses || misses.length === 0) return ["Revisit: none."];
	const lines = ["Revisit:"];
	misses.forEach((m, i) => {
		const why = m.explanation ? ` | Why: ${m.explanation.replace(/\s+/g, " ").trim()}` : "";
		lines.push(`${i + 1}. Q: ${m.questionText.replace(/\s+/g, " ").trim()} | Answer: ${m.correctLabels.join("; ") || "(see explanation)"}${why}`);
	});
	lines.push("Ask fresh questions on these ideas, in the order listed. Never reuse the wording.");
	return lines;
}

export function buildOpeningMessage(input: OpeningMessageInput): { text: string; slidesTrimmed: boolean } {
	const { spec, lecture, now } = input;
	const slides = trimSlides(input.slidesMarkdown, input.slideTokenBudget ?? PREPARE_RULES.slideTokenBudget);
	const lines = [
		"APP SESSION",
		`Kind: ${spec.kind}`,
		`Module: ${input.moduleName ? `${lecture.module} (${input.moduleName})` : lecture.module}`,
		`Lecture: ${lectureLine(lecture, spec.kind, now)}`,
		`Goal: ${GOALS[spec.kind]}`,
		`Budget: ${budgetLine(spec)}`,
		`Mode: ${spec.mode === "show-first" ? "show me first" : "question me first"}.`,
		TEACHER_RULES.noRepliesLine,
		...(spec.nodes?.length ? [`Focus: only the concept-map ideas ${spec.nodes.join(", ")}. Ask only about them and the slides that teach them.`] : []),
		...(spec.seedAnswer
			? [`Already answered on the phone (question 1 of ${spec.budget.questions}): "${spec.seedAnswer.stem ?? spec.seedAnswer.questionId}" → "${spec.seedAnswer.choiceLabel ?? `option ${spec.seedAnswer.choice + 1}`}" (${spec.seedAnswer.correct ? "correct" : "not correct"}). Don't ask it again${spec.seedAnswer.correct ? "" : "; repair it briefly first"}, then continue with question 2.`]
			: []),
		...revisitBlock(spec.kind === "retest" ? input.misses : undefined),
		...(input.conceptMap?.trim()
			? ["", "CONCEPT MAP (plan on these node slugs)", "```mermaid", input.conceptMap.trim(), "```"]
			: []),
		"",
		'SLIDES (cite as "(Slide n)")',
		slides.markdown.trim(),
	];
	return { text: `${lines.join("\n")}\n`, slidesTrimmed: slides.trimmed };
}
