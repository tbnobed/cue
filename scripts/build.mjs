import path from "node:path";
import { fileURLToPath } from "node:url";
import { rm } from "node:fs/promises";
import { build as esbuild } from "esbuild";

const dir = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(dir, "dist");
await rm(distDir, { recursive: true, force: true });

await esbuild({
  entryPoints: [path.resolve(dir, "src/create-admin.ts")],
  outdir: distDir,
  platform: "node",
  bundle: true,
  format: "esm",
  outExtension: { ".js": ".mjs" },
  logLevel: "info",
  external: ["*.node", "pg-native"],
  banner: {
    js: `import { createRequire as __cr } from 'node:module';
globalThis.require = __cr(import.meta.url);`,
  },
});
