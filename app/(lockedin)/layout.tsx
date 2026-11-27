import type { Metadata } from "next";
import { Atkinson_Hyperlegible, Bricolage_Grotesque } from "next/font/google";
import { connection } from "next/server";
import { companionService, demoEnabled } from "@/src/server";
import { LockedInRoot } from "@/components/lockedin/root";
import "katex/dist/katex.min.css";
import "@/components/lockedin/lockedin.css";

const display = Bricolage_Grotesque({ subsets: ["latin"], weight: ["700", "800"], variable: "--font-display" });
const body = Atkinson_Hyperlegible({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-body" });

export const metadata: Metadata = {
	title: "LockedIn",
	description: "Get into a short, prepared study session at the right moment.",
};

/** LockedIn's own root layout: none of the engine's chrome or styles (mvp1-plan F-01). */
export default async function LockedInLayout({ children }: { children: React.ReactNode }) {
	await connection();
	const profile = companionService().profile();
	const appearance = profile?.appearance ?? null;
	// Each module's colour is its place in the student's list, or the one they picked (v3.0).
	const modules = (profile?.modules ?? []).map((m) => ({ code: m.code, ...(m.colour ? { colour: m.colour } : {}) }));
	return (
		<html lang="en" className={`${display.variable} ${body.variable}`} suppressHydrationWarning>
			<body>
				<LockedInRoot initial={appearance} initialModules={modules} demo={demoEnabled()}>{children}</LockedInRoot>
			</body>
		</html>
	);
}
