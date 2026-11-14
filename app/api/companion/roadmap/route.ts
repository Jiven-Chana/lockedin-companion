import { companionRoute } from "@/src/server";

export const dynamic = "force-dynamic";

/** Each module's lectures in course order, with status (INT-01-e). */
export const GET = companionRoute(({ svc }) => svc.roadmap());
