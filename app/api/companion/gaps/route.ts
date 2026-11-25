import { companionRoute } from "@/src/server";

/** Gaps by idea (V-39): module, then idea, then the questions missed on it, with how far each idea is towards leaving the list. */
export const GET = companionRoute(({ svc }) => svc.gaps());
