import { companionRoute } from "@/src/server";

/** "Rewrite questions" (v3.1): write each unit's questions again, on request only → { units }. */
export const POST = companionRoute<{ code: string }>(({ svc, params }) => svc.rewriteQuestions(params.code));
