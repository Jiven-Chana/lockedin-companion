import { companionRoute, demoEnabled } from "@/src/server";

/** Start preparing a session. Body: { kind, lectureId, mode?, questions?, missIds?, engine? (demo only) } → { sessionId }. */
export const POST = companionRoute(async ({ svc, json }) => {
	const body = (await json()) as { engine?: unknown };
	const engine = demoEnabled() && (body.engine === "learnharness" || body.engine === "scripted") ? body.engine : undefined;
	return svc.createSession(svc.parseSpec(body), engine ? { engine } : {});
});
