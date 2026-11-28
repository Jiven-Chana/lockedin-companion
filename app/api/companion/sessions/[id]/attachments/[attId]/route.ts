import { companionRoute } from "@/src/server";

/** Take an attachment back before it has been sent to the tutor (v3.1) → { attachments }. */
export const DELETE = companionRoute<{ id: string; attId: string }>(({ svc, params }) => svc.removeAttachment(params.id, params.attId));
