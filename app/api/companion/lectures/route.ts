import { companionRoute } from "@/src/server";

export const dynamic = "force-dynamic";

/** Lectures with status (answered / revisit / not-started). ?module=HCI&q=personas */
export const GET = companionRoute(({ svc, url }) => ({
	lectures: svc.lectures({ module: url.searchParams.get("module"), q: url.searchParams.get("q") }),
}));
