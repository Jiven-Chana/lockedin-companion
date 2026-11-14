import { companionRoute } from "@/src/server";

/** Facilitator (COMPANION_DEMO=1): { participant: "P03" | null } — stamped on every event */
export const POST = companionRoute(async ({ svc, json }) => {
	return svc.demoParticipant(await json());
}, { demoOnly: true });
