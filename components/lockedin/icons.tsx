/** Small inline stroke icons (Lucide-style). Decorative unless given a label. */

const base = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

export const Icon = {
	today: () => <svg {...base}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>,
	library: () => <svg {...base}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z" /><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" /></svg>,
	progress: () => <svg {...base}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>,
	me: () => <svg {...base}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>,
	bell: () => <svg {...base} width={16} height={16}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>,
	calendar: () => <svg {...base}><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>,
	link: () => <svg {...base}><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></svg>,
	upload: () => <svg {...base}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" /></svg>,
	check: () => <svg {...base} width={18} height={18} strokeWidth={2.5}><path d="M20 6 9 17l-5-5" /></svg>,
	half: () => <svg {...base} width={18} height={18} strokeWidth={2.5}><circle cx="12" cy="12" r="8" /><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" /></svg>,
	ring: () => <svg {...base} width={18} height={18} strokeWidth={2.5}><circle cx="12" cy="12" r="8" /></svg>,
	dot: () => <svg {...base} width={18} height={18}><circle cx="12" cy="12" r="3" fill="currentColor" /></svg>,
	play: () => <svg {...base}><path d="M7 4l13 8-13 8z" fill="currentColor" /></svg>,
	demo: () => <svg {...base}><path d="M12 6v6l4 2" /><circle cx="12" cy="12" r="9" /></svg>,
	search: () => <svg {...base}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>,
};

export function Logo({ size = 32 }: { size?: number }) {
	return (
		<svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
			<circle cx="20" cy="20" r="16" fill="none" stroke="var(--li-line)" strokeWidth="4" />
			<circle cx="20" cy="20" r="16" fill="none" stroke="var(--li-accent)" strokeWidth="4" strokeLinecap="round" strokeDasharray="70 101" transform="rotate(-90 20 20)" />
			<rect x="14" y="18" width="12" height="9" rx="2" fill="var(--li-accent)" />
			<path d="M16.5 18v-2.5a3.5 3.5 0 0 1 7 0V18" fill="none" stroke="var(--li-accent)" strokeWidth="2" />
		</svg>
	);
}

/** The focus ring: fills as questions are answered, closes when done. */
export function FocusRing({ done, total, size = 56, stroke = "var(--li-deep-accent)", track = "var(--li-deep-line)", label }: { done: number; total: number; size?: number; stroke?: string; track?: string; label?: string }) {
	const c = 2 * Math.PI * 30;
	const frac = total > 0 ? Math.min(1, done / total) : 0;
	return (
		<svg width={size} height={size} viewBox="0 0 72 72" role="img" aria-label={label ?? `${done} of ${total} answered`}>
			<circle cx="36" cy="36" r="30" fill="none" stroke={track} strokeWidth="7" />
			<circle cx="36" cy="36" r="30" fill="none" stroke={stroke} strokeWidth="7" strokeLinecap="round" strokeDasharray={`${(c * frac).toFixed(1)} ${c.toFixed(1)}`} transform="rotate(-90 36 36)" style={{ transition: "stroke-dasharray 0.6s ease" }} />
		</svg>
	);
}

export function StatusTag({ status }: { status: "solid" | "shaky" | "revisit" | "notyet" | "answered" | "not-started" }) {
	if (status === "solid" || status === "answered") return <span className="li-status solid"><Icon.check />{status === "answered" ? "Done" : "Solid"}</span>;
	if (status === "shaky") return <span className="li-status solid"><Icon.half />Shaky</span>;
	if (status === "revisit") return <span className="li-status revisit"><Icon.ring />To revisit</span>;
	return <span className="li-status notyet"><Icon.dot />Not yet</span>;
}
