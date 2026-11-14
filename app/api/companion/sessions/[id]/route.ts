import { companionRoute } from "@/src/server";

export const dynamic = "force-dynamic";

/** The session screen's state. Poll every ~750 ms while status is preparing or thinking. */
export const GET = companionRoute<{ id: string }>(({ svc, params }) => svc.view(params.id));
