import { companionRoute } from "@/src/server";

/** Body: the .ics text (text/calendar), or JSON { ics }. Stretch (cut-list 1). */
export const POST = companionRoute(async ({ svc, req }) => {
	const text = await req.text();
	const ics = text.trimStart().startsWith("{") ? String((JSON.parse(text) as { ics?: unknown }).ics ?? "") : text;
	return svc.importIcs(ics);
});
