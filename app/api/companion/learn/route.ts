import { companionRoute } from "@/src/server";

export const dynamic = "force-dynamic";

/** The module's start sheet (step 5): `?module=CODE` → one suggestion, the topics a typed goal is matched against, this week's lectures. */
export const GET = companionRoute(({ svc, url }) => svc.learnSheet(url.searchParams.get("module") ?? ""));

/** Start Learn (V-47): `{ lectureId, nodes?, goal? }` or `{ module, week: true, goal? }` → `{ sessionId }`. */
export const POST = companionRoute(async ({ svc, json }) => svc.startLearn(await json()));
