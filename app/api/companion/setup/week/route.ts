import { companionRoute } from "@/src/server";

/** Setup step 4. { energy?: ["morning" | "afternoon" | "evening"], weeklyTargetMinutes? } → { energy, target, week, blocks: [{ …, why }], message }. Suggests the week again each time. */
export const POST = companionRoute(async ({ svc, json }) => svc.setupWeek(await json()));
