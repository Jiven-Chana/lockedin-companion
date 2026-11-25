import { companionRoute } from "@/src/server";

/** Setup step 2. { calendar: { kind: "link", url } | { kind: "file", text } | { kind: "none" }, modules: [{ name, code? }], timeZone? } → the setup state. Makes the profile the first time. */
export const POST = companionRoute(async ({ svc, json }) => svc.setupTimetable(await json()));
