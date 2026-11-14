import { companionRoute } from "@/src/server";

/** { questionId, indices: number[] (1-based) | dontKnow: true, confidence?, why? } */
export const POST = companionRoute<{ id: string }>(async ({ svc, params, json }) => svc.answer(params.id, await json()));
