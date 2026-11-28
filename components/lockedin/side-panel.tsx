"use client";

/**
 * A panel that opens at the side of a page (v3.0.1), for a long list the
 * page itself only summarises: all the milestones, every idea to revisit.
 * The page behind stays where it was. Escape, the Close button or a click
 * outside closes it, and the keyboard goes back to the button that opened it.
 */

import { useEffect, useRef } from "react";
import { PROGRESS_COPY } from "@/src/core";
import { Icon } from "./icons";

export function SidePanel({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
	const panel = useRef<HTMLDivElement>(null);
	// Read when a key is pressed, so a parent that re-draws does not re-run this effect and steal the focus.
	const close = useRef(onClose);
	close.current = onClose;
	useEffect(() => {
		const opener = document.activeElement as HTMLElement | null;
		panel.current?.focus();
		const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close.current(); };
		window.addEventListener("keydown", onKey);
		return () => {
			window.removeEventListener("keydown", onKey);
			opener?.focus?.();
		};
	}, []);
	return (
		<div className="li-side-back" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
			<div ref={panel} className="li-side" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
				<div className="li-row li-side-head">
					<h2 className="li-h2" style={{ flexGrow: 1 }}>{title}</h2>
					<button type="button" className="li-btn ghost" onClick={onClose}><Icon.close />{PROGRESS_COPY.closePanel}</button>
				</div>
				<div className="li-side-body">{children}</div>
			</div>
		</div>
	);
}
