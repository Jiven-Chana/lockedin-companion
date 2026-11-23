import { companionRoute } from "@/src/server";

/** { strong, cheap, vision }: each { model: { provider, id }, thinkingLevel? } → AI status. */
export const PUT = companionRoute(async ({ svc, json }) => svc.requireAi().setModels(await json()));
