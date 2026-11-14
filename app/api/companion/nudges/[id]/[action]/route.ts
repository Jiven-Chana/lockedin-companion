import { companionRoute } from "@/src/server";

/** open · snooze · dismiss · wasnt-there */
export const POST = companionRoute<{ id: string; action: string }>(({ svc, params }) => svc.nudgeAction(params.id, params.action));
