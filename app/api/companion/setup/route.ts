import { companionRoute } from "@/src/server";

export const dynamic = "force-dynamic";

/** The first run (V-45): the step to open on and what each step has so far → { started, done, step, phone, calendar, modules, week, end }. */
export const GET = companionRoute(({ svc }) => svc.setup());
