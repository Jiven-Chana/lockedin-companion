/**
 * One-shot structured generation (v0.1 spec §5.4): study packs, the course
 * split (F-104) and the setup chat are not teaching sessions. Each is one
 * call on one of the student's model slots that must return a value of a
 * given JSON shape. Implemented in lh-port.ts over the engine's own
 * submit-agent (the extraction pipeline's single-tool worker), so it uses
 * the student's slot and credential exactly as the engine does.
 */

import type { ModelSlotName } from "../../core/settings.ts";

export interface GenerateRequest {
	slot: ModelSlotName;
	system: string;
	user: string;
	/** The submit tool the model must call, and its JSON Schema. */
	toolName: string;
	toolDescription: string;
	schema: Record<string, unknown>;
	/** Semantic check on the submitted value: a problem string makes the model retry (within the turn budget). */
	validate?: (value: unknown) => string | null;
	signal?: AbortSignal;
}

export interface GenerateResult<T> {
	value: T;
	model: string;
	/** USD at the catalogue price; null on a subscription. */
	cost: number | null;
	ms: number;
}

export type Generate = <T>(req: GenerateRequest) => Promise<GenerateResult<T>>;
