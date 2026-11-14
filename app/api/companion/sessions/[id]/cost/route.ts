import { companionRoute } from "@/src/server";

export const dynamic = "force-dynamic";

/** What this session has cost so far (checkpoint criterion 4). Facilitator only. */
export const GET = companionRoute<{ id: string }>(({ svc, params }) => svc.sessionCost(params.id), { demoOnly: true });
