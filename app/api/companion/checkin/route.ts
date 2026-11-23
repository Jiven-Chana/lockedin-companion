import { companionRoute } from "@/src/server";

export const dynamic = "force-dynamic";

/** The Sunday check-in (F-111): { started, minutes, text, target, nextWeek, roomMinutes, feelings }. */
export const GET = companionRoute(({ svc }) => svc.checkin());

/** { feeling } → { proposed, ask, keepLabel }; then { target } confirms or { keep: true } keeps → { target, plan }. */
export const POST = companionRoute(async ({ svc, json }) => svc.answerCheckin(await json()));
