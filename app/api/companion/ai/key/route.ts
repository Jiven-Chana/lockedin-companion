import { companionRoute } from "@/src/server";

/** { provider: "anthropic" | "openai" | "openrouter", key }: checked with the provider, then saved → AI status. */
export const POST = companionRoute(async ({ svc, json }) => {
	const b = (await json()) as { provider?: unknown; key?: unknown };
	return svc.requireAi().connectKey(b.provider, b.key);
});
