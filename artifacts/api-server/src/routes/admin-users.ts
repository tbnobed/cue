import { Router } from "express";
import { db, usersTable } from "@workspace/db";
import { eq, asc, sql } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "../middlewares/require-auth";

const router = Router();

// All routes here require an admin session.
router.use("/admin/users", requireAdmin);

function fmt(u: typeof usersTable.$inferSelect) {
  // `sub` is set only by the OIDC upsert path; `passwordHash` is set only by
  // the local signup path. We surface this as a discriminated `authProvider`
  // so the UI can refuse promotion on OIDC rows (matches the server check).
  const authProvider: "local" | "oidc" = u.sub ? "oidc" : "local";
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    picture: u.picture,
    isAdmin: u.isAdmin,
    authProvider,
    createdAt: u.createdAt.toISOString(),
    lastLoginAt: u.lastLoginAt.toISOString(),
  };
}

// GET /api/admin/users — list every auth account.
router.get("/admin/users", async (_req, res) => {
  const rows = await db.select().from(usersTable).orderBy(asc(usersTable.id));
  res.json(rows.map(fmt));
});

const UpdateBody = z.object({
  isAdmin: z.boolean().optional(),
});

// PATCH /api/admin/users/:id — currently only toggles `isAdmin`.
//
// Invariants enforced here (defense-in-depth — UI also blocks these):
//   1. You cannot demote yourself. Otherwise the last admin can accidentally
//      strip their own rights and lock the org out of user management.
//   2. OIDC accounts (rows with a non-null `sub`) can NEVER be promoted. This
//      mirrors the OIDC callback which deliberately ignores `isAdmin` on
//      upsert — admin rights live exclusively with local accounts, so the
//      identity provider can't grant them.
router.patch("/admin/users/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }
  const parsed = UpdateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }

  const [target] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!target) { res.status(404).json({ error: "User not found" }); return; }

  if (parsed.data.isAdmin !== undefined) {
    if (id === req.session.userId && parsed.data.isAdmin === false) {
      res.status(400).json({ error: "You can't remove your own admin rights." });
      return;
    }
    if (parsed.data.isAdmin === true && target.sub) {
      res.status(400).json({ error: "OIDC accounts can't be promoted to admin." });
      return;
    }
    await db.update(usersTable)
      .set({ isAdmin: parsed.data.isAdmin })
      .where(eq(usersTable.id, id));
  }

  const [updated] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  res.json(fmt(updated!));
});

// DELETE /api/admin/users/:id — remove an auth account. Self-delete is
// forbidden so an admin can't accidentally evict themselves mid-session.
router.delete("/admin/users/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }
  if (id === req.session.userId) {
    res.status(400).json({ error: "You can't delete your own account." });
    return;
  }
  const [target] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, id));
  if (!target) { res.status(404).json({ error: "User not found" }); return; }

  await db.delete(usersTable).where(eq(usersTable.id, id));

  // Force-logout the deleted user by purging their connect-pg-simple session
  // rows. `sess` is a JSON column; we match on the embedded `userId`. This
  // closes the window where an already-issued cookie would otherwise stay
  // valid until expiry. `requireAuth` also re-checks the user exists on every
  // request, so this is defense-in-depth, not the only protection.
  await db.execute(
    sql`DELETE FROM user_sessions WHERE (sess->>'userId')::int = ${id}`,
  );

  res.status(204).send();
});

export default router;
