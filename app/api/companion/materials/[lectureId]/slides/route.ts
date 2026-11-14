import { companionRoute } from "@/src/server";

export const dynamic = "force-dynamic";

/** The lecture's slides as sections { number, title, body } for the slide panel. */
export const GET = companionRoute<{ lectureId: string }>(({ svc, params }) => svc.lectureSlides(params.lectureId));
