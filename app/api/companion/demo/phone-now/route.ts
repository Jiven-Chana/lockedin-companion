import { companionRoute } from "@/src/server";

/** Facilitator (T4): put the next lecture question on the paired phone now; the relay sends it within a minute → { nudgeId, title, body, arrivesWithinSeconds }. */
export const POST = companionRoute(async ({ svc }) => svc.requirePhone().sendNow(), { demoOnly: true });
