/**
 * Route plumbing for app/api/companion/**: every handler is one line —
 * `export const POST = companionRoute(async ({ svc, req, params }) => …)`.
 * Errors become JSON `{ error, code }` with the right status; a returned
 * Response passes through; anything else is sent as JSON (undefined → 204).
 *
 * LearnHarness's proxy.ts already applies its host and same-origin write
 * checks to every /api route, these included.
 */

import { CompanionError } from "./errors.ts";
import { companionService, demoEnabled } from "./default.ts";
import type { CompanionService } from "./service.ts";

type Params = Record<string, string | string[] | undefined>;

export interface CompanionRouteContext<P extends Params> {
	svc: CompanionService;
	req: Request;
	params: P;
	url: URL;
	/** The parsed JSON body ({} when empty). Throws 400 on malformed JSON. */
	json: () => Promise<unknown>;
}

/**
 * A CompanionError from any module instance. Next gives each route its own
 * copy of these modules while the service is shared through globalThis, so
 * an error thrown by the service can fail `instanceof` in another route.
 */
function isCompanionError(err: unknown): err is CompanionError {
	if (err instanceof CompanionError) return true;
	const e = err as { name?: unknown; code?: unknown; status?: unknown } | null;
	return !!e && (e.name === "CompanionError" || e.name === "EngineError") && typeof e.code === "string" && typeof e.status === "number";
}

export function companionErrorResponse(err: unknown): Response {
	if (isCompanionError(err)) {
		return Response.json({ error: err.message, code: err.code, ...(err.detail !== undefined ? { detail: err.detail } : {}) }, { status: err.status });
	}
	console.error("[companion] unhandled error:", err);
	return Response.json({ error: "Internal error", code: "internal" }, { status: 500 });
}

export function companionRoute<P extends Params = Params>(
	handler: (ctx: CompanionRouteContext<P>) => unknown,
	opts: { demoOnly?: boolean } = {},
) {
	return async (req: Request, routeCtx?: { params?: Promise<P> }): Promise<Response> => {
		if (opts.demoOnly && !demoEnabled()) return Response.json({ error: "Not found", code: "not_found" }, { status: 404 });
		try {
			const params = ((await routeCtx?.params) ?? {}) as P;
			const json = async () => {
				const text = await req.text();
				if (!text.trim()) return {};
				try {
					return JSON.parse(text);
				} catch {
					throw new CompanionError("bad_json", 400, "Invalid JSON body");
				}
			};
			const result = await handler({ svc: companionService(), req, params, url: new URL(req.url), json });
			if (result instanceof Response) return result;
			if (result === undefined) return new Response(null, { status: 204 });
			return Response.json(result);
		} catch (err) {
			return companionErrorResponse(err);
		}
	};
}
