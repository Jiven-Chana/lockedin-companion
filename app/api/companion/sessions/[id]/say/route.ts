import { companionRoute } from "@/src/server";

/** Learn (V-54): `{ text, questionId? }` or `{ say }` → `{ queued, answer }`. With a question open, the tutor answers beside it. */
export const POST = companionRoute<{ id: string }>(async ({ svc, params, json }) => svc.say(params.id, await json()));
