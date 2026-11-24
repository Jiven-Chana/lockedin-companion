import { companionRoute } from "@/src/server";

/** { routine, source: "chat" | "form", modules?: [{ code, week, readingWeeks? }] }: save the confirmed routine and propose this week → { routine, plan }. */
export const POST = companionRoute(async ({ svc, json }) => svc.saveRoutine(await json()));
