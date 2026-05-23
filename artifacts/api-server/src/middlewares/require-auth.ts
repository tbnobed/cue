import type { Request, Response, NextFunction } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.session?.userId) {
    next();
    return;
  }
  res.status(401).json({ error: "Authentication required" });
}

// Use to gate destructive / privileged routes. Only LOCAL admin accounts pass.
export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
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
