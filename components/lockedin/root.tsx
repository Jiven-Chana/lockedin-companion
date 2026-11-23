"use client";

/**
 * The LockedIn root: applies the Focus theme (generated tokens, light /
 * dark / system / high contrast, text size, spacing, reduce motion), follows
 * the (demo) clock for the time-of-day layer, and shares appearance + clock
 * with every screen. Module-tinted regions use <Tint>.
 */

import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { MOTION, readAppearance, themeCss, timeOfDay, type FocusAppearance, type Profile } from "@/src/core";
import { api, lockedIn } from "./api";

interface RootCtx {
	appearance: FocusAppearance;
	setAppearance: (patch: Partial<Profile["appearance"]>) => Promise<void>;
	scheme: "light" | "dark";
	now: Date;
	refreshClock: () => void;
	demo: boolean;
}

const Ctx = createContext<RootCtx | null>(null);

/** The root context, or null outside <LockedInRoot> (server rendering in tests). */
export function useLockedInOptional(): RootCtx | null {
	return useContext(Ctx);
}

export function useLockedIn(): RootCtx {
	const c = useContext(Ctx);
	if (!c) throw new Error("useLockedIn outside <LockedInRoot>");
	return c;
}

export function LockedInRoot({ initial, demo, children }: { initial: Partial<Profile["appearance"]> | null; demo: boolean; children: React.ReactNode }) {
	const [raw, setRaw] = useState<Partial<Profile["appearance"]> | null>(initial);
	const appearance = useMemo(() => readAppearance(raw), [raw]);
	const [systemDark, setSystemDark] = useState(false);
	const [now, setNow] = useState(() => new Date());

	useEffect(() => {
		const mq = window.matchMedia("(prefers-color-scheme: dark)");
		setSystemDark(mq.matches);
		const on = (e: MediaQueryListEvent) => setSystemDark(e.matches);
		mq.addEventListener("change", on);
		return () => mq.removeEventListener("change", on);
	}, []);

	const refreshClock = useCallback(() => {
		api<{ now: string }>("/health").then((h) => setNow(new Date(h.now))).catch(() => undefined);
	}, []);
	useEffect(() => {
		refreshClock();
		const t = setInterval(refreshClock, 60_000);
		window.addEventListener("li:clock", refreshClock);
		return () => {
			clearInterval(t);
			window.removeEventListener("li:clock", refreshClock);
		};
	}, [refreshClock]);

	const setAppearance = useCallback(async (patch: Partial<Profile["appearance"]>) => {
		setRaw((r) => ({ ...(r ?? {}), ...patch }));
		try {
			const p = await lockedIn.updateProfile({ appearance: patch });
			setRaw(p.appearance);
		} catch {
			// Not onboarded yet: keep the choice for this visit.
		}
	}, []);

	// Theme and hue changes cross-fade live (F-118): colours transition for a moment after a change, never otherwise.
	const [xfade, setXfade] = useState(false);
	const lastLook = useRef<string | null>(null);
	const look = `${appearance.theme}|${appearance.hue}`;
	useEffect(() => {
		if (lastLook.current !== null && lastLook.current !== look) {
			setXfade(true);
			const t = setTimeout(() => setXfade(false), MOTION.mediumMs + 100);
			lastLook.current = look;
			return () => clearTimeout(t);
		}
		lastLook.current = look;
	}, [look]);
	const pathname = usePathname() ?? "";
	const motionVars = {
		"--li-m-short": `${MOTION.shortMs}ms`,
		"--li-m-medium": `${MOTION.mediumMs}ms`,
		"--li-m-ring": `${MOTION.ringMs}ms`,
		"--li-m-stagger": `${MOTION.staggerMs}ms`,
		"--li-m-page": `${MOTION.pageMs}ms`,
		"--li-m-drift": `${MOTION.driftSeconds}s`,
	} as React.CSSProperties;

	const scheme: "light" | "dark" =
		appearance.theme === "dark" || appearance.theme === "contrast" ? "dark" : appearance.theme === "light" ? "light" : systemDark ? "dark" : "light";
	const tod = timeOfDay(now);
	const css = themeCss(".li-root", appearance, { tod });

	return (
		<Ctx.Provider value={{ appearance, setAppearance, scheme, now, refreshClock, demo }}>
			{/* Time-of-day colours depend on the clock, which can differ between server and browser (#418). */}
			<style suppressHydrationWarning>{css}</style>
			<div
				className="li-root"
				suppressHydrationWarning
				data-scheme={scheme}
				data-text={appearance.textSize}
				data-loose={String(appearance.loose)}
				data-motion={appearance.motion}
				data-place={pathname.startsWith("/app/session") ? "session" : "app"}
				data-xfade={xfade ? "" : undefined}
				style={motionVars}
				data-tod={tod}
			>
				{children}
			</div>
		</Ctx.Provider>
	);
}

/** A region in a module's own colour (Auto), or the chosen seed when one is fixed. */
export function Tint({ hue, className, children, style }: { hue: number; className?: string; children: React.ReactNode; style?: React.CSSProperties }) {
	const { appearance, now } = useLockedIn();
	if (appearance.hue !== "auto" || appearance.theme === "contrast") {
		return <div className={className} style={style}>{children}</div>;
	}
	const cls = `li-tint-${Math.round(hue)}`;
	return (
		<div className={`${cls} ${className ?? ""}`} style={style}>
			<style suppressHydrationWarning>{themeCss(`.${cls}`, appearance, { hue, tod: timeOfDay(now) })}</style>
			{children}
		</div>
	);
}
