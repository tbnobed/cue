import path from "node:path";
import fs from "node:fs";

/**
 * Canonical uploads directory.
 *
 * The whole server is bundled by esbuild into a single file at
 * `artifacts/api-server/dist/index.mjs`, so `__dirname` resolves to that
 * `dist/` folder at runtime regardless of which source file referenced it.
 * Therefore `..` lands on `artifacts/api-server/`, and `uploads/` sits next
 * to `dist/` — matching the path the Docker compose volume mounts at
 * `/app/artifacts/api-server/uploads`.
 *
 * Historically each route file computed this path independently with subtly
 * different relative segments, which after bundling pointed at *different*
 * directories — so files were written to one place and served from another.
 * One module, one truth.
 */
export const uploadsDir = path.resolve(__dirname, "..", "uploads");

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
