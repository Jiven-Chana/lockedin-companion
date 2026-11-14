import { companionRoute } from "@/src/server";

export const dynamic = "force-dynamic";

/** "What I read" (R-7, Q-10): source, counts, modules, last read. Location is never read. */
export const GET = companionRoute(({ svc }) => svc.reads());
