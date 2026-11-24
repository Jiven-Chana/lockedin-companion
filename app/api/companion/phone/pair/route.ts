import { companionRoute } from "@/src/server";

/** Pair (or show the pairing again): { url, qrSvg, …status }. The phone opens url (its token is in the fragment). */
export const POST = companionRoute(({ svc }) => svc.requirePhone().pair());
