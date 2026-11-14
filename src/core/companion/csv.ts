/** Event log → CSV for T23 analysis (plan §12.3). One row per event; `data` is JSON. */

import type { EventLogEntry } from "./types.ts";

function cell(value: unknown): string {
	const s = value === undefined || value === null ? "" : typeof value === "string" ? value : JSON.stringify(value);
	return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function eventsToCsv(events: EventLogEntry[]): string {
	const rows = [["t", "wall", "participant", "type", "data"]];
	for (const e of events) rows.push([e.t, e.wall, e.participant ?? "", e.type, JSON.stringify(e.data ?? {})]);
	return `${rows.map((r) => r.map(cell).join(",")).join("\n")}\n`;
}
