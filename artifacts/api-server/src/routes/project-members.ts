import { Router } from "express";
import { db } from "@workspace/db";
import { projectMembersTable, membersTable, projectsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import {
  ListProjectMembersParams,
  AddProjectMemberParams,
  AddProjectMemberBody,
  RemoveProjectMemberParams,
} from "@workspace/api-zod";

const router = Router();

router.get("/projects/:projectId/members", async (req, res): Promise<void> => {
  const { projectId } = ListProjectMembersParams.parse(req.params);
  const rows = await db
    .select({
      id: projectMembersTable.id,
      projectId: projectMembersTable.projectId,
      memberId: projectMembersTable.memberId,
      projectRole: projectMembersTable.projectRole,
      createdAt: projectMembersTable.createdAt,
      name: membersTable.name,
      email: membersTable.email,
      role: membersTable.role,
      department: membersTable.department,
      avatarUrl: membersTable.avatarUrl,
    })
    .from(projectMembersTable)
    .innerJoin(membersTable, eq(membersTable.id, projectMembersTable.memberId))
    .where(eq(projectMembersTable.projectId, projectId))
    .orderBy(membersTable.name);
  res.json(rows.map(fmt));
});

router.post("/projects/:projectId/members", async (req, res): Promise<void> => {
  const { projectId } = AddProjectMemberParams.parse(req.params);
  const parsed = AddProjectMemberBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [project] = await db.select({ id: projectsTable.id }).from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }
  const [member] = await db.select({ id: membersTable.id }).from(membersTable).where(eq(membersTable.id, parsed.data.memberId));
  if (!member) { res.status(404).json({ error: "Member not found" }); return; }

  // Atomic insert — DB unique index on (project_id, member_id) is the source
  // of truth. ON CONFLICT DO NOTHING returns zero rows on duplicate, which we
  // translate to a clean 409 (no chance of 500 on a concurrent double-add).
  const inserted = await db
    .insert(projectMembersTable)
    .values({
      projectId,
      memberId: parsed.data.memberId,
      projectRole: parsed.data.projectRole ?? null,
    })
    .onConflictDoNothing({ target: [projectMembersTable.projectId, projectMembersTable.memberId] })
    .returning({ id: projectMembersTable.id });
  if (inserted.length === 0) { res.status(409).json({ error: "Member already assigned to project" }); return; }

  const [row] = await db
    .select({
      id: projectMembersTable.id,
      projectId: projectMembersTable.projectId,
      memberId: projectMembersTable.memberId,
      projectRole: projectMembersTable.projectRole,
      createdAt: projectMembersTable.createdAt,
      name: membersTable.name,
      email: membersTable.email,
      role: membersTable.role,
      department: membersTable.department,
      avatarUrl: membersTable.avatarUrl,
    })
    .from(projectMembersTable)
    .innerJoin(membersTable, eq(membersTable.id, projectMembersTable.memberId))
    .where(and(
      eq(projectMembersTable.projectId, projectId),
      eq(projectMembersTable.memberId, parsed.data.memberId),
    ));

  res.status(201).json(fmt(row));
});

router.delete("/projects/:projectId/members/:memberId", async (req, res): Promise<void> => {
  const { projectId, memberId } = RemoveProjectMemberParams.parse(req.params);
  await db.delete(projectMembersTable).where(and(
    eq(projectMembersTable.projectId, projectId),
    eq(projectMembersTable.memberId, memberId),
  ));
  res.status(204).send();
});

type Row = {
  id: number;
  projectId: number;
  memberId: number;
  projectRole: string | null;
  createdAt: Date;
  name: string;
  email: string | null;
  role: string;
  department: string | null;
  avatarUrl: string | null;
};

function fmt(r: Row) {
  return {
    id: r.id,
    projectId: r.projectId,
    memberId: r.memberId,
    projectRole: r.projectRole ?? null,
    createdAt: r.createdAt.toISOString(),
    name: r.name,
    email: r.email ?? null,
    role: r.role,
    department: r.department ?? null,
    avatarUrl: r.avatarUrl ?? null,
  };
}

export default router;
