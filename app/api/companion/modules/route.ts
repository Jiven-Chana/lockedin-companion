import { companionRoute } from "@/src/server";

export const dynamic = "force-dynamic";

/** Modules available to pick at onboarding (from the sample timetable). */
export const GET = companionRoute(({ svc }) => svc.availableModules());
