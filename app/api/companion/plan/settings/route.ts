import { companionRoute } from "@/src/server";

/** { weeklyTargetMinutes?, blockMinutes?, sundayTime?, focusScreen? } → the plan settings. */
export const PUT = companionRoute(async ({ svc, json }) => svc.updatePlanSettings(await json()));
