import { companionRoute } from "@/src/server";

/** Facilitator (COMPANION_DEMO=1): { engine: "learnharness" | "scripted" | null } — engine for the next sessions */
export const POST = companionRoute(async ({ svc, json }) => {
	return svc.demoEngine(await json());
}, { demoOnly: true });
