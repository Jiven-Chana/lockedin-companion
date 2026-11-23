import { companionRoute } from "@/src/server";

/** { op: "login" | "cancel" | "logout" | "consent", enabled? } → { browserAction?, error?, status }. Open browserAction in the reserved tab. */
export const POST = companionRoute(async ({ svc, json, req }) => {
	const b = (await json()) as { op?: unknown; enabled?: unknown };
	return svc.requireAi().chatgpt(b.op, { enabled: b.enabled }, req);
});
