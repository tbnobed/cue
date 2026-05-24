import { Router } from "express";
import { db } from "@workspace/db";
import { membersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  CreateMemberBody,
  UpdateMemberParams,
  UpdateMemberBody,
  DeleteMemberParams,
} from "@workspace/api-zod";
import { linkMemberToUserByEmail } from "../lib/access.js";

const router = Router();

// The team directory is intentionally global to all authenticated users —
// project members need to discover one another (e.g. to assign a task).
// Per-project visibility lives on tasks/projects, not on the roster.
router.get("/members", async (_req, res): Promise<void> => {
  const members = await db.select().from(membersTable).orderBy(membersTable.name);
  res.json(members.map(fmt));
});

router.post("/members", async (req, res): Promise<void> => {
  const parsed = CreateMemberBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [m] = await db.insert(membersTable).values(parsed.data).returning();
  // If the roster entry has an email and a matching user exists, bind them
  // now (so that user immediately sees projects this member is on, without
  // waiting for their next login).
  if (m.email) {
    try { await linkMemberToUserByEmail(m.id, m.email); }
    catch (err) { req.log.error({ err, memberId: m.id }, "linkMemberToUserByEmail failed (create)"); }
  }
  res.status(201).json(fmt(m));
});

router.patch("/members/:id", async (req, res): Promise<void> => {
  const { id } = UpdateMemberParams.parse(req.params);
  const parsed = UpdateMemberBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [m] = await db.update(membersTable).set(parsed.data).where(eq(membersTable.id, id)).returning();
  if (!m) { res.status(404).json({ error: "Not found" }); return; }
  // Email changed → re-attempt link (only takes effect if user_id is NULL).
  if (parsed.data.email && m.email) {
    try { await linkMemberToUserByEmail(m.id, m.email); }
    catch (err) { req.log.error({ err, memberId: m.id }, "linkMemberToUserByEmail failed (update)"); }
  }
  res.json(fmt(m));
});

router.delete("/members/:id", async (req, res): Promise<void> => {
  const { id } = DeleteMemberParams.parse(req.params);
  await db.delete(membersTable).where(eq(membersTable.id, id));
  res.status(204).send();
});

function fmt(m: typeof membersTable.$inferSelect) {
  return {
    id: m.id,
    name: m.name,
    email: m.email ?? null,
    role: m.role,
    department: m.department ?? null,
    avatarUrl: m.avatarUrl ?? null,
    title: m.title ?? null,
    phone: m.phone ?? null,
    mobilePhone: m.mobilePhone ?? null,
    location: m.location ?? null,
    company: m.company ?? null,
    notes: m.notes ?? null,
    preApproved: m.preApproved,
    userId: m.userId ?? null,
    createdAt: m.createdAt.toISOString(),
  };
}

export default router;
