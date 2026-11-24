import { companionRoute } from "@/src/server";

export const dynamic = "force-dynamic";

/** The next 7 days of nudges, as the phone relay receives them (F-112, F-114): { now, nudges: ScheduledNudge[] }. */
export const GET = companionRoute(({ svc }) => svc.schedule());
