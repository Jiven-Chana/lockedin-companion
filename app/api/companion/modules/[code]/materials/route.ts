import { companionRoute, readUploads } from "@/src/server";

export const dynamic = "force-dynamic";

/** Multipart "file" fields (PDF, .md, .txt) and/or "text" (+ "name"): convert and propose course units → { uploadId, files: [{ name, pageCount, noText, units, via, note }] }. */
export const POST = companionRoute<{ code: string }>(async ({ svc, req, params }) => svc.proposeMaterials(params.code, await readUploads(req)));

/** { uploadId, units: [{ file, title, week, pages: [from, to] }] }: save the confirmed units → { units }. */
export const PUT = companionRoute<{ code: string }>(async ({ svc, json, params }) => svc.saveMaterials(params.code, await json()));
