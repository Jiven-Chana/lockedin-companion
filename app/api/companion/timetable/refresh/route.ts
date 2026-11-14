import { companionRoute } from "@/src/server";

/** Re-read the subscribed calendar link. */
export const POST = companionRoute(({ svc }) => svc.refreshCalendar());
