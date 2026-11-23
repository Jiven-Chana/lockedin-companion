import { companionRoute } from "@/src/server";

/** One action on a block (F-110): { status: "accepted" | "started" | "removed" } and/or a move { date, start, minutes }. A move keeps its focus. */
export const PUT = companionRoute<{ id: string }>(async ({ svc, params, json }) => svc.updateBlock(params.id, await json()));
