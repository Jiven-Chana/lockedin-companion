import { companionRoute } from "@/src/server";

/** { questionId } — "Show me first": a worked example, then a fresh question on the same idea. */
export const POST = companionRoute<{ id: string }>(async ({ svc, params, json }) => {
	await svc.showMe(params.id, await json());
});
