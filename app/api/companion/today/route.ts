import { companionRoute } from "@/src/server";

export const dynamic = "force-dynamic";

/** Everything the Today screen needs in one call. */
export const GET = companionRoute(({ svc }) => svc.today());
