import { companionRoute } from "@/src/server";

/** "Set week" on a course unit whose material didn't say which week it belongs to (V-25). Body: { week: 1–52 } → the unit. */
export const PUT = companionRoute<{ id: string }>(async ({ svc, params, json }) => svc.setUnitWeek(params.id, await json()));
