import { companionRoute } from "@/src/server";

/** "Delete all my data": one tap. Lecture materials stay; the student's records and sessions go. */
export const DELETE = companionRoute(({ svc }) => svc.deleteAll());
