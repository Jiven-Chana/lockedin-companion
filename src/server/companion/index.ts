/**
 * Companion server surface — re-exported from the server barrel
 * (src/server/index.ts) for app/api/companion/** under the import law.
 */

export { CompanionError, EngineError } from "./errors.ts";
export { CompanionStore, type DemoState } from "./store.ts";
export { OffsetClock, ManualClock, type Clock } from "./clock.ts";
export { CompanionContent } from "./content.ts";
export { CompanionService, type CompanionServiceDeps, type OnboardingInput, type PdfConverter } from "./service.ts";
export { LearnHarnessEngine, type LhPort, type LhSendResult } from "./engines/learnharness.ts";
export { createLearnHarnessPort, type LearnHarnessPortOptions } from "./lh-port.ts";
export { ScriptedEngine } from "./engines/scripted.ts";
export type { SessionEngine, PrepareContext, SessionPatch } from "./engines/types.ts";
export { companionService, createCompanionService, companionDataDir, companionContentDir, configuredEngine, demoEnabled } from "./default.ts";
export { companionRoute, companionErrorResponse, type CompanionRouteContext } from "./http.ts";
