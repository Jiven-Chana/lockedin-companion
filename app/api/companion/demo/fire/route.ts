import { companionRoute } from "@/src/server";

/** Facilitator (COMPANION_DEMO=1): { type: "N-1" | "N-2" | "N-3" | "N-4" | "block", lectureId? } — fire now, outside the rules */
export const POST = companionRoute(async ({ svc, json }) => {
	return svc.demoFire(await json());
}, { demoOnly: true });
