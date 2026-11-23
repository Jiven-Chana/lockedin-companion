"use client";

/**
 * The app frame for the tabbed screens: the left rail (laptop first), the
 * nudge toasts, and the tick (GET /nudges/due every 30 s and on focus) that
 * pre-warms sessions and fires nudges. A due nudge appears as a toast and,
 * if the student turned them on, a real desktop notification.
 */

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { lockedIn, type Banner } from "./api";
import { fmtTime, useLocalFlag, usePoll } from "./hooks";
import { Icon, Logo } from "./icons";
import { useLockedIn } from "./root";

const NAV = [
	{ href: "/app", label: "Today", icon: Icon.today },
	{ href: "/app/library", label: "Library", icon: Icon.library },
	{ href: "/app/plan", label: "Week", icon: Icon.calendar },
	{ href: "/app/progress", label: "Progress", icon: Icon.progress },
	{ href: "/app/me", label: "Me", icon: Icon.me },
];

export function Shell({ children }: { children: React.ReactNode }) {
	const path = usePathname();
	const router = useRouter();
	const { now, demo } = useLockedIn();
	const [banner, setBanner] = useState<Banner>(null);
	const [hidden, setHidden] = useState<string | null>(null);
	const [notify] = useLocalFlag("li-notify");
	const notified = useRef(new Set<string>());

	const phonePaired = useRef(false);
	const tick = useCallback(async () => {
		try {
			const t = await lockedIn.tick();
			setBanner(t.nudge);
			// With a phone paired, the phone gets the OS notification; the laptop shows the card only (§5.2 item 5).
			if (t.nudge && notify && !phonePaired.current && !notified.current.has(t.nudge.id) && typeof Notification !== "undefined" && Notification.permission === "granted") {
				notified.current.add(t.nudge.id);
				const n = new Notification(t.nudge.title ?? "LockedIn", { body: t.nudge.text, tag: t.nudge.id });
				n.onclick = () => {
					window.focus();
					void open(t.nudge!.id);
				};
			}
		} catch {
			/* server restarting: the next tick catches up */
		}
	}, [notify]);

	useEffect(() => {
		lockedIn.today().then((t) => { phonePaired.current = t.phonePaired; if (!t.onboarded) router.replace("/app/welcome"); }).catch(() => undefined);
		void tick();
		const onClock = () => void tick();
		window.addEventListener("li:clock", onClock);
		return () => window.removeEventListener("li:clock", onClock);
	}, [router, tick]);
	usePoll(() => void tick(), 30_000, true);

	async function open(id: string) {
		const r = await lockedIn.nudge(id, "open");
		setBanner(null);
		if (r.href) router.push(r.href);
		else if (r.sessionId) router.push(`/app/session/${r.sessionId}`);
	}
	async function act(id: string, action: "snooze" | "dismiss" | "wasnt-there") {
		setHidden(id);
		await lockedIn.nudge(id, action).catch(() => undefined);
		setBanner(null);
		window.dispatchEvent(new Event("li:refresh"));
	}

	const active = (href: string) => (href === "/app" ? path === "/app" : path?.startsWith(href));
	const showToast = banner && banner.id !== hidden;

	return (
		<div className="li-app">
			<nav className="li-rail" aria-label="Main">
				<div className="li-brand"><Logo /><span>LockedIn</span></div>
				{NAV.map((n) => (
					<Link key={n.href} href={n.href} className="li-nav" aria-current={active(n.href) ? "page" : undefined}>
						<n.icon /><span>{n.label}</span>
					</Link>
				))}
				<div className="li-rail-foot">
					{/* The facilitator is at /app/facilitator only, never in the rail (F-119, plan §7.10). */}
					<div className="li-clock">
						{/* The server renders its own time; the browser's may differ by a minute or a time zone (React #418). The first clock refresh corrects it. */}
						<b suppressHydrationWarning>{demo ? "Demo clock" : "Now"} · {fmtTime(now)}</b>
						<span suppressHydrationWarning>{now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })}</span>
					</div>
				</div>
			</nav>
			{/* Full motion: each page fades and rises in (F-118); Calm and Off show it at once. */}
			<main className="li-main" id="main"><div key={path} className="li-page">{children}</div></main>
			<div className="li-toasts" aria-live="polite">
				{showToast ? (
					<div className="li-toast" role="status">
						<div className="li-row li-small li-muted" style={{ gap: 8 }}>
							<Icon.bell /><span style={{ flexGrow: 1 }}>{banner.type === "N-5" ? "LockedIn · your week" : `LockedIn · ${banner.ready ? "question 1 is ready" : "getting it ready"}`}</span>
							<button type="button" className="li-btn ghost" aria-label="Dismiss" onClick={() => act(banner.id, "dismiss")} style={{ minHeight: 32, textDecoration: "none" }}>✕</button>
						</div>
						{banner.title ? <span className="li-small"><b>{banner.title}</b></span> : null}
						<b style={{ fontSize: "1.06em", lineHeight: 1.35 }}>{banner.key.startsWith("handoff:") && banner.text.includes("✓") ? <>{banner.text.split("✓")[0]}<span className="li-check" style={{ animationDelay: "200ms" }}>✓</span>{banner.text.split("✓").slice(1).join("✓")}</> : banner.text}</b>
						{banner.why ? <span className="li-small li-muted">Why now: {banner.why}</span> : null}
						<div className="li-row" style={{ gap: 8 }}>
							<button type="button" className="li-btn primary" onClick={() => open(banner.id)}>Open</button>
							{banner.type !== "N-5" ? <button type="button" className="li-btn soft" onClick={() => act(banner.id, "snooze")}>Later</button> : null}
							{banner.type === "N-1" && !banner.key.startsWith("handoff:") ? <button type="button" className="li-btn ghost" style={{ marginLeft: "auto" }} onClick={() => act(banner.id, "wasnt-there")}>I wasn&apos;t there</button> : null}
						</div>
					</div>
				) : null}
			</div>
		</div>
	);
}

/** Page header used by every tab. */
/** `clock`: the eyebrow and title come from the clock, which can differ between server and browser (#418). */
export function PageHead({ eyebrow, title, children, clock = false }: { eyebrow?: string; title: string; children?: React.ReactNode; clock?: boolean }) {
	return (
		<header className="li-page-head" style={{ paddingRight: 420 }}>
			{eyebrow ? <span className="li-eyebrow" suppressHydrationWarning={clock}>{eyebrow}</span> : null}
			<h1 className="li-h1" suppressHydrationWarning={clock}>{title}</h1>
			{children}
		</header>
	);
}
