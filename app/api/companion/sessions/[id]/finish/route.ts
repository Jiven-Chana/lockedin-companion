import { companionRoute } from "@/src/server";

/** Learn: the student's "Finish". A Learn session is never ended for them. */
export const POST = companionRoute<{ id: string }>(({ svc, params }) => {
	svc.finish(params.id);
	return { ok: true };
});
