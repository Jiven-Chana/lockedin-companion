"use client";

/**
 * A Learn session's plan (V-47; v3.0, V-33): drawn by LockedIn from the
 * tutor's data as a column of blocks, each done (a tick), the one you are
 * on (its mark, and "now"), or still to come (its number, in a solid quiet
 * outline: v3.0.1). State is a mark and a word, never colour alone.
 */

import type { LearnPlanView } from "@/src/core";
import { Icon } from "./icons";

const WORD = { done: "done", current: "now", todo: "" } as const;

export function LearnPlan({ plan }: { plan: LearnPlanView }) {
	return (
		<ol className="li-plan" aria-label="The plan for this session">
			{plan.nodes.map((n, i) => (
				<li key={n.id} data-state={n.state} aria-current={n.state === "current" ? "step" : undefined}>
					<span className="li-plan-mark" aria-hidden="true">{n.state === "done" ? <Icon.check /> : n.state === "current" ? <Icon.pick /> : i + 1}</span>
					<span className="li-plan-title">{n.title}</span>
					{WORD[n.state] ? <span className="li-plan-word">{WORD[n.state]}</span> : null}
				</li>
			))}
		</ol>
	);
}
