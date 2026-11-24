import { companionRoute } from "@/src/server";

export const dynamic = "force-dynamic";

/** The phone link (F-112): { paired, relay, phoneSeenAt?, pushReady?, uploadedAt?, holds, reachable? }, or 501 without a relay. */
export const GET = companionRoute(({ svc }) => svc.requirePhone().status());
