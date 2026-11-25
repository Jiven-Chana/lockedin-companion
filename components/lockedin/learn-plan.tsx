"use client";

/**
 * A Learn session's plan (V-47; V-33: drawn by LockedIn from the tutor's
 * data): the ideas in order, each done, current or still to come. State is
 * carried by a mark and a word, never by colour alone.
 */

import type { LearnPlanView } from "@/src/core";

const MARK = { done: "✓", current: "●", todo: "" } as const;
const WORD = { done: "done", current: "now", todo: "" } as const;

export function LearnPlan({ plan }: { plan: LearnPlanView }) {
	return (
		<ol className="li-plan" aria-label="The plan for this session">
			{plan.nodes.map((n) => (
				<li key={n.id} data-state={n.state} aria-current={n.state === "current" ? "step" : undefined}>
					<span className="li-plan-mark" aria-hidden="true">{MARK[n.state]}</span>
					<span className="li-plan-title">{n.title}</span>
					{WORD[n.state] ? <span className="li-plan-word">{WORD[n.state]}</span> : null}
				</li>
			))}
		</ol>
	);
}
