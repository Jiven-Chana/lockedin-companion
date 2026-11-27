/**
 * Copies the maths library (KaTeX) into the phone app, so the phone draws
 * maths with nothing loaded from another site and with no connection
 * (v2.3 part C). Run before every deploy (`npm run deploy` does it).
 *
 *   node scripts/vendor.mjs [out]     out defaults to relay/web/vendor
 *
 * Only the .woff2 fonts are copied: every phone that can install the app
 * reads them. `katex/files.json` lists what was copied; the service worker
 * keeps those files for offline use.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const out = path.resolve(process.argv[2] ?? path.join(here, "..", "web", "vendor"));
// The library is the repository's own copy, the one the laptop draws maths with.
const dist = path.join(path.dirname(createRequire(path.join(here, "..", "..", "package.json")).resolve("katex/package.json")), "dist");

const to = path.join(out, "katex");
fs.rmSync(to, { recursive: true, force: true });
fs.mkdirSync(path.join(to, "fonts"), { recursive: true });
const files = [];
for (const f of ["katex.min.js", "katex.min.css"]) {
	fs.copyFileSync(path.join(dist, f), path.join(to, f));
	files.push(`/vendor/katex/${f}`);
}
for (const f of fs.readdirSync(path.join(dist, "fonts")).filter((x) => x.endsWith(".woff2")).sort()) {
	fs.copyFileSync(path.join(dist, "fonts", f), path.join(to, "fonts", f));
	files.push(`/vendor/katex/fonts/${f}`);
}
fs.writeFileSync(path.join(to, "files.json"), JSON.stringify(files));
console.log(`maths library copied to ${to} (${files.length} files)`);
