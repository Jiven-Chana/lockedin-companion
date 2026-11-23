import { companionRoute } from "@/src/server";

/** Accept proposals: { ids } or { week } (every proposal that week) → the week's plan. */
export const POST = companionRoute(async ({ svc, json }) => svc.acceptBlocks(await json()));
