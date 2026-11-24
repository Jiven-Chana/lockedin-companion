import { companionRoute } from "@/src/server";

/** Upload the week and pull the phone's events now (the app does this on open, on focus and every minute). */
export const POST = companionRoute(({ svc }) => svc.requirePhone().sync({ force: true }));
