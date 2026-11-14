import { companionRoute } from "@/src/server";

/** { questionId } → { text }. A side question that cannot see the answer key. */
export const POST = companionRoute<{ id: string }>(async ({ svc, params, json }) => svc.hint(params.id, await json()));
