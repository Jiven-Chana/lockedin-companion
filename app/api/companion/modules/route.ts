import { companionRoute } from "@/src/server";

export const dynamic = "force-dynamic";

/** Modules available to pick at onboarding (from the sample timetable). */
export const GET = companionRoute(({ svc }) => svc.availableModules());

/** "+ Add a module" (V-64): { name } → { code, name }. The code is made from the name. */
export const POST = companionRoute(async ({ svc, json }) => svc.addModule(await json()));
