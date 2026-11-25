import { companionRoute, readUploads } from "@/src/server";

export const dynamic = "force-dynamic";

/** Setup's slides step (V-66). Multipart "file" fields: read, split and save every unit worth studying straight away → { units, skipped }. */
export const POST = companionRoute<{ code: string }>(async ({ svc, req, params }) => svc.quickMaterials(params.code, await readUploads(req)));
