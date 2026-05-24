import type { Request, Response, NextFunction } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// Augment Express so downstream handlers can read `req.authUser` without
// re-querying the users table. Populated by `requireAuth`.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      authUser?: { id: number; isAdmin: boolean };
    }
  }
}

/**
 * Gate authenticated routes.
 *
 * In addition to checking for a `userId` on the session, we look the user up
 * in the DB on every request. This is the only safe way to revoke a session
 * server-side without invalidating every cookie: if an admin deletes the user
 * (or future code disables them), the next request fails closed and the
 * stale session is destroyed.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const id = req.session?.userId;
  if (!id) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const [user] = await db
    .select({ id: usersTable.id, isAdmin: usersTable.isAdmin })
    .from(usersTable)
    .where(eq(usersTable.id, id));
  if (!user) {
    // The session points at a user that no longer exists (deleted by an
    // admin). Destroy the stale session and force re-auth.
    req.session.destroy(() => {
      res.status(401).json({ error: "Authentication required" });
    });
    return;
  }
  req.authUser = user;
  next();
}

// Use to gate destructive / privileged routes. Only LOCAL admin accounts pass.
export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  // `requireAuth` has already attached `authUser`. We still fall back to a
  // direct DB read for safety in case this middleware is wired up standalone.
  const cached = req.authUser;
  if (cached) {
    if (!cached.isAdmin) {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    next();
    return;
  }
  const id = req.session?.userId;
  if (!id) { res.status(401).json({ error: "Authentication required" }); return; }
  const [user] = await db.select({ isAdmin: usersTable.isAdmin })
    .from(usersTable).where(eq(usersTable.id, id));
  if (!user?.isAdmin) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}
