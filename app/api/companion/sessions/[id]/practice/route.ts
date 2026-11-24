import { companionRoute } from "@/src/server";

/** "Use practice questions" on a failed session: the same lecture on its question bank, without the AI → { sessionId }. */
export const POST = companionRoute<{ id: string }>(async ({ svc, params }) => svc.practiceInstead(params.id));
