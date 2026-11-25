import { companionRoute } from "@/src/server";

export const dynamic = "force-dynamic";

/** Learn: every step so far, oldest first ("Earlier"). */
export const GET = companionRoute<{ id: string }>(({ svc, params }) => svc.steps(params.id));
