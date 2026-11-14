import { companionRoute } from "@/src/server";

/** Recover a failed or interrupted turn (or a session that never started). */
export const POST = companionRoute<{ id: string }>(async ({ svc, params }) => {
	await svc.retry(params.id);
});
