import { companionRoute } from "@/src/server";

/** { step: 2–5 }: the step the student has reached, so a closed tab reopens there → the setup state. */
export const POST = companionRoute(async ({ svc, json }) => svc.setupStep(await json()));
