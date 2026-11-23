import { companionRoute } from "@/src/server";

export const dynamic = "force-dynamic";

/** The AI connection, the three model slots, readiness and the catalogue to pick from (F-101). */
export const GET = companionRoute(({ svc }) => svc.requireAi().status());

/** ?provider=chatgpt|anthropic|openai|openrouter: sign out or delete the key; slots that used it are cleared. */
export const DELETE = companionRoute(({ svc, url, req }) => svc.requireAi().disconnect(url.searchParams.get("provider"), req));
