import { companionRoute } from "@/src/server";

/** Start a Practise round across a module (V-40): `{ module }` → `{ sessionId }`. Bank questions, no AI. */
export const POST = companionRoute(async ({ svc, json }) => svc.startPractise(await json()));
