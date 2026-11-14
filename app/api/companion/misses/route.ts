import { companionRoute } from "@/src/server";

export const dynamic = "force-dynamic";

/** Ideas to revisit (open misses), ?lectureId= to filter. */
export const GET = companionRoute(({ svc, url }) => svc.openMisses(url.searchParams.get("lectureId")));
