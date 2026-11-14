import { companionRoute } from "@/src/server";

/** Skip this block's next occurrence, or { date: "YYYY-MM-DD" }. One tap (X-7). */
export const POST = companionRoute<{ id: string }>(async ({ svc, params, json }) => {
	const body = (await json()) as { date?: unknown };
	return svc.skipBlock(params.id, typeof body.date === "string" ? body.date : undefined);
});
