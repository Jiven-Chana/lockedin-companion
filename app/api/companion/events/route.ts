import { companionRoute } from "@/src/server";

/** UI-side events for the T23 log: { type, data } or an array of them. */
export const POST = companionRoute(async ({ svc, json }) => svc.logClientEvents(await json()));
