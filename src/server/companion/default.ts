/**
 * The process-wide companion service, wired to the real data directory,
 * the demo clock and both engines. Cached on globalThis so Next's per-route
 * module instances share one service (and one in-flight preparation map).
 *
 * Environment (see companion/seed/.env.local.example):
 *   COMPANION_ENGINE          learnharness | scripted (default: scripted, so a
 *                             fresh checkout runs with no API key)
 *   COMPANION_AUTO_FALLBACK   1 = a LearnHarness prepare failure retries on scripted
 *   COMPANION_DEMO            1 = facilitator routes enabled (/api/companion/demo/*)
 *   COMPANION_READY_TIMEOUT_MS  question-1 timeout (default 60000)
 *
 * First run (v0.1 F-102): creating the service seeds the data directory
 * (prompt overrides, settings switches, demo materials) when it hasn't
 * been seeded, so `npm run companion:seed` is no longer a manual step.
 */

import path from "node:path";
import { PATHS } from "../../../config.ts";
import { ENGINE_NAMES, type EngineName } from "../../core/companion/types.ts";
import { convertPdf } from "../../agent/subagents/pdf-ops.ts";
import { readSettings } from "../../store/settings.ts";
import { providerKeyPresent } from "../keys.ts";
import { OffsetClock } from "./clock.ts";
import { CompanionContent } from "./content.ts";
import { LearnHarnessEngine } from "./engines/learnharness.ts";
import { ScriptedEngine } from "./engines/scripted.ts";
import { createLearnHarnessPort } from "./lh-port.ts";
import { fetchCalendarText } from "./calendar-fetch.ts";
import { CompanionService, type PdfConverter } from "./service.ts";
import { CompanionStore } from "./store.ts";
import { needsSeed, seedDataDir } from "../../../companion/seed.mjs";

export const companionDataDir = (): string => path.join(/* turbopackIgnore: true */ PATHS.data, "companion");
export const companionContentDir = (): string => path.join(/* turbopackIgnore: true */ PATHS.root, "companion", "content");

export function demoEnabled(env: Record<string, string | undefined> = process.env): boolean {
	return env.COMPANION_DEMO === "1";
}

export function configuredEngine(env: Record<string, string | undefined> = process.env): EngineName {
	const raw = env.COMPANION_ENGINE?.trim();
	return raw && (ENGINE_NAMES as readonly string[]).includes(raw) ? (raw as EngineName) : "scripted";
}

const pdfConverter: PdfConverter = async (data) => {
	const result = await convertPdf(data, 300);
	if (result.kind !== "converted") return result.kind;
	return result.pages.map((p) => ({ number: p.number, kind: p.kind, ...(p.kind === "text" ? { markdown: p.markdown } : {}) }));
};

function learnHarnessStatus() {
	const strong = readSettings()?.models?.strong?.model;
	return {
		learnharness: {
			strongModel: strong ? `${strong.provider}/${strong.id}` : null,
			providerKeyPresent: strong ? providerKeyPresent(strong.provider) : false,
		},
	};
}

/**
 * Seed the data directory on first run. Returns what was seeded, or null
 * when it already was. A failure is logged, not thrown: the companion still
 * runs (scripted, with the bundled content) on an unseeded directory.
 */
export function ensureSeeded(opts: { root?: string; dataDir?: string; env?: Record<string, string | undefined> } = {}) {
	const root = opts.root ?? PATHS.root;
	const dataDir = opts.dataDir ?? PATHS.data;
	try {
		if (!needsSeed({ root, dataDir })) return null;
		const report = seedDataDir({ root, dataDir, env: opts.env ?? process.env });
		console.log(`[companion] first run: seeded ${dataDir} (${report.prompts} prompt overrides, ${report.lectures} demo lectures)`);
		return report;
	} catch (err) {
		console.error(`[companion] first-run seed failed: ${err instanceof Error ? err.message : String(err)}`);
		return null;
	}
}

export function createCompanionService(env: Record<string, string | undefined> = process.env): CompanionService {
	ensureSeeded({ env });
	const store = new CompanionStore(companionDataDir());
	const content = new CompanionContent(store, companionContentDir());
	const clock = new OffsetClock(() => store.demo().clockOffsetMs);
	const timeout = Number(env.COMPANION_READY_TIMEOUT_MS);
	return new CompanionService({
		store,
		content,
		clock,
		clockControl: {
			set: (target) => store.saveDemo({ clockOffsetMs: clock.offsetFor(target) }),
			reset: () => store.saveDemo({ clockOffsetMs: 0 }),
		},
		engines: {
			learnharness: new LearnHarnessEngine(createLearnHarnessPort()),
			scripted: new ScriptedEngine((id) => content.scriptedSet(id)),
		},
		defaultEngine: configuredEngine(env),
		autoFallback: env.COMPANION_AUTO_FALLBACK === "1",
		...(Number.isFinite(timeout) && timeout > 0 ? { readyTimeoutMs: timeout } : {}),
		convertPdf: pdfConverter,
		fetchCalendar: (url) => fetchCalendarText(url),
		engineStatus: learnHarnessStatus,
	});
}

type CompanionGlobal = { __lhCompanionService?: CompanionService };

export function companionService(): CompanionService {
	const g = globalThis as typeof globalThis & CompanionGlobal;
	return (g.__lhCompanionService ??= createCompanionService());
}
