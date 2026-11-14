import { companionRoute } from "@/src/server";

export const dynamic = "force-dynamic";

/** Setup and engine status (is LearnHarness configured, which engine is default). */
export const GET = companionRoute(({ svc }) => svc.health());
