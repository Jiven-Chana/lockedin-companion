import { companionRoute } from "@/src/server";

export const dynamic = "force-dynamic";

/** The lecture's concept map (mermaid graph TD nodes and edges) coloured by this student's answers. */
export const GET = companionRoute<{ id: string }>(({ svc, params }) => svc.lectureMap(params.id));
