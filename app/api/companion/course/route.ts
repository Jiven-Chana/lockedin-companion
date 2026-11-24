import { companionRoute } from "@/src/server";

export const dynamic = "force-dynamic";

/** Each module with its current teaching week and its course units (V-18). */
export const GET = companionRoute(({ svc }) => svc.course());
