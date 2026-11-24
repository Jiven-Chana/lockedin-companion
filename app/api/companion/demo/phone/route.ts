import { companionRoute } from "@/src/server";

/** Facilitator: play a phone answer ({ action: "answer" }), a hand-off ({ action: "handover" }) or "Done for now" ({ action: "done" }), with { correct?: boolean }, without a phone. */
export const POST = companionRoute(async ({ svc, json }) => svc.demoPhone(await json()), { demoOnly: true });
