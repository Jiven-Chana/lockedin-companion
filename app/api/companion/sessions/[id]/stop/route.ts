import { companionRoute } from "@/src/server";

/** Stop for now. No model call; nothing is lost; reopening resumes. */
export const POST = companionRoute<{ id: string }>(({ svc, params }) => {
	svc.stop(params.id);
});
