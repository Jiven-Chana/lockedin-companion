import { companionRoute } from "@/src/server";

export const dynamic = "force-dynamic";

/** This week, welcome back, and the roadmap. Never "overdue", never a streak (R-6). */
export const GET = companionRoute(({ svc }) => svc.progress());
