import { companionRoute } from "@/src/server";

export const dynamic = "force-dynamic";

/** The block happening now (timer, Pomodoro phase) and the lock strictness. */
export const GET = companionRoute(({ svc }) => svc.activeBlock());
