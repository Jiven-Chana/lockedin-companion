import { companionRoute } from "@/src/server";

/** { title }: rename a course unit made from the student's own material → the unit. */
export const PUT = companionRoute<{ id: string }>(async ({ svc, params, json }) => svc.renameUnit(params.id, await json()));
