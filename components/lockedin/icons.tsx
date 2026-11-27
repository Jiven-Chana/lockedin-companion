/**
 * LockedIn's pictograms in the Blocks look (v3.0): filled and rounded, and
 * always shown beside a word. Decorative unless given a label. They take
 * the colour of the text they sit in; none writes a colour of its own.
 */

import type { ModuleShape } from "@/src/core";
import { useLockedInOptional } from "./root";

const box = { width: 20, height: 20, viewBox: "0 0 24 24", "aria-hidden": true };
/** Filled shapes. */
const f = { ...box, fill: "currentColor", stroke: "none" };
/** Thick rounded lines, for shapes that are lines (an arrow, a tick). */
const s = { ...box, fill: "none", stroke: "currentColor", strokeWidth: 2.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export const Icon = {
	today: () => <svg {...s} strokeWidth={2.4}><circle cx="12" cy="12" r="4.4" fill="currentColor" stroke="none" /><path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.5 1.5M17.1 17.1l1.5 1.5M5.4 18.6l1.5-1.5M17.1 6.9l1.5-1.5" /></svg>,
	library: () => <svg {...f}><rect x="3.5" y="4" width="4.6" height="16" rx="1.4" /><rect x="9.7" y="4" width="4.6" height="16" rx="1.4" /><rect x="15.9" y="7.5" width="4.6" height="12.5" rx="1.4" /></svg>,
	calendar: () => <svg {...f} fillRule="evenodd"><path d="M7 2.5a1.2 1.2 0 0 1 2.4 0V4h5.2V2.5a1.2 1.2 0 0 1 2.4 0V4H19a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2zM8.2 11.3a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2zm7.6 0a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2z" /></svg>,
	progress: () => <svg {...f}><rect x="3.5" y="12" width="4.4" height="8.5" rx="1.4" /><rect x="9.8" y="8" width="4.4" height="12.5" rx="1.4" /><rect x="16.1" y="3.5" width="4.4" height="17" rx="1.4" /></svg>,
	me: () => <svg {...f}><circle cx="12" cy="7.6" r="4.1" /><path d="M3.8 20.5c0-4.3 3.7-7 8.2-7s8.2 2.7 8.2 7z" /></svg>,
	bell: () => <svg {...f} width={18} height={18}><path d="M6 9.5a6 6 0 0 1 12 0c0 5 2 6.5 2 6.5H4s2-1.5 2-6.5z" /><path d="M9.6 18.5h4.8a2.4 2.4 0 0 1-4.8 0z" /></svg>,
	link: () => <svg {...s} strokeWidth={2.4}><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></svg>,
	upload: () => <svg {...s}><path d="M4 16v3a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 19v-3M17 8.5l-5-5-5 5M12 3.5v12" /></svg>,
	check: () => <svg {...s} width={18} height={18} strokeWidth={3.2}><path d="M4.5 12.5l4.8 4.8L19.5 7" /></svg>,
	half: () => <svg {...s} width={18} height={18} strokeWidth={2.4}><circle cx="12" cy="12" r="8" /><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" /></svg>,
	ring: () => <svg {...s} width={18} height={18} strokeWidth={2.6}><path d="M19 12a7 7 0 1 1-2.2-5.1M19 4.2v4h-4" /></svg>,
	dot: () => <svg {...s} width={18} height={18} strokeWidth={2.4}><circle cx="12" cy="12" r="7.5" strokeDasharray="3.4 3" /></svg>,
	play: () => <svg {...f}><path d="M7 4.2c0-.9 1-1.5 1.8-1l11.5 7.8c.7.5.7 1.5 0 2L8.8 20.8c-.8.5-1.8-.1-1.8-1z" /></svg>,
	demo: () => <svg {...s} strokeWidth={2.6}><circle cx="12" cy="12" r="8.6" /><path d="M12 7.4V12l3 2" /></svg>,
	search: () => <svg {...s}><circle cx="11" cy="11" r="6.6" /><path d="m20.5 20.5-4.6-4.6" /></svg>,
	// ── added with the Blocks look ──
	arrow: () => <svg {...s}><path d="M4.5 12h14M13 6.2l6 5.8-6 5.8" /></svg>,
	up: () => <svg {...s}><path d="M12 19.5V5M6 10.5l6-6 6 6" /></svg>,
	chevron: () => <svg {...s}><path d="M6 9.5l6 6 6-6" /></svg>,
	close: () => <svg {...s}><path d="M6 6l12 12M18 6L6 18" /></svg>,
	plus: () => <svg {...s}><path d="M12 5v14M5 12h14" /></svg>,
	pick: () => <svg {...s} strokeWidth={2.6}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none" /></svg>,
	time: () => <svg {...f} fillRule="evenodd"><path d="M12 2.5a9.5 9.5 0 1 1 0 19 9.5 9.5 0 0 1 0-19zm0 4.2a1.3 1.3 0 0 0-1.3 1.3v4.3c0 .4.2.8.5 1l3 2.2a1.3 1.3 0 0 0 1.6-2.1l-2.5-1.8V8A1.3 1.3 0 0 0 12 6.7z" /></svg>,
	learn: () => <svg {...f}><path d="M2.5 5.6c3-1.1 6-1 8.3.7v13.2c-2.3-1.5-5.3-1.7-8.3-.6zM13.2 6.3c2.3-1.7 5.3-1.8 8.3-.7v13.3c-3-1.1-6-.9-8.3.6z" /></svg>,
	practise: () => <svg {...f}><path d="M3.5 20.5l1.2-5.2L15.6 4.4a2.1 2.1 0 0 1 3 0l1 1a2.1 2.1 0 0 1 0 3L8.7 19.3z" /></svg>,
	pause: () => <svg {...f}><rect x="5.8" y="4.5" width="4.6" height="15" rx="1.4" /><rect x="13.6" y="4.5" width="4.6" height="15" rx="1.4" /></svg>,
	slide: () => <svg {...f}><path d="M4.5 3.5h15A1.5 1.5 0 0 1 21 5v9.5a1.5 1.5 0 0 1-1.5 1.5h-6.2v2.6h3a1.2 1.2 0 0 1 0 2.4H7.7a1.2 1.2 0 0 1 0-2.4h3V16H4.5A1.5 1.5 0 0 1 3 14.500V5a1.5 1.5 0 0 1 1.5-1.5z" /></svg>,
	plan: () => <svg {...f}><circle cx="5" cy="6" r="1.8" /><circle cx="5" cy="12" r="1.8" /><circle cx="5" cy="18" r="1.8" /><rect x="9" y="4.7" width="12" height="2.6" rx="1.3" /><rect x="9" y="10.7" width="12" height="2.6" rx="1.3" /><rect x="9" y="16.7" width="12" height="2.6" rx="1.3" /></svg>,
	send: () => <svg {...f}><path d="M3.2 10.9L20 3.4c.6-.3 1.2.3 1 .9l-6 16.300c-.2.6-1.1.7-1.400.1l-3-6.300-6.300-2.300c-.7-.2-.7-1.200-.1-1.500z" /></svg>,
	say: () => <svg {...f}><path d="M4.5 4.5h15A1.5 1.5 0 0 1 21 6v9a1.5 1.5 0 0 1-1.5 1.5h-7.300L7.800 20.200c-.5.4-1.300 0-1.300-.6V16.500h-2A1.5 1.5 0 0 1 3 15V6a1.5 1.5 0 0 1 1.5-1.5z" /></svg>,
	ai: () => <svg {...f}><path d="M12 2.5l2.3 7.2 7.2 2.3-7.2 2.3L12 21.5l-2.3-7.2L2.5 12l7.2-2.3z" /></svg>,
	question: () => <svg {...s}><path d="M8.300 9a3.700 3.700 0 1 1 5.500 3.200c-1.100.6-1.800 1.400-1.800 2.700" /><circle cx="12" cy="19" r="1.300" fill="currentColor" stroke="none" /></svg>,
	eye: () => <svg {...f} fillRule="evenodd"><path d="M12 5c6 0 9.700 6.200 9.700 7s-3.700 7-9.700 7-9.700-6.200-9.700-7S6 5 12 5zm0 3.800a3.200 3.200 0 1 0 0 6.400 3.200 3.200 0 0 0 0-6.400z" /></svg>,
	palette: () => <svg {...f} fillRule="evenodd"><path d="M12 3a9 9 0 1 0 0 18c1.200 0 1.900-.9 1.900-1.900 0-1.600 1.200-2.300 2.800-2.300H18a3 3 0 0 0 3-3c0-5.900-4-10.800-9-10.800zM7.600 9.200a1.500 1.500 0 1 0 0 3 1.500 1.500 0 0 0 0-3zm4.400-3a1.500 1.500 0 1 0 0 3 1.500 1.500 0 0 0 0-3zm4.400 3a1.500 1.500 0 1 0 0 3 1.500 1.500 0 0 0 0-3z" /></svg>,
	lecture: () => <svg {...f}><path d="M12 3.800L1.500 9l10.500 5.200L22.500 9z" /><path d="M5.500 12.800v4.100c1.700 1.700 4 2.600 6.500 2.600s4.800-.9 6.500-2.600v-4.100L12 16z" /></svg>,
	flag: () => <svg {...f}><rect x="4" y="2.500" width="2.600" height="19" rx="1.300" /><path d="M8 4h11.200c.500 0 .800.600.500 1l-2.400 3.500 2.400 3.500c.300.400 0 1-.500 1H8z" /></svg>,
	move: () => <svg {...s} strokeWidth={2.4}><path d="M12 3v18M3 12h18M9 5.500l3-3 3 3M9 18.500l3 3 3-3M5.500 9l-3 3 3 3M18.500 9l3 3-3 3" /></svg>,
	work: () => <svg {...f} fillRule="evenodd"><path d="M9.800 3.500h4.400A2.300 2.300 0 0 1 16.500 5.800V7.500h3A1.500 1.500 0 0 1 21 9v9.500a1.500 1.500 0 0 1-1.500 1.500h-15A1.500 1.500 0 0 1 3 18.500V9a1.500 1.500 0 0 1 1.500-1.500h3V5.800A2.300 2.300 0 0 1 9.800 3.500zm0 2.200a.2.200 0 0 0-.200.100v1.700h4.800V5.800a.2.200 0 0 0-.200-.100z" /></svg>,
	phone: () => <svg {...f} fillRule="evenodd"><path d="M8 2.500h8A2 2 0 0 1 18 4.500v15a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-15a2 2 0 0 1 2-2zm2.500 15.300a1.100 1.100 0 0 0 0 2.200h3a1.100 1.100 0 0 0 0-2.200z" /></svg>,
};

/** The mark: three blocks. */
export function Logo({ size = 34 }: { size?: number }) {
	return (
		<svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
			<rect className="li-mod-tangerine" x="3" y="3" width="15" height="15" rx="4.500" fill="var(--li-mod)" />
			<rect className="li-mod-lime" x="3" y="22" width="15" height="15" rx="4.500" fill="var(--li-mod)" />
			<rect className="li-mod-rose" x="22" y="22" width="15" height="15" rx="4.500" fill="var(--li-mod)" />
		</svg>
	);
}

/** A ring that fills as questions are answered, and closes when done. */
export function FocusRing({ done, total, size = 56, stroke = "var(--li-mint)", track = "var(--li-bar-line)", label }: { done: number; total: number; size?: number; stroke?: string; track?: string; label?: string }) {
	const c = 2 * Math.PI * 30;
	const frac = total > 0 ? Math.min(1, done / total) : 0;
	return (
		<svg width={size} height={size} viewBox="0 0 72 72" role="img" aria-label={label ?? `${done} of ${total} answered`}>
			<circle cx="36" cy="36" r="30" fill="none" stroke={track} strokeWidth="8" />
			<circle cx="36" cy="36" r="30" fill="none" stroke={stroke} strokeWidth="8" strokeLinecap="round" strokeDasharray={`${(c * frac).toFixed(1)} ${c.toFixed(1)}`} transform="rotate(-90 36 36)" className="li-ring-fill" />
		</svg>
	);
}

/** Where the student stands on something: a shape and a word, never colour alone. */
export function StatusTag({ status }: { status: "solid" | "shaky" | "revisit" | "notyet" | "answered" | "not-started" }) {
	if (status === "solid" || status === "answered") return <span className="li-status solid"><Icon.check />{status === "answered" ? "Done" : "Secured"}</span>;
	if (status === "shaky") return <span className="li-status shaky"><Icon.half />Getting there</span>;
	if (status === "revisit") return <span className="li-status revisit"><Icon.ring />To revisit</span>;
	return <span className="li-status notyet"><Icon.dot />Not yet</span>;
}

const SHAPES: Record<ModuleShape, React.ReactNode> = {
	circle: <circle cx="12" cy="12" r="7.500" />,
	triangle: <path d="M12 4.200c.600 0 1.100.300 1.400.800l6.300 11.200c.600 1.100-.200 2.400-1.400 2.400H5.700c-1.200 0-2-1.300-1.400-2.400L10.600 5c.300-.500.800-.800 1.400-.800z" />,
	square: <rect x="5" y="5" width="14" height="14" rx="3" />,
	diamond: <rect x="5.600" y="5.600" width="12.800" height="12.800" rx="2.600" transform="rotate(45 12 12)" />,
	hexagon: <path d="M12 3.300l7.200 4.200v9L12 20.700l-7.200-4.200v-9z" />,
	star: <path d="M12 3l2.600 5.700 6.200.700-4.600 4.200 1.300 6.100L12 16.600 6.500 19.700l1.300-6.100L3.200 9.400l6.200-.700z" />,
};

/**
 * A module's mark: its shape on its colour. Use inside a <Tint> of that
 * module, or pass `module` to colour it by itself. `onColour`: it sits on a
 * panel already in the module's colour, so the tile is the reading surface.
 */
export function ModuleMark({ module, small, onColour }: { module: string; small?: boolean; onColour?: boolean }) {
	const root = useLockedInOptional();
	const look = root?.moduleLook(module);
	const size = small ? 16 : 22;
	return (
		<span className={`li-mark${small ? " small" : ""}${onColour ? " on-colour" : ""}${look ? ` li-mod-${look.colour}` : ""}`} aria-hidden="true">
			<svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">{SHAPES[look?.shape ?? "circle"]}</svg>
		</span>
	);
}

/** How sure: four bars, the first `level` of them filled. */
export function Bars({ level }: { level: 1 | 2 | 3 | 4 }) {
	return (
		<svg width="22" height="16" viewBox="0 0 22 16" aria-hidden="true">
			{[0, 1, 2, 3].map((i) => <rect key={i} x={1 + i * 5.400} y={11 - i * 3.200} width="3.600" height={4 + i * 3.200} rx="1.200" fill={i < level ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.400" />)}
		</svg>
	);
}
