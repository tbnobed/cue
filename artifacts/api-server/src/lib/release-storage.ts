import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { uploadsDir } from "./uploads-dir";

// Keep releases outside the general document/editor routes, on the same
// self-hosted persistent volume. No external storage service is required.
const directory = path.join(uploadsDir, "release-archive");
export const hashRelease = (data: Buffer) => createHash("sha256").update(data).digest("hex");
export function releasePath(key: string) {
  if (!/^[a-f0-9-]+\.pdf$/.test(key)) throw new Error("Invalid archive storage key");
  return path.join(directory, key);
}
export async function storeRelease(data: Buffer) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const key = `${randomUUID()}.pdf`;
  const target = releasePath(key);
  try {
    const handle = await fs.open(target, "wx", 0o600);
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    const sha256 = hashRelease(data);
    if (hashRelease(await fs.readFile(target)) !== sha256) throw new Error("Archive verification failed");
    return { key, sha256 };
  } catch (error) {
    await fs.unlink(target).catch(() => {});
    throw error;
  }
}
export async function removeUncommittedRelease(key: string) {
  await fs.unlink(releasePath(key)).catch(() => {});
}
