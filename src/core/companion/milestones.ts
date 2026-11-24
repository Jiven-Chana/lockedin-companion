/**
 * Milestones and "needs attention" (v1.1, V-35, V-36). Pure, on top of the
 * score's replay.
 *
 * A milestone is earned at a moment in the student's real history. The
 * server keeps the first date each was earned, so one earned is never lost,
 * whatever changes afterwards.
 *
 * "Needs attention" names gaps, each of which the page pairs with one
 * action: the module done least on, ideas that are fading, and modules with
 * no material. It speaks about modules and ideas, never about the student.
 */

import { SCORE_RULES, type MilestoneId } from "./policy.ts";
import { fadingAt, moduleShares, type PackIdea, type ScoreReplay } from "./score.ts";
import { addDays, startOfWeek } from "./time.ts";
import type { EventLogEntry, StudyBlock } from "./types.ts";

export interface MilestoneInput {
	replay: ScoreReplay;
	events: readonly EventLogEntry[];
	blocks: readonly StudyBlock[];
	ideas: readonly PackIdea[];
	/** Every module the student has, and whether it has material. */
	modules: readonly { code: string; hasMaterial: boolean }[];
	now: Date;
}

const weekKey = (d: Date) => startOfWeek(d).getTime();

/** The milestones this history has earned, and when. */
export function earnedMilestones(input: MilestoneInput): Partial<Record<MilestoneId, Date>> {
	const out: Partial<Record<MilestoneId, Date>> = {};
	const earn = (id: MilestoneId, at: Date | null | undefined) => {
		if (at && !out[id]) out[id] = at;
	};
	const { replay, now } = input;

	// Learning
	// An idea is secured the first time it is got right, whether or not it had been got wrong before.
	const secured = [...replay.ideas.values()].map((i) => i.securedAt).filter((d): d is Date => d !== null).sort((a, b) => a.getTime() - b.getTime());
	earn("first-idea", secured[0]);
	earn("ideas-10", secured[9]);
	earn("ideas-25", secured[24]);
	earn("ideas-50", secured[49]);
	const comebacks = replay.moments.filter((m) => m.cameBack);
	earn("came-back", comebacks[0]?.at);
	earn("comebacks-10", comebacks[9]?.at);
	const byUnit = new Map<string, PackIdea[]>();
	for (const i of input.ideas) byUnit.set(i.lectureId, [...(byUnit.get(i.lectureId) ?? []), i]);
	const unitDates = [...byUnit].map(([lectureId, list]) => {
		const dates = list.map((i) => replay.ideas.get(`${lectureId}#${i.nodeId}`)?.securedAt ?? null);
		return dates.every((d): d is Date => d !== null) && dates.length > 0 ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null;
	});
	earn("unit-secured", unitDates.filter((d): d is Date => d !== null).sort((a, b) => a.getTime() - b.getTime())[0]);

	// Discipline
	earn("first-block", replay.moments.find((m) => m.kind === "block")?.at);
	// A week is "kept" once it is over and every block accepted in it was started. Only finished weeks count, so one earned can't be undone by a block added later.
	const weeks = new Map<number, StudyBlock[]>();
	for (const b of input.blocks) {
		if (b.status !== "accepted" && b.status !== "started") continue;
		const k = weekKey(new Date(`${b.date}T12:00:00`));
		weeks.set(k, [...(weeks.get(k) ?? []), b]);
	}
	const kept = [...weeks]
		.filter(([k, list]) => addDays(new Date(k), 7) <= now && list.every((b) => b.status === "started" && b.startedAt))
		.map(([, list]) => new Date(Math.max(...list.map((b) => new Date(b.startedAt!).getTime()))))
		.sort((a, b) => a.getTime() - b.getTime());
	earn("full-week", kept[0]);
	earn("full-weeks-3", kept[2]);
	const checkin = input.events.find((e) => e.type === "checkin_answered");
	earn("first-checkin", checkin ? new Date(checkin.t) : null);
	earn("first-phone", replay.moments.find((m) => m.source === "phone")?.at);

	// Well-rounded
	const withMaterial = input.modules.filter((m) => m.hasMaterial).map((m) => m.code);
	const seen = new Map<number, Set<string>>();
	for (const m of replay.moments) {
		if (m.points <= 0 || !m.module) continue;
		const k = weekKey(m.at);
		const set = seen.get(k) ?? new Set<string>();
		seen.set(k, set);
		set.add(m.module);
		if (set.size >= 2) earn("two-modules", m.at);
		if (withMaterial.length >= 2 && withMaterial.every((c) => set.has(c))) earn("all-modules", m.at);
	}
	if (input.modules.length >= 2 && input.modules.every((m) => m.hasMaterial)) {
		// The save that covered the last module, when the log shows it; today otherwise.
		const covered = new Set<string>();
		let at: Date | null = null;
		for (const e of input.events) {
			if (e.type !== "materials_saved" || typeof e.data.module !== "string") continue;
			covered.add(e.data.module);
			if (input.modules.every((m) => covered.has(m.code))) {
				at = new Date(e.t);
				break;
			}
		}
		earn("all-material", at ?? now);
	}
	return out;
}

export type AttentionItem =
	| { kind: "module"; module: string; /** Days since anything was scored there; null when nothing ever was. Undefined when it has had some, just the least. */ daysSince?: number | null }
	| { kind: "fading"; module: string; lectureId: string; nodes: string[]; count: number }
	| { kind: "material"; modules: string[] };

export interface AttentionInput {
	replay: ScoreReplay;
	modules: readonly { code: string; hasMaterial: boolean }[];
	now: Date;
}

/**
 * At most one of each: the module done least on in the last
 * SCORE_RULES.attentionDays (among those with material), the unit with the
 * most ideas fading, and the modules with no material at all.
 */
export function needsAttention(input: AttentionInput): AttentionItem[] {
	const { replay, now } = input;
	const out: AttentionItem[] = [];
	const withMaterial = input.modules.filter((m) => m.hasMaterial).map((m) => m.code);
	const shares = moduleShares(replay, withMaterial, addDays(now, -SCORE_RULES.attentionDays), new Date(now.getTime() + 1));
	if (shares.length > 0) {
		const since = (d: Date | null) => (d ? now.getTime() - d.getTime() : Number.POSITIVE_INFINITY);
		const least = [...shares].sort((a, b) => a.points - b.points || since(b.lastActivity) - since(a.lastActivity))[0]!;
		const mean = shares.reduce((n, s) => n + s.points, 0) / shares.length;
		if (least.points === 0) out.push({ kind: "module", module: least.module, daysSince: least.lastActivity ? Math.floor(since(least.lastActivity) / 86_400_000) : null });
		else if (shares.length >= 2 && least.points < mean / 2) out.push({ kind: "module", module: least.module });
	}
	const fading = fadingAt(replay, now)
		.map((key) => replay.ideas.get(key))
		.filter((i): i is NonNullable<typeof i> => !!i);
	if (fading.length > 0) {
		const byUnit = new Map<string, typeof fading>();
		for (const i of fading) byUnit.set(i.lectureId, [...(byUnit.get(i.lectureId) ?? []), i]);
		const [lectureId, list] = [...byUnit].sort((a, b) => b[1].length - a[1].length)[0]!;
		const module = list[0]!.module;
		out.push({ kind: "fading", module, lectureId, nodes: list.map((i) => i.nodeId).filter((n) => n !== "(general)"), count: fading.filter((i) => i.module === module).length });
	}
	const none = input.modules.filter((m) => !m.hasMaterial).map((m) => m.code);
	if (none.length > 0) out.push({ kind: "material", modules: none });
	return out;
}
