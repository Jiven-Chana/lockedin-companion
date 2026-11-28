"use client";

/**
 * A Learn session's plan (V-47; v3.0, V-33): drawn by LockedIn from the
 * tutor's data as a column of blocks, each done (a tick), the one you are
 * on (its mark, and "now"), or still to come (its number, in a solid quiet
 * outline: v3.0.1). State is a mark and a word, never colour alone.
 *
 * One plan (v3.1.1): what the opening check found is on each step (Solid,
 * Shaky, Not yet, Not checked), with a way to change it. There is no second
 * list of the same ideas.
 */

import { useState } from "react";
import { LEARN_COPY, planWithLevels, type LearnPlanView, type LearnWhere, type WhereLevel } from "@/src/core";
import { Icon } from "./icons";

const WORD = { done: "done", current: "now", todo: "" } as const;
const PICK = ["solid", "shaky", "notyet"] as const;

export function LearnPlan({ plan, where, onCorrect, busy }: { plan: LearnPlanView; where?: LearnWhere[] | null; onCorrect?: (title: string, level: (typeof PICK)[number]) => void; busy?: boolean }) {
	const [open, setOpen] = useState<string | null>(null);
	const { steps, have, also } = planWithLevels(plan, where);
	// With the check skipped nothing was found: a "Not checked" on every step would only be noise.
	const checked = (where ?? []).some((w) => w.level !== "unchecked");
	return (
		<div className="li-stack" style={{ gap: 10 }}>
			{where?.length && !checked ? <span className="li-small li-muted">{LEARN_COPY.where.skipped}</span> : null}
			{have.length ? <span className="li-small li-row" style={{ gap: 6, flexWrap: "nowrap", alignItems: "flex-start" }}><span className="li-plan-level" data-level="solid">{LEARN_COPY.where.levels.solid}</span><span>{LEARN_COPY.have(have.map((h) => h.title))}</span></span> : null}
			<ol className="li-plan" aria-label={LEARN_COPY.planTitle}>
				{steps.map((n, i) => (
					<li key={n.id} data-state={n.state} aria-current={n.state === "current" ? "step" : undefined}>
						<span className="li-plan-mark" aria-hidden="true">{n.state === "done" ? <Icon.check /> : n.state === "current" ? <Icon.pick /> : i + 1}</span>
						<span className="li-plan-main">
							<span className="li-plan-title">{n.title}</span>
							{n.note && n.state === "todo" ? <span className="li-small li-plan-note">{n.note}</span> : null}
						</span>
						{WORD[n.state] ? <span className="li-plan-word">{WORD[n.state]}</span> : null}
						{n.level && (checked || n.corrected) && n.state !== "done" ? <span className="li-plan-level" data-level={n.level}>{LEARN_COPY.where.levels[n.level]}</span> : null}
						{onCorrect && n.state !== "done" ? <button type="button" className="li-link li-small" aria-expanded={open === n.id} disabled={busy} onClick={() => setOpen(open === n.id ? null : n.id)}>{LEARN_COPY.where.change}</button> : null}
						{open === n.id && onCorrect ? (
							<span className="li-seg li-plan-pick" role="group" aria-label={`${n.title}: ${LEARN_COPY.where.change}`}>
								{PICK.map((l) => <button key={l} type="button" aria-pressed={n.level === l} disabled={busy} onClick={() => { setOpen(null); if (n.level !== l) onCorrect(n.checked ?? n.title, l); }}>{LEARN_COPY.where.levels[l as WhereLevel]}</button>)}
							</span>
						) : null}
					</li>
				))}
			</ol>
			{also.length ? (
				<span className="li-small li-row" style={{ gap: 6 }}>
					{LEARN_COPY.alsoChecked}
					{also.map((w) => <span key={w.title} className="li-plan-level" data-level={w.level} title={w.note}>{w.title} · {LEARN_COPY.where.levels[w.level]}</span>)}
				</span>
			) : null}
		</div>
	);
}
