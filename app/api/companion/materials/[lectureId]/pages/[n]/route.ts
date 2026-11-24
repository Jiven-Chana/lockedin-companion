import { readFile } from "node:fs/promises";
import { companionRoute } from "@/src/server";

export const dynamic = "force-dynamic";

/** The picture (PNG) of page n of a unit's own PDF, for the slide panel (V-21). 404 when the unit has no PDF or no such page. */
export const GET = companionRoute<{ lectureId: string; n: string }>(async ({ svc, params }) => {
	const file = await svc.slidePage(params.lectureId, Number(params.n));
	return new Response(new Uint8Array(await readFile(file)), { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=3600" } });
});
