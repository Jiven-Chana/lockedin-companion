import { companionRoute, demoEnabled } from "@/src/server";

export const dynamic = "force-dynamic";

/** Slide titles and availability for a lecture. */
export const GET = companionRoute<{ lectureId: string }>(({ svc, params }) => svc.materials(params.lectureId));

/** Upload a lecture PDF (dev/facilitator only: COMPANION_DEMO=1). Body: the PDF bytes, or multipart "file". */
export const POST = companionRoute<{ lectureId: string }>(async ({ svc, req, params }) => {
	if (!demoEnabled()) return Response.json({ error: "Not found", code: "not_found" }, { status: 404 });
	let bytes: Uint8Array;
	if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
		const file = (await req.formData()).get("file");
		if (!(file instanceof Blob)) return Response.json({ error: "multipart field \"file\" is required", code: "bad_request" }, { status: 400 });
		bytes = new Uint8Array(await file.arrayBuffer());
	} else bytes = new Uint8Array(await req.arrayBuffer());
	if (bytes.length === 0) return Response.json({ error: "empty body", code: "bad_request" }, { status: 400 });
	return svc.importMaterials(params.lectureId, bytes);
});
