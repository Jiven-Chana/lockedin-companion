import { companionRoute } from "@/src/server";

export const dynamic = "force-dynamic";

/** ?week=YYYY-MM-DD (default this week) → { week, target, blockMinutes, committedMinutes, proposedMinutes, blocks, lectures, commitments }. */
export const GET = companionRoute(({ svc, url }) => svc.plan(url.searchParams.get("week") ?? undefined));

/** { week? }: propose blocks to meet the target (replaces that week's earlier proposals) → plan + { roomMinutes, fits, message }. */
export const POST = companionRoute(async ({ svc, json }) => svc.proposePlan(await json()));
