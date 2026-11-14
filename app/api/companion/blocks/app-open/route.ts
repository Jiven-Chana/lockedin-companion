import { companionRoute } from "@/src/server";

/** The simulated lock: { app, confirmed?, reason? } → allowed, or the prompt to show. There is always a way out. */
export const POST = companionRoute(async ({ svc, json }) => svc.appOpen((await json()) as Parameters<typeof svc.appOpen>[0]));
