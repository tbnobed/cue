import { Router, type Request, type Response } from "express";
import { eq, and } from "drizzle-orm";
import { db, releasesTable, releaseTemplatesTable } from "@workspace/db";
import { ApproveReleaseTemplateBody, SendReleaseSigningBody, ReconcileReleaseSigningBody } from "@workspace/api-zod";
import { requireAdmin } from "../middlewares/require-auth";
import { requireProjectAccess, requireProjectManage } from "../lib/access";
import { docuseal, signingConfig, remoteTemplateSchema, templateFingerprint, SigningError, signingError } from "../lib/docuseal-client";
import { readSigning, publicSigning, sendForSigning, refreshSigning, reconcileSigning } from "../lib/docuseal-signing";

const router = Router();
function idOf(value: unknown) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
function fail(res: Response, error: unknown) {
  res.status(error instanceof SigningError ? error.status : 500).json({ error: signingError(error) });
}
async function authorize(req: Request, res: Response, manage: boolean) {
  const id = idOf(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid release ID." }); return null; }
  const [release] = await db.select().from(releasesTable).where(eq(releasesTable.id, id));
  if (!release) { res.status(404).json({ error: "Release not found." }); return null; }
  if (!(await (manage ? requireProjectManage : requireProjectAccess)(req, res, release.projectId))) return null;
  return id;
}
const templateView = (row: typeof releaseTemplatesTable.$inferSelect) => ({
  id: row.id, remoteId: row.remoteId, name: row.name, version: row.version, guestRole: row.guestRole, roles: row.roles,
});
router.get("/signing/config", (_req, res) => {
  const { configured, publicUrl } = signingConfig();
  res.json({ configured, publicUrl });
});
router.get("/release-templates", async (_req, res) => {
  res.json((await db.select().from(releaseTemplatesTable).where(eq(releaseTemplatesTable.active, true))).map(templateView));
});
router.post("/admin/release-templates", requireAdmin, async (req, res) => {
  const input = ApproveReleaseTemplateBody.safeParse(req.body);
  if (!input.success || !input.data.version.trim() || !input.data.guestRole.trim()) {
    res.status(400).json({ error: "Provide the DocuSeal template ID, version and exact guest role." }); return;
  }
  try {
    const parsed = remoteTemplateSchema.safeParse(await docuseal(`/templates/${input.data.remoteId}`));
    if (!parsed.success) throw new SigningError("DocuSeal returned invalid template details.");
    const template = parsed.data;
    const roles = template.submitters.map(s => s.name);
    if (template.archived_at) {
      throw new SigningError("This DocuSeal template is archived. Restore it in DocuSeal before approving it in Cue.", 400);
    }
    if (new Set(roles).size !== roles.length) {
      throw new SigningError("This DocuSeal template has duplicate role names. Give each signing role a distinct name in DocuSeal before approving it.", 400);
    }
    if (!roles.includes(input.data.guestRole)) {
      throw new SigningError(
        `Guest role "${input.data.guestRole}" does not match this template. Available DocuSeal roles: ${roles.map(role => JSON.stringify(role)).join(", ") || "(none)"}. Enter the exact role name assigned to the guest's signature field.`,
        400,
      );
    }
    for (const role of template.submitters) {
      if (!template.fields.some(f => f.submitter_uuid === role.uuid && f.type === "signature" && f.required !== false)) {
        throw new SigningError(`The ${role.name} role must have a required signature field.`, 400);
      }
    }
    const row = await db.transaction(async tx => {
      // New approval supersedes earlier approvals of this DocuSeal template;
      // existing signing records keep their original immutable association.
      await tx.update(releaseTemplatesTable).set({ active: false }).where(and(
        eq(releaseTemplatesTable.remoteId, template.id), eq(releaseTemplatesTable.active, true),
      ));
      const [created] = await tx.insert(releaseTemplatesTable).values({
        remoteId: template.id, version: input.data.version.trim(), guestRole: input.data.guestRole,
        name: template.name, roles, fingerprint: templateFingerprint(template), approvedBy: req.authUser!.id,
      }).returning();
      return created;
    });
    res.status(201).json(templateView(row));
  } catch (error) { fail(res, error); }
});
router.delete("/admin/release-templates/:id", requireAdmin, async (req, res) => {
  const id = idOf(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid template ID." }); return; }
  await db.update(releaseTemplatesTable).set({ active: false }).where(eq(releaseTemplatesTable.id, id));
  res.sendStatus(204);
});
router.get("/releases/:id/signing", async (req, res) => {
  const id = await authorize(req, res, false);
  if (id) res.json(publicSigning(await readSigning(id)));
});
router.post("/releases/:id/send", async (req, res) => {
  const id = await authorize(req, res, true);
  if (!id) return;
  const input = SendReleaseSigningBody.safeParse(req.body);
  if (!input.success || input.data.signers.some(p => !p.name.trim() || !p.role.trim())) {
    res.status(400).json({ error: "Choose an approved template and provide every additional signer's name and email." }); return;
  }
  try { res.json(await sendForSigning(id, input.data.templateId, input.data.signers, req.authUser!.id)); }
  catch (error) { fail(res, error); }
});
router.post("/releases/:id/signing/refresh", async (req, res) => {
  const id = await authorize(req, res, true);
  if (!id) return;
  try { res.json(await refreshSigning(id)); } catch (error) { fail(res, error); }
});
router.post("/releases/:id/signing/remind", async (req, res) => {
  const id = await authorize(req, res, true);
  if (!id) return;
  try { res.json(await refreshSigning(id, true)); } catch (error) { fail(res, error); }
});
router.post("/releases/:id/signing/reconcile", async (req, res) => {
  const id = await authorize(req, res, true);
  if (!id) return;
  const input = ReconcileReleaseSigningBody.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: "Provide the existing DocuSeal submission ID." }); return; }
  try { res.json(await reconcileSigning(id, input.data.submissionId)); }
  catch (error) { fail(res, error); }
});
export default router;
