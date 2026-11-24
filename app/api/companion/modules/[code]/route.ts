import { companionRoute } from "@/src/server";

/** { week: 1–52 | null, readingWeeks?: number[], inReadingWeek?: boolean }: "this is week N" for one module → module + { week, reading }. */
export const PUT = companionRoute<{ code: string }>(async ({ svc, json, params }) => svc.setModuleWeek(params.code, await json()));
