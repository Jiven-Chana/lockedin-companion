import { companionRoute } from "@/src/server";

/** One chat turn: { messages: [{ role: "assistant" | "student", text }] } → { say, chips, done, draft } or { fallback: true }. { skip: true } logs a skip. Confirm with POST /routine. */
export const POST = companionRoute(async ({ svc, json }) => svc.setupChatTurn(await json()));
