import { companionRoute } from "@/src/server";

/** The first-time card (V-52): `{ start?, steps?, check?, more? }`, `{ same: true }` or `{ skip: true }` → `{ ok }`. The module is never asked again, and the tutor starts. */
export const POST = companionRoute<{ id: string }>(async ({ svc, params, json }) => svc.answerHow(params.id, await json()));
