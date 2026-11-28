import { companionRoute, readUploads } from "@/src/server";

export const dynamic = "force-dynamic";

/** Attach one file to a Learn session (v3.1): multipart "file" (PDF, text, a web page or a picture) → { attachments }. */
export const POST = companionRoute<{ id: string }>(async ({ svc, req, params }) => {
	const [file] = await readUploads(req);
	if (!file) return Response.json({ error: "multipart field \"file\" is required", code: "bad_request" }, { status: 400 });
	return svc.attach(params.id, file);
});
