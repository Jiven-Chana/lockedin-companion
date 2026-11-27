/**
 * Writes the look's colours into the phone app's stylesheet, between its
 * two marks. Run after changing a colour in src/core/companion/look.ts:
 *
 *   npx tsx relay/scripts/look.ts
 *
 * tests/companion-look.test.ts fails until the stylesheet matches.
 */
import fs from "node:fs";
import path from "node:path";
import { PHONE_LOOK_MARKS, phoneLookCss } from "../../src/core/companion/look.ts";

const file = path.join(import.meta.dirname, "..", "web", "styles.css");
const css = fs.readFileSync(file, "utf-8");
const [start, end] = PHONE_LOOK_MARKS;
const a = css.indexOf(start), b = css.indexOf(end);
if (a < 0 || b < 0) throw new Error(`${file} has lost its look marks`);
fs.writeFileSync(file, css.slice(0, a) + phoneLookCss() + css.slice(b + end.length));
console.log("the phone's colours are written");
