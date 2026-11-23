import { companionRoute } from "@/src/server";

export const dynamic = "force-dynamic";

/** The unit's study pack: { meta: progress per stage, model, cost, time | null, explainers, questions, running }. */
export const GET = companionRoute<{ id: string }>(({ svc, params }) => svc.pack(params.id));

/** Start or resume the pack; { fresh: true } regenerates every stage (F-105). */
export const POST = companionRoute<{ id: string }>(async ({ svc, json, params }) => svc.regeneratePack(params.id, await json()));

/** Cancel a running pack; it resumes from the first unfinished stage next time. */
export const DELETE = companionRoute<{ id: string }>(({ svc, params }) => svc.cancelPack(params.id));
