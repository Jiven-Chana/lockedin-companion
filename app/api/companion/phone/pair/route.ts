import { companionRoute } from "@/src/server";

/** Pair (or show the pairing again): { url, qrSvg, code, codeExpiresAt, address, …status }. The phone scans url (its token is in the fragment); an iPhone's Home Screen app asks for the 6-digit code (v1.0.3). */
export const POST = companionRoute(({ svc }) => svc.requirePhone().pair());
