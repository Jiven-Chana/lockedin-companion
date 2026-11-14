import { companionRoute } from "@/src/server";

/** Facilitator (COMPANION_DEMO=1): { name } — load a preset from companion/content/sample-timetable.json (tayo, maya, returning) */
export const POST = companionRoute(async ({ svc, json }) => {
	return svc.demoScenario(await json());
}, { demoOnly: true });
