import { companionRoute } from "@/src/server";

/** { share: "less" | "normal" | "more" }: this module's share of the week's blocks (V-63) → the module. */
export const PUT = companionRoute<{ code: string }>(async ({ svc, json, params }) => svc.setModuleShare(params.code, await json()));
