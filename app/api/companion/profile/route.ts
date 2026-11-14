import { companionRoute } from "@/src/server";

export const dynamic = "force-dynamic";

export const GET = companionRoute(({ svc }) => ({ profile: svc.profile() }));

/** Partial update: { prefs?: {...}, appearance?: {...} }. */
export const PUT = companionRoute(async ({ svc, json }) => svc.updateProfile(await json()));
