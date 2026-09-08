import { build } from "esbuild";
import { chmodSync, copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoBin = join(root, "..", "bin");
const outfile = join(repoBin, "universal-dashboard");

mkdirSync(repoBin, { recursive: true });

await build({
  entryPoints: [join(root, "src", "index.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile,
  banner: { js: "#!/usr/bin/env node" },
  // Keep Node built-ins external; bundle QuickJS JS into the binary.
  packages: "bundle",
  logLevel: "info",
});

const wasmSrc = require.resolve("@jitl/quickjs-wasmfile-release-sync/wasm");
const wasmDest = join(repoBin, "quickjs.wasm");
copyFileSync(wasmSrc, wasmDest);
chmodSync(outfile, 0o755);

console.log(`built ${outfile}`);
console.log(`copied ${wasmDest}`);
