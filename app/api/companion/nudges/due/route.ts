import { companionRoute } from "@/src/server";

export const dynamic = "force-dynamic";

/** The phone frame's tick (every 30 s and on clock changes): pre-warms sessions, fires what is due, returns the banner. */
export const GET = companionRoute(({ svc }) => svc.tick());
