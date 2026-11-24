import { companionRoute } from "@/src/server";

/** Start this study block (V-44): marks it started and opens its session. `409 block_not_today` on another day. */
export const POST = companionRoute<{ id: string }>(({ svc, params }) => svc.startBlock(params.id));
