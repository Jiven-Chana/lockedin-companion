/**
 * The process-wide companion service, wired to the real data directory,
 * the demo clock and both engines. Cached on globalThis so Next's per-route
 * module instances share one service (and one in-flight preparation map).
 *
 * Environment (see companion/seed/.env.local.example):
 *   COMPANION_ENGINE          learnharness | scripted. Unset (v0.1 F-102):
 *                             learnharness whenever the student's AI is
 *                             connected with all three model slots set,
 *                             scripted otherwise (a fresh checkout, CI)
 *   COMPANION_AUTO_FALLBACK   1 = a LearnHarness prepare failure retries on scripted
 *   COMPANION_DEMO            1 = facilitator routes enabled (/api/companion/demo/*)
 *   COMPANION_READY_TIMEOUT_MS  question-1 timeout (default 60000)
 *   COMPANION_RELAY_URL       the phone relay (v0.1 F-112), e.g.
 *                             https://lockedin-relay.<account>.workers.dev; unset = no phone
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
import { createAiPort, createLearnHarnessPort, generate } from "./lh-port.ts";
import { verifyProviderKey } from "./ai.ts";
import { fetchCalendarText } from "./calendar-fetch.ts";
import { CompanionService, type PdfConverter } from "./service.ts";
import { CompanionStore } from "./store.ts";
import { needsSeed, seedDataDir } from "../../../companion/seed.mjs";

export const companionDataDir = (): string => path.join(/* turbopackIgnore: true */ PATHS.data, "companion");
export const companionContentDir = (): string => path.join(/* turbopackIgnore: true */ PATHS.root, "companion", "content");

export function demoEnabled(env: Record<string, string | undefined> = process.env): boolean {
	return env.COMPANION_DEMO === "1";
}

/** An explicit COMPANION_ENGINE, or null when unset (then the student's AI decides, F-102). */
export function explicitEngine(env: Record<string, string | undefined> = process.env): EngineName | null {
	const raw = env.COMPANION_ENGINE?.trim();
	return raw && (ENGINE_NAMES as readonly string[]).includes(raw) ? (raw as EngineName) : null;
}

/** The engine used when the student's AI is not ready: explicit, or scripted. */
export function configuredEngine(env: Record<string, string | undefined> = process.env): EngineName {
	return explicitEngine(env) ?? "scripted";
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
	const explicit = explicitEngine(env);
	const svc = new CompanionService({
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
		...(explicit ? {} : { engineWhenAiReady: "learnharness" as const }),
		ai: { port: createAiPort(), verifyKey: verifyProviderKey },
		generate,
		...(env.COMPANION_RELAY_URL?.startsWith("http") ? { relay: { url: env.COMPANION_RELAY_URL } } : {}),
		promptsDir: path.join(/* turbopackIgnore: true */ PATHS.root, "companion", "prompts"),
		autoFallback: env.COMPANION_AUTO_FALLBACK === "1",
		...(Number.isFinite(timeout) && timeout > 0 ? { readyTimeoutMs: timeout } : {}),
		convertPdf: pdfConverter,
		fetchCalendar: (url) => fetchCalendarText(url),
		engineStatus: learnHarnessStatus,
	});
	// Learn whether the student's AI is ready before the first session is asked for.
	void svc.ai?.status().catch(() => undefined);
	return svc;
}

type CompanionGlobal = { __lhCompanionService?: CompanionService };

export function companionService(): CompanionService {
	const g = globalThis as typeof globalThis & CompanionGlobal;
	return (g.__lhCompanionService ??= createCompanionService());
}
