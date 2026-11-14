import { companionRoute } from "@/src/server";

/** { modules?: string[], timetableSource?: "sample" | "ics", nudgesPerDay?: 1 | 2 } → profile, reads, try-now card. */
export const POST = companionRoute(async ({ svc, json }) => svc.onboard((await json()) as Parameters<typeof svc.onboard>[0]));
