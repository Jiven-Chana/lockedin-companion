import { companionRoute } from "@/src/server";

/** Me → Voice (F-116): { key } saves a Deepgram key after checking it can start dictation; { key: null } removes it → AI status (with voice). */
export const POST = companionRoute(async ({ svc, json }) => svc.requireAi().voice(((await json()) as { key?: unknown }).key));
