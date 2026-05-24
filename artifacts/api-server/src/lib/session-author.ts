import type { Request } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/**
 * Returns the authenticated user's id and display name from the session.
 * Authorship must always be server-derived to prevent spoofing.
 * Routes that call this MUST be mounted behind `requireAuth`.
 */
export async function getSessionAuthor(req: Request): Promise<{ id: number; name: string | null }> {
  const id = req.session?.userId;
  if (!id) throw new Error("getSessionAuthor: no session userId (route not behind requireAuth?)");
  const [u] = await db.select({ name: usersTable.name, email: usersTable.email })
    .from(usersTable).where(eq(usersTable.id, id));
  return { id, name: u?.name ?? u?.email ?? null };
}
