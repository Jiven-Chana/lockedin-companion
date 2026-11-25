import { companionRoute } from "@/src/server";

/** Start Practise (V-40): `{ module, idea? }` → `{ sessionId, written }`. With `idea` (V-39) the AI first writes new questions around the gap, when it is connected. */
export const POST = companionRoute(async ({ svc, json }) => svc.practise(await json()));
