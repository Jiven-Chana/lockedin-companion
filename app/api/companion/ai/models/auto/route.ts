import { companionRoute } from "@/src/server";

/** "Choose for me": { provider? } → AI status plus { missing, saved } (missing slots are left for the student). */
export const POST = companionRoute(async ({ svc, json }) => svc.requireAi().chooseForMe(((await json()) as { provider?: unknown }).provider));
