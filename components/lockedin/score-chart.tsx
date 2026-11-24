"use client";

/**
 * The learning score over time (v1.1, V-34), drawn by LockedIn as its own
 * SVG: your line, the straight steady-pace line, and a marker where a
 * milestone was earned. Tap, hover or arrow to a point to see what happened
 * then. The same figures are in a table for screen readers.
 *
 * The gap to the steady-pace line is never printed, and nothing here says
 * "behind": the line is a pace, not a verdict (v1.1-research.md, section 2).
 */

import { useId } from "react";
import { PROGRESS_COPY, type ScoreRange } from "@/src/core";
import type { ProgressPoint } from "./api";

const W = 820;
const H = 280;
const PAD = { top: 18, right: 18, bottom: 34, left: 46 };

/** A round number at or above `v` for the top of the scale: 155 → 200, 2,205 → 2,500. */
function niceCeil(v: number): number {
	if (v <= 0) return 100;
	const mag = 10 ** Math.floor(Math.log10(v));
	for (const step of [1, 2, 2.5, 5, 10]) if (step * mag >= v) return step * mag;
	return 10 * mag;
}

const dayOf = (iso: string) => new Date(`${iso}T12:00:00`);
function label(p: ProgressPoint, range: ScoreRange, i: number, n: number): string | null {
	const d = dayOf(p.date);
	if (range === "week") return d.toLocaleDateString("en-GB", { weekday: "short" });
	if (range === "month") return i % 5 === 4 || i === n - 1 ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : null;
	return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function pointTitle(p: ProgressPoint, range: ScoreRange): string {
	const from = dayOf(p.date);
	if (range !== "term") return from.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
	return `Week of ${from.toLocaleDateString("en-GB", { day: "numeric", month: "long" })}`;
}

export function ScoreChart({ points, range, selected, onSelect }: { points: ProgressPoint[]; range: ScoreRange; selected: number; onSelect: (i: number) => void }) {
	const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
	const n = points.length;
	const top = niceCeil(Math.max(...points.map((p) => Math.max(p.future ? 0 : p.score, p.pace ?? 0)), 1));
	const x = (i: number) => PAD.left + (n <= 1 ? 0 : (i * (W - PAD.left - PAD.right)) / (n - 1));
	const y = (v: number) => PAD.top + (1 - v / top) * (H - PAD.top - PAD.bottom);
	const past = points.map((p, i) => ({ p, i })).filter(({ p }) => !p.future);
	const line = past.map(({ p, i }) => `${x(i).toFixed(1)},${y(p.score).toFixed(1)}`).join(" ");
	const area = past.length ? `M${x(past[0]!.i).toFixed(1)},${y(0).toFixed(1)} L${line.replace(/ /g, " L")} L${x(past.at(-1)!.i).toFixed(1)},${y(0).toFixed(1)} Z` : "";
	const pace = points.filter((p) => p.pace !== null).length > 1 ? points.map((p, i) => (p.pace === null ? null : `${x(i).toFixed(1)},${y(p.pace).toFixed(1)}`)).filter(Boolean).join(" ") : "";
	const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(top * f));
	const move = (by: number) => onSelect(Math.min(n - 1, Math.max(0, selected + by)));

	return (
		<div className="li-chart">
			<svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label={`${PROGRESS_COPY.score}, ${PROGRESS_COPY.ranges[range].toLowerCase()}`} onKeyDown={(e) => { if (e.key === "ArrowLeft") { e.preventDefault(); move(-1); } else if (e.key === "ArrowRight") { e.preventDefault(); move(1); } }}>
				<defs>
					<linearGradient id={`fill-${uid}`} x1="0" x2="0" y1="0" y2="1">
						<stop offset="0" stopColor="var(--li-accent)" stopOpacity="0.28" />
						<stop offset="1" stopColor="var(--li-accent)" stopOpacity="0" />
					</linearGradient>
				</defs>
				{grid.map((v) => (
					<g key={v}>
						<line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} className="li-chart-grid" />
						<text x={PAD.left - 8} y={y(v) + 4} textAnchor="end" className="li-chart-axis">{v.toLocaleString("en-GB")}</text>
					</g>
				))}
				{points.map((p, i) => {
					const text = label(p, range, i, n);
					return text ? <text key={p.date} x={x(i)} y={H - 10} textAnchor="middle" className="li-chart-axis" data-on={i === selected ? "true" : "false"}>{text}</text> : null;
				})}
				{pace ? <polyline points={pace} className="li-chart-pace" /> : null}
				{area ? <path d={area} fill={`url(#fill-${uid})`} /> : null}
				{line ? <polyline points={line} className="li-chart-line" /> : null}
				{points.map((p, i) => {
					const cy = p.future ? (p.pace === null ? y(0) : y(p.pace)) : y(p.score);
					const here = i === selected;
					return (
						<g key={p.date} className="li-chart-point" data-on={here ? "true" : "false"} data-future={p.future ? "true" : "false"} role="button" tabIndex={here ? 0 : -1} aria-label={`${pointTitle(p, range)}: ${p.future ? "still to come" : `score ${p.score}`}`} aria-pressed={here} onClick={() => onSelect(i)} onMouseEnter={() => onSelect(i)} onFocus={() => onSelect(i)}>
							{/* A wide, invisible column so a point is easy to hit. */}
							<rect x={x(i) - Math.max(8, (W - PAD.left - PAD.right) / Math.max(1, n - 1) / 2)} y={PAD.top} width={Math.max(16, (W - PAD.left - PAD.right) / Math.max(1, n - 1))} height={H - PAD.top - PAD.bottom} fill="transparent" />
							{here ? <line x1={x(i)} x2={x(i)} y1={PAD.top} y2={H - PAD.bottom} className="li-chart-cursor" /> : null}
							{!p.future ? <circle cx={x(i)} cy={cy} r={here ? 6 : range === "month" ? 2.5 : 4} className="li-chart-dot" /> : here ? <circle cx={x(i)} cy={cy} r={4} className="li-chart-dot-future" /> : null}
							{p.milestones.length > 0 && !p.future ? <path d={`M${x(i)},${cy - 20} l6,6 l-6,6 l-6,-6 Z`} className="li-chart-milestone" /> : null}
						</g>
					);
				})}
			</svg>
			<table className="li-sr">
				<caption>{PROGRESS_COPY.score}, {PROGRESS_COPY.ranges[range].toLowerCase()}</caption>
				<thead><tr><th>When</th><th>Score</th><th>{PROGRESS_COPY.steadyPace}</th><th>Earned</th></tr></thead>
				<tbody>
					{points.map((p) => <tr key={p.date}><td>{pointTitle(p, range)}</td><td>{p.future ? "still to come" : p.score}</td><td>{p.pace ?? ""}</td><td>{p.future ? "" : p.gained}</td></tr>)}
				</tbody>
			</table>
		</div>
	);
}
