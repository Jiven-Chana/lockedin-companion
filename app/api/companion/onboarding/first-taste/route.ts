import { companionRoute } from "@/src/server";

/** Start preparing the first taste (the bundled sample lecture, O-3) → { sessionId, lectureId, title, module, spec }. */
export const POST = companionRoute(({ svc }) => svc.firstTaste());
