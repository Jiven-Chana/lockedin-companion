/**
 * Practise (v2.0, V-40): which questions a round asks.
 *
 * A round is drawn from a module's question banks, not one lecture in order:
 *  - mixed across ideas: one question per idea before any idea gets a second;
 *  - weighted to gaps: ideas with a gap or fading come first, up to
 *    PRACTISE_RULES.gapShare of the round, so a round is never only repair;
 *  - the rest go to the ideas asked least recently, so every idea comes round;
 *  - within an idea, the question asked least often comes first, so a
 *    question is not repeated until the others on its idea have been used;
 *  - mixed difficulty: where an idea offers a choice between questions its
 *    history can't tell apart, the difficulty the round has least of is
 *    taken; the round is then asked easiest first.
 *
 * Pure and deterministic: the same history gives the same round.
 * Mixing topics is supported by Brunmair & Richter 2019 (v1.1-research.md);
 * weighting to confident errors by LIT-27; the easy start by LIT-13, LIT-14.
 */

import { PRACTISE_RULES } from "./policy.ts";
import type { BankQuestion } from "./study-pack.ts";

/** A bank question, with the unit it belongs to. */
export interface PractiseCandidate {
	lectureId: string;
	question: BankQuestion;
}

/** Where an idea stands, for the weighting. */
export type IdeaStanding = "gap" | "fading" | "new" | "ok";

export interface PractiseInput {
	candidates: readonly PractiseCandidate[];
	/** How often, and when last (ms), each question id has been asked. */
	asked: ReadonlyMap<string, { times: number; last: number }>;
	/** Standing by idea key (`lectureId#node`); an idea not listed is "new". */
	standing: ReadonlyMap<string, IdeaStanding>;
	/** How many questions to choose. */
	n: number;
	/** Question ids not to choose (already in this session). */
	exclude?: ReadonlySet<string>;
}

export const ideaKeyOf = (c: PractiseCandidate) => `${c.lectureId}#${c.question.node}`;

interface Idea {
	key: string;
	standing: IdeaStanding;
	/** When the idea was last asked about (ms); never = -Infinity. */
	last: number;
	/** Its questions still available, least asked first. */
	queue: PractiseCandidate[];
}

const NEVER = Number.NEGATIVE_INFINITY;

export function pickPractise(input: PractiseInput): PractiseCandidate[] {
	const n = Math.max(0, Math.floor(input.n));
	const timesOf = (c: PractiseCandidate) => input.asked.get(c.question.id)?.times ?? 0;
	const lastOf = (c: PractiseCandidate) => input.asked.get(c.question.id)?.last ?? NEVER;

	const ideas = new Map<string, Idea>();
	for (const c of input.candidates) {
		const key = ideaKeyOf(c);
		const idea = ideas.get(key) ?? { key, standing: input.standing.get(key) ?? "new", last: NEVER, queue: [] };
		idea.last = Math.max(idea.last, lastOf(c));
		if (!input.exclude?.has(c.question.id)) idea.queue.push(c);
		ideas.set(key, idea);
	}
	for (const idea of ideas.values()) {
		idea.queue.sort((a, b) => timesOf(a) - timesOf(b) || lastOf(a) - lastOf(b) || a.question.difficulty - b.question.difficulty || a.question.id.localeCompare(b.question.id));
	}

	// Least recently asked first; never asked comes before everything. Ties by key, so the order is stable.
	const byRecency = (a: Idea, b: Idea) => (a.last === b.last ? 0 : a.last < b.last ? -1 : 1) || a.key.localeCompare(b.key);
	const rank: Record<IdeaStanding, number> = { gap: 0, fading: 1, new: 2, ok: 3 };
	const all = [...ideas.values()].filter((i) => i.queue.length > 0);
	const repair = all.filter((i) => i.standing === "gap" || i.standing === "fading").sort((a, b) => rank[a.standing] - rank[b.standing] || byRecency(a, b));
	const rest = all.filter((i) => i.standing !== "gap" && i.standing !== "fading").sort(byRecency);

	const picked: PractiseCandidate[] = [];
	const perDifficulty: Record<number, number> = { 1: 0, 2: 0, 3: 0 };
	/**
	 * Take an idea's next question: the one asked least often, and of those the
	 * one asked longest ago. Where history can't tell them apart (never asked),
	 * the difficulty the round has least of.
	 */
	const take = (idea: Idea) => {
		const first = idea.queue[0]!;
		const tied = idea.queue.filter((c) => timesOf(c) === timesOf(first) && lastOf(c) === lastOf(first));
		const choice = tied.reduce((best, c) => {
			const d = perDifficulty[c.question.difficulty]! - perDifficulty[best.question.difficulty]!;
			return d < 0 || (d === 0 && c.question.difficulty < best.question.difficulty) ? c : best;
		});
		idea.queue.splice(idea.queue.indexOf(choice), 1);
		perDifficulty[choice.question.difficulty] = (perDifficulty[choice.question.difficulty] ?? 0) + 1;
		picked.push(choice);
	};

	// One pass gives each idea at most one question; further passes only run when there are fewer ideas than questions.
	const repairSlots = Math.ceil(n * PRACTISE_RULES.gapShare);
	for (let pass = 0; picked.length < n && all.some((i) => i.queue.length > 0); pass++) {
		const fromRepair = repair.filter((i) => i.queue.length > 0);
		const fromRest = rest.filter((i) => i.queue.length > 0);
		const quota = pass === 0 ? Math.min(repairSlots, fromRepair.length) : fromRepair.length;
		const order = [...fromRepair.slice(0, quota), ...fromRest, ...fromRepair.slice(quota)];
		for (const idea of order) {
			if (picked.length >= n) break;
			take(idea);
		}
	}

	// Asked easiest first (the first step should feel good); otherwise in the order chosen.
	return picked.map((c, i) => ({ c, i })).sort((a, b) => a.c.question.difficulty - b.c.question.difficulty || a.i - b.i).map((x) => x.c);
}
