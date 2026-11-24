import { companionRoute } from "@/src/server";

/** "Send a test question to my phone" (v1.0.4): one question from the student's own study packs, on the phone within a minute → { nudgeId, title, body, arrivesWithinSeconds }. */
export const POST = companionRoute(async ({ svc }) => svc.requirePhone().sendTest());
