import { companionRoute } from "@/src/server";

export const dynamic = "force-dynamic";

export const GET = companionRoute(({ svc }) => ({ blocks: svc.blocks() }));

/** Replace the weekly blocks (at most 2). Body: StudyBlock[] or { blocks }. */
export const PUT = companionRoute(async ({ svc, json }) => {
	const body = await json();
	return { blocks: svc.saveBlocks(Array.isArray(body) ? body : (body as { blocks?: unknown }).blocks) };
});
