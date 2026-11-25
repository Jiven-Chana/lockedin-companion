import { companionRoute } from "@/src/server";

/**
 * Start this study block (V-44): marks it started and opens its session, in
 * the mode the block suggests or `{ study: "learn" | "practise" }` (step 5).
 * `409 block_not_today` on another day.
 */
export const POST = companionRoute<{ id: string }>(async ({ svc, params, json }) => svc.startBlock(params.id, await json()));
