import { companionRoute } from "@/src/server";

/**
 * v0.1 (J1′): { calendar: { kind: "sample" | "link" | "file" | "none", url?, text? }, modules: [{ name, code? }], nudgesPerDay? }
 * → profile, reads, calendar import counts, first-taste card.
 * v0.0 body { modules?: string[], timetableSource?, nudgesPerDay? } still works (scenarios, tests).
 */
export const POST = companionRoute(async ({ svc, json }) => svc.onboarding(await json()));
