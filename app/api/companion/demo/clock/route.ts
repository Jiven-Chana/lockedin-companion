import { companionRoute } from "@/src/server";

/** Facilitator (COMPANION_DEMO=1): { set: ISO } | { advanceMinutes: n } | { jump: "next-lecture-end" | "next-day" | "sunday-evening" | "reset" } */
export const POST = companionRoute(async ({ svc, json }) => {
	return svc.demoClock(await json());
}, { demoOnly: true });
