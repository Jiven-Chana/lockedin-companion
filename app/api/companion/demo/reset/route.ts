import { companionRoute } from "@/src/server";

/** Facilitator (COMPANION_DEMO=1): reset all data (materials kept) and the demo clock. */
export const POST = companionRoute(({ svc }) => svc.demoReset(), { demoOnly: true });
