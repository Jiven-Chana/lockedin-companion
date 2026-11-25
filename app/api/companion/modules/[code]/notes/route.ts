import { companionRoute } from "@/src/server";

export const dynamic = "force-dynamic";

/** What LockedIn knows about the student in a module (V-53): how you learn it, where you are, and the last session's plan. */
export const GET = companionRoute<{ code: string }>(({ svc, params }) => svc.moduleNotes(params.code));

/** The student edits a note: `{ how?: string, where?: string }`; an empty string clears it. */
export const PUT = companionRoute<{ code: string }>(async ({ svc, params, json }) => svc.saveModuleNote(params.code, await json()));
