import { companionRoute } from "@/src/server";

/** Unpair: deletes everything the relay holds for this pair, then forgets it here. */
export const POST = companionRoute(({ svc }) => svc.requirePhone().unpair());
