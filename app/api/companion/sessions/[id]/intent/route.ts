import { companionRoute } from "@/src/server";

/** The first step of a Learn session answered (v3.1). Body: { goal?, check, suggestion? } or { resume: true } → { ok }. */
export const POST = companionRoute<{ id: string }>(async ({ svc, params, json }) => svc.answerIntent(params.id, await json()));
