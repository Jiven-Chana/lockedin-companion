import { companionRoute } from "@/src/server";

export const dynamic = "force-dynamic";

/** Facilitator panel state: demo clock, participant, engine, upcoming nudges. */
export const GET = companionRoute(({ svc }) => svc.demoState(), { demoOnly: true });
