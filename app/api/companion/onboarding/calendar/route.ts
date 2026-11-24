import { companionRoute } from "@/src/server";

/** { url } or { text }: read a calendar without saving it → { events, modules: [{ code, name, events, confident }] }. */
export const POST = companionRoute(async ({ svc, json }) => svc.calendarPreview(await json()));
