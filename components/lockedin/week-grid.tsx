"use client";

/**
 * The week as a timetable (v1.1, V-37): days across, hours down. Lectures,
 * classes and routine commitments sit at their real times and don't move.
 * Study blocks are drawn in their module's colour and can be dragged to any
 * free time or day; they snap to PLACEMENT_COPY.snapMinutes.
 *
 * A block can't be dropped on a lecture, a commitment, another block or
 * quiet hours: the block turns to the warning colour over such a place, goes
 * back when let go, and a line says why.
 * The same rule (`placementProblem`) runs on the server, so this is only
 * the fast answer, never the only check.
 *
 * Keyboard: a focused block moves with the arrow keys (a snap step, or a
 * day), Enter drops it, Escape puts it back.
 */

import { useRef, useState } from "react";
import { PLACEMENT_COPY, PLAN_COPY, placementProblem, type PlacementProblem } from "@/src/core";
import type { PlanData } from "./api";
import { Tint } from "./root";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const PX_PER_MIN = 1.1;
const SNAP = PLACEMENT_COPY.snapMinutes;

const mins = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (date: string, n: number) => {
	const d = new Date(`${date}T12:00:00`);
	d.setDate(d.getDate() + n);
	return isoDay(d);
};

type Block = PlanData["blocks"][number];
interface Pending { id: string; date: string; start: string }

export function WeekGrid({ plan, today, selected, onSelect, onMove }: {
	plan: PlanData;
	today: string;
	selected: string | null;
	onSelect: (id: string | null) => void;
	/** Move a block. Resolves to a problem to show (the server's own words), or null when it moved. */
	onMove: (id: string, to: { date: string; start: string }) => Promise<string | null>;
}) {
	const days = DAY_NAMES.map((name, i) => ({ name, date: addDays(plan.week, i) }));
	const grid = useRef<HTMLDivElement>(null);
	const drag = useRef<{ id: string; dy: number; x0: number; y0: number; moved: boolean } | null>(null);
	const [pending, setPending] = useState<Pending | null>(null);
	const [note, setNote] = useState<string | null>(null);

	// The hours shown: the waking day, stretched to fit anything outside it.
	const lectures = plan.lectures.filter((l) => l.start && l.end);
	const starts = [mins(plan.quietHours.to), ...lectures.map((l) => new Date(l.start!).getHours() * 60 + new Date(l.start!).getMinutes()), ...plan.blocks.map((b) => mins(b.start)), ...plan.commitments.map((c) => mins(c.start))];
	const sleep = mins(plan.quietHours.from) > mins(plan.quietHours.to) ? mins(plan.quietHours.from) : 24 * 60;
	const ends = [sleep, ...lectures.map((l) => new Date(l.end!).getHours() * 60 + new Date(l.end!).getMinutes()), ...plan.blocks.map((b) => mins(b.start) + b.minutes), ...plan.commitments.map((c) => mins(c.end))];
	const from = Math.floor(Math.min(...starts) / 60) * 60;
	const to = Math.min(24 * 60, Math.ceil(Math.max(...ends) / 60) * 60);
	const height = (to - from) * PX_PER_MIN;
	const hours = Array.from({ length: (to - from) / 60 + 1 }, (_, i) => from + i * 60);
	const top = (m: number) => (m - from) * PX_PER_MIN;

	const problemAt = (b: Block, at: { date: string; start: string }): PlacementProblem | null =>
		placementProblem({ block: { id: b.id, date: at.date, start: at.start, minutes: b.minutes }, lectures: plan.lectures, commitments: plan.commitments, blocks: plan.blocks as never, quietHours: plan.quietHours });

	const drop = async (b: Block, at: Pending) => {
		setPending(null);
		if (at.date === b.date && at.start === b.start) return;
		const problem = problemAt(b, at);
		if (problem) return setNote(PLACEMENT_COPY[problem]);
		setNote(await onMove(b.id, { date: at.date, start: at.start }));
	};

	/** Where the pointer is on the grid: the day's column, and the snapped start time for a block grabbed `dy` pixels from its top. */
	const pointAt = (clientX: number, clientY: number, dy: number, minutes: number): { date: string; start: string } | null => {
		const el = grid.current;
		if (!el) return null;
		const r = el.getBoundingClientRect();
		const col = Math.min(6, Math.max(0, Math.floor(((clientX - r.left) / r.width) * 7)));
		const raw = from + (clientY - r.top - dy) / PX_PER_MIN;
		const snapped = Math.min(to - minutes, Math.max(from, Math.round(raw / SNAP) * SNAP));
		return { date: days[col]!.date, start: hm(snapped) };
	};

	const movable = (b: Block) => b.status !== "started";

	return (
		<div className="li-tt" role="group" aria-label="This week's timetable">
			<div className="li-tt-head">
				<span />
				{days.map((d) => <b key={d.date} data-today={d.date === today ? "true" : "false"}>{d.name} <span className="li-muted li-small">{Number(d.date.slice(8))}</span></b>)}
			</div>
			<div className="li-tt-body" style={{ height }}>
				<div className="li-tt-hours" aria-hidden="true">
					{hours.map((h) => <span key={h} style={{ top: top(h) }}>{hm(h)}</span>)}
				</div>
				<div className="li-tt-days" ref={grid}>
					{hours.map((h) => <i key={h} className="li-tt-line" style={{ top: top(h) }} />)}
					{days.map((d, di) => (
						<div key={d.date} className="li-tt-day" data-today={d.date === today ? "true" : "false"} style={{ left: `${(di * 100) / 7}%` }}>
							{lectures.filter((l) => isoDay(new Date(l.start!)) === d.date).map((l) => {
								const s = new Date(l.start!);
								const e = new Date(l.end!);
								const a = s.getHours() * 60 + s.getMinutes();
								return (
									<Tint key={l.id} module={l.module} className="li-tt-item li-tt-fixed" style={{ top: top(a), height: Math.max(18, (e.getTime() - s.getTime()) / 60_000 * PX_PER_MIN - 2) }}>
										<b>{hm(a)} {l.module}</b>
										<span>{l.title}</span>
									</Tint>
								);
							})}
							{plan.commitments.filter((c) => c.weekdays.includes(di + 1)).map((c, i) => (
								<div key={`c${i}`} className="li-tt-item li-tt-commit" style={{ top: top(mins(c.start)), height: Math.max(18, (mins(c.end) - mins(c.start)) * PX_PER_MIN - 2) }}>
									<b>{c.start}</b>
									<span>{c.label}</span>
								</div>
							))}
						</div>
					))}
					{/* Study blocks sit in one layer over the days, not inside a day: a block keeps its element (and the pointer) while it is dragged across days. */}
					{plan.blocks.map((b) => {
						const at = pending?.id === b.id ? pending : { id: b.id, date: b.date, start: b.start };
						const col = Math.max(0, days.findIndex((x) => x.date === at.date));
						const moving = pending?.id === b.id;
						const problem = moving ? problemAt(b, at) : null;
						const label = b.module ? (plan.modules.find((m) => m.code === b.module)?.name ?? b.module) : PLACEMENT_COPY.freeStudy;
						return (
							<Tint
								key={b.id}
								module={b.module ?? "study"}
								className="li-tt-item li-tt-block"
								style={{ top: top(mins(at.start)), height: Math.max(22, b.minutes * PX_PER_MIN - 2), left: `calc(${(col * 100) / 7}% + 3px)`, right: "auto", width: `calc(${100 / 7}% - 6px)` }}
							>
								<div
									className="li-tt-grab"
									data-status={b.status}
									data-moving={moving ? "true" : "false"}
									data-ok={problem ? "false" : "true"}
									data-selected={selected === b.id ? "true" : "false"}
									role="button"
									tabIndex={0}
									aria-label={`Study block, ${label}, ${days.find((x) => x.date === at.date)?.name} ${at.start}, ${b.minutes} minutes${movable(b) ? ". Arrow keys move it, Enter drops it." : ", started"}`}
									onPointerDown={(e) => {
										if (!movable(b) || e.button !== 0) return;
										const r = e.currentTarget.getBoundingClientRect();
										drag.current = { id: b.id, dy: e.clientY - r.top, x0: e.clientX, y0: e.clientY, moved: false };
										e.currentTarget.setPointerCapture(e.pointerId);
									}}
									onPointerMove={(e) => {
										const g = drag.current;
										if (!g || g.id !== b.id) return;
										// A few pixels of slack, so a tap is a tap.
										if (!g.moved && Math.hypot(e.clientX - g.x0, e.clientY - g.y0) < 5) return;
										g.moved = true;
										const p = pointAt(e.clientX, e.clientY, g.dy, b.minutes);
										if (p) setPending({ id: b.id, ...p });
									}}
									onPointerUp={(e) => {
										const g = drag.current;
										drag.current = null;
										if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
										if (!g || g.id !== b.id) return;
										if (!g.moved) return onSelect(selected === b.id ? null : b.id);
										const p = pointAt(e.clientX, e.clientY, g.dy, b.minutes);
										void drop(b, { id: b.id, ...(p ?? { date: b.date, start: b.start }) });
									}}
									onPointerCancel={() => { drag.current = null; setPending(null); }}
									onKeyDown={(e) => {
										if (!movable(b)) return;
										const step = (dDay: number, dMin: number) => {
											e.preventDefault();
											const di2 = Math.min(6, Math.max(0, days.findIndex((x) => x.date === at.date) + dDay));
											const m = Math.min(to - b.minutes, Math.max(from, mins(at.start) + dMin));
											setPending({ id: b.id, date: days[di2]!.date, start: hm(m) });
											setNote(null);
										};
										if (e.key === "ArrowUp") step(0, -SNAP);
										else if (e.key === "ArrowDown") step(0, SNAP);
										else if (e.key === "ArrowLeft") step(-1, 0);
										else if (e.key === "ArrowRight") step(1, 0);
										else if (e.key === "Enter" || e.key === " ") {
											e.preventDefault();
											if (moving) void drop(b, at);
											else onSelect(selected === b.id ? null : b.id);
										} else if (e.key === "Escape") {
									if (moving) setPending(null);
									else onSelect(null);
								}
									}}
								>
									<b>{at.start} {label}</b>
									<span>{b.focus ? b.focus.title : b.module ? "" : `${b.minutes} min`}{b.status === "started" ? " · started ✓" : b.notStarted ? ` · ${PLAN_COPY.replan.notStarted}` : b.moved ? ` · ${PLAN_COPY.replan.moved}` : ""}</span>
								</div>
							</Tint>
						);
					})}
				</div>
			</div>
			<p className="li-small li-muted" role="status" aria-live="polite" style={{ margin: 0, minHeight: "1.4em" }}>
				{note ?? ""}
			</p>
		</div>
	);
}
