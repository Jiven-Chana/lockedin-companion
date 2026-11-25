import { companionRoute } from "@/src/server";

/** The end of setup, reached once → the setup state, with `end`: the unit to learn first, or null with no slides yet. */
export const POST = companionRoute(({ svc }) => svc.setupDone());
