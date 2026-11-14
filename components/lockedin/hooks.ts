"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Fetch on mount (and when deps change); `reload` refetches. */
export function useData<T>(fetcher: () => Promise<T>, deps: unknown[] = []) {
	const [data, setData] = useState<T | undefined>(undefined);
	const [error, setError] = useState<Error | null>(null);
	const [loading, setLoading] = useState(true);
	const f = useRef(fetcher);
	f.current = fetcher;
	const reload = useCallback(async () => {
		setLoading(true);
		try {
			setData(await f.current());
			setError(null);
		} catch (e) {
			setError(e as Error);
		} finally {
			setLoading(false);
		}
	}, []);
	useEffect(() => { void reload(); }, deps);
	return { data, error, loading, reload, setData };
}

/** Call `fn` every `ms` while `active` (and once on window focus). */
export function usePoll(fn: () => void, ms: number, active: boolean) {
	const f = useRef(fn);
	f.current = fn;
	useEffect(() => {
		if (!active) return;
		const t = setInterval(() => f.current(), ms);
		const onFocus = () => f.current();
		window.addEventListener("focus", onFocus);
		return () => {
			clearInterval(t);
			window.removeEventListener("focus", onFocus);
		};
	}, [ms, active]);
}

/** Per-browser conveniences (desktop notifications on/off). Never state that must persist. */
export function useLocalFlag(key: string, initial = false): [boolean, (v: boolean) => void] {
	const [v, setV] = useState(initial);
	useEffect(() => {
		try {
			const s = window.localStorage.getItem(key);
			if (s !== null) setV(s === "1");
		} catch {
			/* private mode */
		}
	}, [key]);
	const set = useCallback((next: boolean) => {
		setV(next);
		try {
			window.localStorage.setItem(key, next ? "1" : "0");
		} catch {
			/* private mode */
		}
	}, [key]);
	return [v, set];
}

export function fmtTime(iso: string | Date): string {
	const d = typeof iso === "string" ? new Date(iso) : iso;
	return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function fmtDay(iso: string | Date, now: Date): string {
	const d = typeof iso === "string" ? new Date(iso) : iso;
	const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
	if (same(d, now)) return "Today";
	const t = new Date(now);
	t.setDate(t.getDate() + 1);
	if (same(d, t)) return "Tomorrow";
	const y = new Date(now);
	y.setDate(y.getDate() - 1);
	if (same(d, y)) return "Yesterday";
	return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}
