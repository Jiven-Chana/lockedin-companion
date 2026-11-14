import { companionRoute } from "@/src/server";

/** "I wasn't there". Body { missed: false } undoes it. */
export const POST = companionRoute<{ id: string }>(async ({ svc, params, json }) => {
	const body = (await json()) as { missed?: unknown };
	return svc.markMissed(params.id, body.missed !== false);
});
