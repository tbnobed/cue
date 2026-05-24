import { logger } from "./logger.js";

/**
 * Transparent format conversion via Collabora's `/cool/convert-to/<fmt>` HTTP
 * endpoint. Used to bypass LibreOffice's CSV "Text Import" dialog by serving
 * CSVs as XLSX through WOPI and converting back on save.
 *
 * The Collabora endpoint is anonymous on the docker-internal network (it's
 * not exposed to the public proxy — see `collabora-proxy.ts` which only
 * forwards `/collabora/*`, not `/cool/convert-to/*`).
 *
 * Conversions are cached by `(fileId, mtimeMs, fromExt, toExt)` so repeated
 * opens of an unmodified file don't re-pay the conversion cost. The cache
 * is in-memory, bounded, and per-process — this is fine for a single-replica
 * deploy. If you scale out, the cache just becomes per-replica (correctness
 * is preserved via the mtimeMs key).
 */

const CACHE_MAX_ENTRIES = 64;
const CACHE_MAX_BYTES = 64 * 1024 * 1024; // 64 MiB total

type CacheKey = string;
type CacheEntry = { buf: Buffer; bytes: number };
const cache = new Map<CacheKey, CacheEntry>();
let cacheBytes = 0;

function cacheKey(fileId: number, mtimeMs: number, fromExt: string, toExt: string): CacheKey {
  return `${fileId}:${mtimeMs}:${fromExt}>${toExt}`;
}

function cacheGet(key: CacheKey): Buffer | null {
  const hit = cache.get(key);
  if (!hit) return null;
  // LRU bump
  cache.delete(key);
  cache.set(key, hit);
  return hit.buf;
}

function cachePut(key: CacheKey, buf: Buffer): void {
  // Evict oldest until we have room (LRU = first-inserted in Map iteration).
  while (
    cache.size >= CACHE_MAX_ENTRIES ||
    cacheBytes + buf.length > CACHE_MAX_BYTES
  ) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    const evicted = cache.get(oldest);
    cache.delete(oldest);
    if (evicted) cacheBytes -= evicted.bytes;
  }
  cache.set(key, { buf, bytes: buf.length });
  cacheBytes += buf.length;
}

function upstream(): string {
  return (process.env.COLLABORA_UPSTREAM_URL || "http://collabora:9980").replace(/\/$/, "");
}

/**
 * Convert a buffer from `fromExt` to `toExt` using Collabora's convert-to
 * endpoint. Returns the converted bytes, or throws.
 *
 * `fileId` / `mtimeMs` are used only for caching — pass the source file's id
 * and on-disk mtime so cache entries invalidate when the file changes.
 */
export async function convertOffice(
  src: Buffer,
  fromExt: string,
  toExt: string,
  fileId: number,
  mtimeMs: number,
): Promise<Buffer> {
  const key = cacheKey(fileId, mtimeMs, fromExt, toExt);
  const cached = cacheGet(key);
  if (cached) return cached;

  const url = `${upstream()}/cool/convert-to/${encodeURIComponent(toExt)}`;
  const form = new FormData();
  // Filename hint helps Collabora pick the correct input filter.
  form.append("data", new Blob([new Uint8Array(src)]), `file.${fromExt}`);

  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", body: form });
  } catch (err) {
    logger.error({ err: (err as Error).message, url }, "convert-to network error");
    throw new Error(`convert-to ${fromExt}>${toExt} failed: ${(err as Error).message}`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    logger.error({ status: res.status, body: body.slice(0, 200) }, "convert-to non-2xx");
    throw new Error(`convert-to ${fromExt}>${toExt} HTTP ${res.status}`);
  }
  const out = Buffer.from(await res.arrayBuffer());
  logger.info(
    { fromExt, toExt, srcBytes: src.length, outBytes: out.length, ms: Date.now() - started },
    "convert-to ok",
  );
  cachePut(key, out);
  return out;
}

/** True if `ext` is a format we transparently re-serve as something else. */
export function shouldTranscodeOnRead(ext: string): { servedExt: string } | null {
  // LibreOffice's CSV import dialog can't be suppressed via WOPI/URL params,
  // so we serve CSVs as XLSX and convert back on save.
  if (ext === "csv") return { servedExt: "xlsx" };
  if (ext === "tsv") return { servedExt: "xlsx" };
  return null;
}

export function invalidateCacheForFile(fileId: number): void {
  for (const key of [...cache.keys()]) {
    if (key.startsWith(`${fileId}:`)) {
      const e = cache.get(key);
      cache.delete(key);
      if (e) cacheBytes -= e.bytes;
    }
  }
}
