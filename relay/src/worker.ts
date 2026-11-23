/** The Cloudflare Worker entry (v0.1 F-112, decision O-1): HTTP plus a Cron Trigger every minute. */

import { cron, handle, type RelayEnv } from "./relay.ts";

export default {
	fetch: (req: Request, env: RelayEnv) => handle(req, env),
	scheduled: (_event: unknown, env: RelayEnv, ctx: { waitUntil(p: Promise<unknown>): void }) => ctx.waitUntil(cron(env)),
};
