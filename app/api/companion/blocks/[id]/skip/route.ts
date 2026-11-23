import { companionRoute } from "@/src/server";

/** Skip (remove) this block: one tap (X-7). v0.1 blocks are dated (F-110). */
export const POST = companionRoute<{ id: string }>(({ svc, params }) => svc.skipBlock(params.id));
