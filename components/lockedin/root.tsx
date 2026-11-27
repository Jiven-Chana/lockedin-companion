"use client";

/**
 * The LockedIn root: applies the Blocks look (light, dark, system or high
 * contrast; text size, spacing, reduce motion), follows the (demo) clock,
 * and shares the appearance, the clock and each module's colour and shape
 * with every screen. A region in a module's colour uses <Tint>.
 */

import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { MOTION, moduleLook, readAppearance, themeCss, type FocusAppearance, type ModuleColour, type ModuleShape, type Profile } from "@/src/core";
import { api, lockedIn } from "./api";

interface RootCtx {
	appearance: FocusAppearance;
	setAppearance: (patch: Partial<Profile["appearance"]>) => Promise<void>;
	scheme: "light" | "dark";
	now: Date;
	refreshClock: () => void;
	demo: boolean;
	/** A module's colour and shape (v3.0): the one the student picked, else by its place in their list. */
	moduleLook: (code: string) => { colour: ModuleColour; shape: ModuleShape };
	/** Read the student's modules again, after one was added or its colour changed. */
	refreshModules: () => void;
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

type ModuleRef = { code: string; colour?: string };

export function LockedInRoot({ initial, initialModules = [], demo, children }: { initial: Partial<Profile["appearance"]> | null; initialModules?: ModuleRef[]; demo: boolean; children: React.ReactNode }) {
	const [raw, setRaw] = useState<Partial<Profile["appearance"]> | null>(initial);
	const [modules, setModules] = useState<ModuleRef[]>(initialModules);
	const refreshModules = useCallback(() => {
		lockedIn.profile().then((p) => { if (p) setModules(p.modules.map((m) => ({ code: m.code, ...(m.colour ? { colour: m.colour } : {}) }))); }).catch(() => undefined);
	}, []);
	useEffect(() => {
		window.addEventListener("li:refresh", refreshModules);
		return () => window.removeEventListener("li:refresh", refreshModules);
	}, [refreshModules]);
	const lookOf = useCallback((code: string) => moduleLook(code, modules), [modules]);
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

	// A change of theme cross-fades live (F-118): colours transition for a moment after a change, never otherwise.
	const [xfade, setXfade] = useState(false);
	const lastLook = useRef<string | null>(null);
	const look = appearance.theme;
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
	const css = themeCss(".li-root", appearance);

	return (
		<Ctx.Provider value={{ appearance, setAppearance, scheme, now, refreshClock, demo, moduleLook: lookOf, refreshModules }}>
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
			>
				{children}
			</div>
		</Ctx.Provider>
	);
}

/**
 * A region in a module's colour: inside it `--li-mod` is that module's block
 * colour and `--li-mod-soft` its soft tint (look.ts). With no module, the
 * region has no module colour and sand stands in.
 */
export function Tint({ module, className, children, style }: { module?: string | null; className?: string; children: React.ReactNode; style?: React.CSSProperties }) {
	const root = useLockedInOptional();
	const cls = module && root ? `li-mod-${root.moduleLook(module).colour}` : "";
	return <div className={`${cls} ${className ?? ""}`.trim() || undefined} style={style}>{children}</div>;
}
