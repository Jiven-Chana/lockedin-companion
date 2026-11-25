import { companionRoute } from "@/src/server";

/** Setup step 4. { energy?: ["morning" | "afternoon" | "evening"], weeklyTargetMinutes? } → { energy, target, week, blocks: [{ …, why }], message }. Suggests the week again each time. */
export const POST = companionRoute(async ({ svc, json }) => svc.setupWeek(await json()));

/** "Later" on the week step: the total and the suggested blocks go; nothing is set that the student didn't choose (V-5) → the setup state. */
export const DELETE = companionRoute(({ svc }) => svc.skipSetupWeek());
