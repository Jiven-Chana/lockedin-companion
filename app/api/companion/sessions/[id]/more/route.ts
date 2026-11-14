import { companionRoute } from "@/src/server";

/** "Keep going": { questions?: number } (default 3) → { budget }. */
export const POST = companionRoute<{ id: string }>(async ({ svc, params, json }) => svc.more(params.id, await json()));
