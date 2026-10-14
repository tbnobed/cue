// Development-only integration harness. All provider traffic is intercepted;
// this file is never imported by the application.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { createServer } from "node:http";
import { eq, inArray } from "drizzle-orm";
import {
  db, pool, releasesTable, releaseTemplatesTable, releaseSigningTable,
  releaseEventsTable, projectsTable, usersTable, activityTable,
  releaseLinksTable, releaseEnrollmentsTable,
} from "@workspace/db";
import signingRouter from "../routes/docuseal";
import releasesRouter from "../routes/releases";
import { releaseLinksRouter, publicReleaseLinksRouter } from "../routes/release-links";
import { logger } from "./logger";
import { getSubmission, downloadSignedPdf } from "./docuseal-client";
import { refreshSigning, readSigning, verifySubmission } from "./docuseal-signing";
import { releasePath, hashRelease, removeUncommittedRelease } from "./release-storage";
import fs from "node:fs/promises";
import { prefillReleaseFields } from "./docuseal-fields";

async function main() {
  process.env.DOCUSEAL_API_URL = "http://docuseal-fixture:3000";
  process.env.DOCUSEAL_PUBLIC_URL = "https://sign.fixture.invalid";
  process.env.DOCUSEAL_API_KEY = "test-only-not-a-real-credential";
  process.env.PUBLIC_URL = "https://cue.fixture.invalid";
  const prefix = randomUUID();
  const [owner, stranger] = await db.insert(usersTable).values([
    { name: `Signing owner ${prefix}`, email: `owner-${prefix}@example.invalid`, isActive: true },
    { name: `Signing stranger ${prefix}`, isActive: true },
  ]).returning();
  const [project] = await db.insert(projectsTable).values({ name: `Signing ${prefix}`, ownerUserId: owner.id }).returning();
  const created = await db.insert(releasesTable).values(Array.from({ length: 4 }, (_, i) => ({
    projectId: project.id, guestName: "Test Guest", guestEmail: `guest-${prefix}@example.invalid`,
    title: `Test release ${i}`, templateVersion: "draft", productionDate: "2026-10-14", createdBy: owner.id,
  }))).returning();
  const ids = created.map(r => r.id);
  const remoteTemplate = {
    id: 8765, name: "Approved test", updated_at: "2026-10-14T00:00:00Z", schema: [], archived_at: null,
    submitters: [{ name: "Guest", uuid: "g" }, { name: "Producer", uuid: "p" }],
    fields: [
      ...["Print Name", "Email", "Name of Program", "Date", "Address", "Phone number"].map(name => ({
        name, type: "text", submitter_uuid: "g", required: true,
      })),
      { name: "Print Name", type: "text", submitter_uuid: "p", required: true },
      { name: "Guest signature", type: "signature", submitter_uuid: "g", required: true },
      { name: "Producer signature", type: "signature", submitter_uuid: "p", required: true },
    ],
  };
  const records = new Map<number, any>();
  let nextId = 300, sends = 0, reminders = 0, breakPdf = false, timeoutSend = false;
  let lastPayload: any;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.ok(["docuseal-fixture", "sign.fixture.invalid"].includes(url.hostname), "Unexpected provider network request blocked");
    if (url.pathname.startsWith("/files/")) {
      assert.equal((init?.headers as any)?.["X-Auth-Token"], undefined);
      return new Response(breakPdf ? "not pdf" : "%PDF-1.7\nfixture signed document and audit\n%%EOF", { headers: { "Content-Type": "application/pdf" } });
    }
    assert.equal((init?.headers as any)?.["X-Auth-Token"], "test-only-not-a-real-credential");
    if (url.pathname.startsWith("/api/templates/")) return Response.json(remoteTemplate);
    if (url.pathname === "/api/submissions" && init?.method === "POST") {
      sends++; lastPayload = JSON.parse(init.body as string);
      const id = nextId++;
      records.set(id, {
        id, status: "pending", completed_at: null, combined_document_url: null,
        submitters: lastPayload.submitters.map((s: any, i: number) => ({
          id: id * 10 + i, role: s.role, name: s.name, email: s.email,
          external_id: s.external_id, status: "sent", completed_at: null,
        })),
      });
      if (timeoutSend) throw new Error("Simulated lost provider response");
      return Response.json(records.get(id).submitters.map((s: any) => ({ ...s, submission_id: id })));
    }
    if (url.pathname.startsWith("/api/submitters/")) { reminders++; return Response.json({}); }
    const id = Number(url.pathname.split("/").pop());
    assert.equal(url.searchParams.get("include"), "combined_document_url");
    assert.ok(records.has(id));
    return Response.json(records.get(id));
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const id = Number(req.headers["x-test-user"] || owner.id);
    req.authUser = { id, isActive: true, isAdmin: req.headers["x-test-admin"] === "yes" };
    req.log = logger;
    next();
  });
  app.use(signingRouter);
  app.use(releasesRouter);
  app.use(releaseLinksRouter);
  app.use(publicReleaseLinksRouter);
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const api = (path: string, method = "GET", body?: unknown, user = owner.id, admin = false) =>
    originalFetch(origin + path, {
      method, headers: { "Content-Type": "application/json", "x-test-user": String(user), "x-test-admin": admin ? "yes" : "no" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  let approvedId: number | undefined;
  try {
    assert.equal((await api("/admin/release-templates", "POST", { remoteId: 8765, version: "v1", guestRole: "Guest" })).status, 403);
    const approved = await api("/admin/release-templates", "POST", { remoteId: 8765, version: "v1", guestRole: "Guest" }, owner.id, true);
    assert.equal(approved.status, 201);
    approvedId = (await approved.json() as { id: number }).id;
    const body = { templateId: approvedId, signers: [{ role: "Producer", name: "Test Producer", email: `producer-${prefix}@example.invalid` }] };
    assert.equal((await api(`/releases/${ids[0]}/signing`, "GET", undefined, stranger.id)).status, 404);
    assert.equal((await api(`/releases/${ids[0]}/send`, "POST", body, stranger.id)).status, 404);
    assert.equal((await api(`/releases/${ids[0]}/signing`)).status, 200);
    assert.equal((await (await api(`/releases/${ids[0]}/signing`)).json() as { state: string }).state, "not_sent");
    assert.equal((await api(`/releases/${ids[0]}/send`, "POST", { templateId: approvedId, signers: [] })).status, 400);
    const responses = await Promise.all([api(`/releases/${ids[0]}/send`, "POST", body), api(`/releases/${ids[0]}/send`, "POST", body)]);
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
    assert.equal(sends, 1);
    assert.equal(lastPayload.bcc_completed, owner.email);
    assert.match(lastPayload.message.body, /\{\{submitter.link\}\}/);
    assert.equal(lastPayload.submitters[0].email, created[0].guestEmail);
    assert.deepEqual(lastPayload.submitters[0].fields.map((f: any) => f.name), ["Print Name", "Email", "Name of Program"]);
    assert.equal(lastPayload.submitters[0].fields.find((f: any) => f.name === "Name of Program").default_value, created[0].title);
    assert.deepEqual(prefillReleaseFields([
      { name: "Program Name", type: "text", submitter_uuid: "g" },
      { name: "ProjectName", type: "text", submitter_uuid: "g" },
    ], "g", "g", { ProjectName: "Parent project", ReleaseTitle: "Production title" }).map(f => f.default_value),
    ["Production title", "Parent project"], "Program uses release title; explicit ProjectName preserves project mapping");
    assert.equal(lastPayload.submitters[1].fields.length, 0, "Countersigner name must not receive guest identity");
    assert.deepEqual(prefillReleaseFields([
      { name: "GuestName", type: "text", submitter_uuid: "g" },
      { name: "ProductionDate", type: "date", submitter_uuid: "g" },
      { name: "Date signed", type: "date", submitter_uuid: "g" },
      { name: "Email", type: "signature", submitter_uuid: "g" },
    ], "g", "g", { GuestName: "Guest", ProductionDate: "2026-10-14", GuestEmail: "guest@example.invalid" }).map(f => f.name),
    ["GuestName", "ProductionDate"], "Canonical names still work; signing dates/signatures remain untouched");
    assert.ok(lastPayload.submitters[0].fields.every((f: any) => f.readonly && f.name !== "Guest signature"));
    const publicStatus = await (await api(`/releases/${ids[0]}/signing`)).json() as object;
    assert.ok(!("requestKey" in publicStatus));
    const edit = { guestName: "Tamper", guestEmail: "test@example.invalid", title: "Tamper", templateVersion: "v1", status: "signed" };
    assert.equal((await api(`/releases/${ids[0]}`, "PATCH", edit)).status, 409);
    assert.equal((await api(`/releases/${ids[0]}/archive`, "POST", {})).status, 409);
    const record = records.get(300);
    record.submitters[0].status = "completed"; record.submitters[0].completed_at = new Date().toISOString();
    assert.equal((await refreshSigning(ids[0], true)).state, "awaiting_signatures");
    assert.equal(reminders, 1, "Only the remaining signer is reminded");
    await refreshSigning(ids[0], true);
    assert.equal(reminders, 1, "Cooldown blocks duplicate reminders");
    assert.equal((await api(`/releases/${ids[0]}/signing/resend`, "POST")).status, 403, "Project owner cannot use admin override");
    assert.equal((await api(`/releases/${ids[0]}/signing/resend`, "POST", undefined, stranger.id)).status, 403);
    const sendsBeforeResend = sends;
    const resent = await api(`/releases/${ids[0]}/signing/resend`, "POST", undefined, owner.id, true);
    assert.equal(resent.status, 200);
    assert.equal((await resent.json() as { lastError: string | null }).lastError, null, "Admin resend clears cooldown error");
    assert.equal(reminders, 2, "Admin override only resends outstanding signer");
    assert.equal(sends, sendsBeforeResend, "Resend never creates a new submission");
    const audit = await db.select().from(releaseEventsTable).where(eq(releaseEventsTable.releaseId, ids[0]));
    assert.ok(audit.some(e => e.action === "docuseal:admin-resend-requested" && e.actorId === owner.id));
    await refreshSigning(ids[0], true);
    assert.equal(reminders, 2, "Normal reminders keep their cooldown after an override");
    const [partial] = await db.select().from(releasesTable).where(eq(releasesTable.id, ids[0]));
    assert.equal(partial.storageKey, null);
    record.status = "completed"; record.completed_at = new Date().toISOString();
    record.submitters[1].status = "completed"; record.submitters[1].completed_at = record.completed_at;
    record.combined_document_url = "https://sign.fixture.invalid/files/signed.pdf";
    breakPdf = true;
    assert.equal((await refreshSigning(ids[0])).state, "filing_failed");
    const [failed] = await db.select().from(releasesTable).where(eq(releasesTable.id, ids[0]));
    assert.equal(failed.status, "signed"); assert.equal(failed.storageKey, null);
    breakPdf = false;
    await Promise.all([refreshSigning(ids[0]), refreshSigning(ids[0])]);
    const [archived] = await db.select().from(releasesTable).where(eq(releasesTable.id, ids[0]));
    assert.equal(archived.status, "archived");
    assert.equal(hashRelease(await fs.readFile(releasePath(archived.storageKey!))), archived.sha256);
    assert.equal((await db.select().from(activityTable).where(eq(activityTable.projectId, project.id))).length, 1);
    assert.equal((await api(`/releases/${ids[0]}/file`, "GET", undefined, stranger.id)).status, 404);
    assert.equal((await api(`/releases/${ids[0]}/file`)).status, 200);
    remoteTemplate.updated_at = "2026-10-15T00:00:00Z";
    assert.equal((await api(`/releases/${ids[1]}/send`, "POST", body)).status, 409);
    remoteTemplate.updated_at = "2026-10-14T00:00:00Z";
    timeoutSend = true;
    const uncertain = await api(`/releases/${ids[1]}/send`, "POST", body);
    assert.equal((await uncertain.json() as { state: string }).state, "needs_review");
    timeoutSend = false;
    assert.equal((await api(`/releases/${ids[1]}/send`, "POST", body)).status, 409);
    assert.equal((await api(`/releases/${ids[1]}/signing/reconcile`, "POST", { submissionId: 300 })).status, 409);
    assert.equal((await api(`/releases/${ids[1]}/signing/reconcile`, "POST", { submissionId: 301 })).status, 200);
    const local = (await readSigning(ids[1]))!;
    const bad = await getSubmission(301);
    bad.submitters[0].external_id = "wrong-correlation";
    assert.throws(() => verifySubmission(bad, local));
    await assert.rejects(() => downloadSignedPdf("http://169.254.169.254/credentials"));
    const linkPath = `/projects/${project.id}/release-links`;
    const linkBody = { ...body, title: "Production-wide test", productionDate: "2026-10-17" };
    assert.equal((await api(linkPath, "POST", linkBody, stranger.id)).status, 404);
    assert.equal((await api(linkPath, "GET", undefined, stranger.id)).status, 404);
    assert.equal((await api(linkPath, "POST", { ...linkBody, signers: [] })).status, 400);
    assert.equal((await api(linkPath, "POST", { ...linkBody, productionDate: "2026-02-30" })).status, 400);
    const newLink = await api(linkPath, "POST", linkBody);
    assert.equal(newLink.status, 201);
    const shared = await newLink.json() as { id: number; url: string };
    assert.ok(shared.url.startsWith("https://cue.fixture.invalid/release-sign/"));
    const publicPath = `/public/release-links/${shared.url.split("/").pop()}`;
    const metadata = await api(publicPath);
    assert.equal(metadata.status, 200);
    assert.equal(metadata.headers.get("cache-control"), "no-store");
    assert.deepEqual(Object.keys(await metadata.json() as object).sort(), ["expiresAt", "productionDate", "projectName", "templateName", "templateVersion", "title"]);
    const person = { name: "Self Registered", email: `self-${prefix}@example.invalid`, consent: true };
    assert.equal((await api(publicPath + "/register", "POST", { ...person, consent: false })).status, 400);
    const before = sends;
    const results = await Promise.all([
      api(publicPath + "/register", "POST", person),
      api(publicPath + "/register", "POST", { ...person, email: person.email.toUpperCase() }),
    ]);
    assert.deepEqual(results.map(r => r.status), [202, 202]);
    assert.equal(sends, before + 1, "Concurrent public registrations send exactly one request");
    assert.equal(lastPayload.submitters[0].name, person.name);
    assert.equal(lastPayload.submitters[0].email, person.email);
    assert.equal(lastPayload.submitters[0].fields.find((f: any) => f.name === "Name of Program").default_value, linkBody.title, "Shared-link title fills program name");
    assert.equal(lastPayload.send_email, true);
    const [selfEnrollment] = await db.select().from(releaseEnrollmentsTable).where(eq(releaseEnrollmentsTable.linkId, shared.id));
    const selfSigning = (await readSigning(selfEnrollment.releaseId))!;
    const selfRemote = records.get(selfSigning.submissionId!);
    selfRemote.status = "completed"; selfRemote.completed_at = new Date().toISOString();
    selfRemote.combined_document_url = "https://sign.fixture.invalid/files/signed.pdf";
    selfRemote.submitters.forEach((s: any) => { s.status = "completed"; s.completed_at = selfRemote.completed_at; });
    assert.equal((await refreshSigning(selfEnrollment.releaseId)).state, "archived");
    assert.equal((await api(`/releases/${selfEnrollment.releaseId}/file`, "GET", undefined, stranger.id)).status, 404);
    assert.equal((await api(`/releases/${selfEnrollment.releaseId}/file`)).status, 200);
    timeoutSend = true;
    assert.equal((await api(publicPath + "/register", "POST", { ...person, email: `failure-${prefix}@example.invalid` })).status, 503);
    timeoutSend = false;
    const failedSendCount = sends;
    assert.equal((await api(publicPath + "/register", "POST", { ...person, email: `failure-${prefix}@example.invalid` })).status, 202);
    assert.equal(sends, failedSendCount, "Uncertain public registration must not resend");
    remoteTemplate.updated_at = "2026-10-15T00:00:00Z";
    assert.equal((await api(publicPath + "/register", "POST", { ...person, email: `changed-${prefix}@example.invalid` })).status, 409);
    remoteTemplate.updated_at = "2026-10-14T00:00:00Z";
    assert.equal((await api(`/release-links/${shared.id}`, "DELETE", undefined, stranger.id)).status, 404);
    assert.equal((await api(`/release-links/${shared.id}`, "DELETE")).status, 204);
    assert.equal((await api(publicPath)).status, 404);
    assert.equal((await api(publicPath + "/register", "POST", person)).status, 404);
    const expired = await (await api(linkPath, "POST", linkBody)).json() as { id: number; url: string };
    await db.update(releaseLinksTable).set({ expiresAt: new Date(0) }).where(eq(releaseLinksTable.id, expired.id));
    assert.equal((await api(`/public/release-links/${expired.url.split("/").pop()}`)).status, 404);
    console.log("PASS: production links, manager permissions, guest consent, private metadata, date validation, concurrent deduplication, prefill, public-signing archive, provider failures, changed templates, revoke and expiry");
    await api(`/admin/release-templates/${approvedId}`, "DELETE", undefined, owner.id, true);
    assert.equal((await api(`/releases/${ids[2]}/send`, "POST", body)).status, 400);
    console.log("PASS: permissions, approvals, required signers, immutable prefill, duplicate-send lock, reminders, all-signers gate, filing retry, checksum, protected downloads, template drift, uncertain-send reconciliation and URL restrictions");
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise<void>(resolve => server.close(() => resolve()));
    const files = await db.select().from(releasesTable).where(eq(releasesTable.projectId, project.id));
    ids.splice(0, ids.length, ...files.map(r => r.id));
    await db.delete(releaseEnrollmentsTable).where(inArray(releaseEnrollmentsTable.releaseId, ids));
    await db.delete(releaseLinksTable).where(eq(releaseLinksTable.projectId, project.id));
    for (const row of files) if (row.storageKey) await removeUncommittedRelease(row.storageKey);
    await db.delete(releaseSigningTable).where(inArray(releaseSigningTable.releaseId, ids));
    await db.delete(releaseEventsTable).where(inArray(releaseEventsTable.releaseId, ids));
    await db.delete(activityTable).where(eq(activityTable.projectId, project.id));
    await db.delete(releasesTable).where(inArray(releasesTable.id, ids));
    if (approvedId) await db.delete(releaseTemplatesTable).where(eq(releaseTemplatesTable.id, approvedId));
    await db.delete(projectsTable).where(eq(projectsTable.id, project.id));
    await db.delete(usersTable).where(inArray(usersTable.id, [owner.id, stranger.id]));
    await pool.end();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
