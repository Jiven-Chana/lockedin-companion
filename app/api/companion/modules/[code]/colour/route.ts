import { companionRoute } from "@/src/server";

/** { colour: a module colour, or null for its place in the list }: this module's colour (v3.0) → the module. */
export const PUT = companionRoute<{ code: string }>(async ({ svc, json, params }) => svc.setModuleColour(params.code, await json()));
