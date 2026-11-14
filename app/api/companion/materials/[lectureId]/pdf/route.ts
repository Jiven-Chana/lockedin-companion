import { readFile } from "node:fs/promises";
import { companionRoute } from "@/src/server";

export const dynamic = "force-dynamic";

/** The slide PDF, for the slide sheet (pdfjs renders the cited page client-side). */
export const GET = companionRoute<{ lectureId: string }>(async ({ svc, params }) => {
	const file = svc.materialsPdf(params.lectureId);
	if (!file) return Response.json({ error: "No PDF for this lecture", code: "pdf_not_found" }, { status: 404 });
	return new Response(new Uint8Array(await readFile(file)), { headers: { "Content-Type": "application/pdf", "Cache-Control": "private, max-age=300" } });
});
