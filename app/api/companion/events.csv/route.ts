import { companionRoute } from "@/src/server";

export const dynamic = "force-dynamic";

/** The event log as CSV (facilitator only). */
export const GET = companionRoute(
	({ svc }) =>
		new Response(svc.eventsCsv(), {
			headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="companion-events.csv"', "Cache-Control": "no-store" },
		}),
	{ demoOnly: true },
);
