import { companionRoute } from "@/src/server";

export const dynamic = "force-dynamic";

/** "Re-plan the rest of my week" (v2.2): kept blocks that passed unstarted move to free times → plan + { message }. */
export const POST = companionRoute(({ svc }) => svc.replanWeek());

/** Undo the last re-plan, on the day it was made → plan + { message }. 409 `nothing_to_undo` when there is none. */
export const DELETE = companionRoute(({ svc }) => svc.undoReplan());
