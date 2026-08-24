// tsc emits ESM into dist/esm but the package itself is CommonJS. Node needs a
// nested package.json to read those .js files as modules.
import { writeFileSync } from "node:fs";

writeFileSync("dist/esm/package.json", `${JSON.stringify({ type: "module" }, null, 2)}\n`);
