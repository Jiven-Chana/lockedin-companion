import { companionRoute } from "@/src/server";

/** { url }: subscribe to a calendar link (https:// or webcal://). The server fetches it with network guards. */
export const POST = companionRoute(async ({ svc, json }) => svc.subscribeCalendar(((await json()) as { url?: unknown }).url));
