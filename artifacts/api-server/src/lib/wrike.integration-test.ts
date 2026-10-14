// Isolated development DB test; provider requests are simulated, never live.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { db, pool, usersTable, projectsTable, tasksTable, projectWrikeLinksTable as links, wrikeConnectionsTable as connections, wrikeSyncRunsTable as jobs } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { enqueueWrikeSync, claimWrikeJob, processWrikeJob, recoverWrikeJobs } from "./wrike-queue";
import { personalWrikeConnection } from "./wrike-client";
import { sealWrikeToken, openWrikeToken, validWrikeHost } from "./wrike-security";
import express from "express";
import { createServer } from "node:http";
import wrikeLinksRouter from "../routes/wrike-links";

async function main() {
  assert.equal((await db.select().from(connections)).length, 0, "Use development DB without real Wrike connections");
  process.env.WRIKE_CLIENT_ID = "fixture";
  process.env.WRIKE_CLIENT_SECRET = "fixture";
  process.env.WRIKE_TOKEN_KEY = randomBytes(32).toString("hex");
  process.env.PUBLIC_URL = "https://cue.obtv.io";
  const encrypted = sealWrikeToken("test");
  assert.equal(openWrikeToken(encrypted), "test");
  assert.throws(() => openWrikeToken(encrypted + "tampered"));
  assert.throws(() => validWrikeHost("evil.example"));
  const prefix = randomUUID();
  const users = await db.insert(usersTable).values(Array.from({ length: 500 }, (_, i) => ({ name: `Wrike test ${prefix} ${i}` }))).returning();
  const projectRows = await db.insert(projectsTable).values(users.map(u => ({ name: `Wrike test ${prefix}`, ownerUserId: u.id }))).returning();
  const previousFetch = globalThis.fetch;
  const harness = express();
  harness.use(express.json());
  // Test-only harness, never mounted by the production app.
  harness.use((req, _res, next) => {
    req.authUser = { id: Number(req.headers["x-test-user"]), isAdmin: false, isActive: true };
    next();
  });
  harness.use(wrikeLinksRouter);
  const server = createServer(harness);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  let rateLimit = false, pages = 0, refreshes = 0;
  const seen = new Set<string>();
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "login.wrike.com") {
      const form = new URLSearchParams(String(init?.body));
      assert.equal(form.get("refresh_token"), `refresh-${users[0].id}`);
      refreshes++;
      return Response.json({ access_token: `user-${users[0].id}`, refresh_token: "fixture-rotated", expires_in: 3600, host: "www.wrike.com" });
    }
    assert.equal(url.hostname, "www.wrike.com");
    assert.equal(init?.method ?? "GET", "GET");
    const token = (init?.headers as Record<string, string>).Authorization;
    seen.add(token);
    if (rateLimit) return Response.json({}, { status: 429, headers: { "Retry-After": "120" } });
    const id = url.pathname.split("/")[4];
    if (!url.pathname.endsWith("/tasks")) return Response.json({ data: [{ id, title: "Parent folder", permalink: "https://www.wrike.com/open.htm?id=fixture" }] });
    pages++;
    const second = url.searchParams.has("nextPageToken");
    return Response.json({ data: [{ id: second ? "TASK2" : "TASK1", title: "Imported", status: "Active", importance: "High", permalink: "https://www.wrike.com/open.htm?id=fixture" }], nextPageToken: second ? undefined : "second" });
  };
  try {
    const conns = await db.insert(connections).values(users.map(u => ({
      ownerUserId: u.id, generation: randomUUID(), host: "www.wrike.com", accessToken: sealWrikeToken(`user-${u.id}`),
      refreshToken: sealWrikeToken(`refresh-${u.id}`), expiresAt: u.id === users[0].id ? new Date(0) : new Date(Date.now() + 3600000), connectedBy: u.id,
    }))).returning();
    await db.insert(links).values(projectRows.map((p, i) => ({
      projectId: p.id, remoteId: `FIXTURE${i}`, url: "https://www.wrike.com/open.htm?id=fixture",
      updatedBy: users[i].id, connectionId: conns[i].id, revision: randomUUID(),
    })));
    assert.equal((await personalWrikeConnection(users[0].id)).id, conns[0].id);
    assert.notEqual((await personalWrikeConnection(users[1].id)).id, conns[0].id);
    const p = projectRows[0].id;
    await db.insert(tasksTable).values({ projectId: p, title: "Cue-only" });
    const queued = await enqueueWrikeSync(p, users[0].id);
    assert.equal((await enqueueWrikeSync(p, users[0].id))!.id, queued!.id);
    await processWrikeJob((await claimWrikeJob())!);
    assert.equal(pages, 2);
    assert.equal(refreshes, 1);
    assert.equal(openWrikeToken((await personalWrikeConnection(users[0].id)).refreshToken), "fixture-rotated");
    assert.ok(seen.has(`Bearer user-${users[0].id}`));
    assert.equal((await db.select().from(tasksTable).where(eq(tasksTable.projectId, p))).length, 3);
    await enqueueWrikeSync(p, users[0].id);
    await processWrikeJob((await claimWrikeJob())!);
    assert.equal((await db.select().from(tasksTable).where(eq(tasksTable.projectId, p))).length, 3);
    await enqueueWrikeSync(projectRows[1].id, users[1].id);
    await processWrikeJob((await claimWrikeJob())!);
    assert.ok(seen.has(`Bearer user-${users[1].id}`));
    const transfer = (userId: number, confirmVisibility: boolean) => previousFetch(`http://127.0.0.1:${port}/projects/${p}/wrike-takeover`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-test-user": String(userId) }, body: JSON.stringify({ confirmVisibility }),
    });
    assert.equal((await transfer(users[1].id, true)).status, 404);
    const oldOwnerJob = await enqueueWrikeSync(p, users[0].id);
    await db.update(projectsTable).set({ ownerUserId: users[1].id }).where(eq(projectsTable.id, p));
    assert.equal((await transfer(users[1].id, false)).status, 400);
    assert.equal((await transfer(users[1].id, true)).status, 200);
    assert.equal((await db.select().from(jobs).where(eq(jobs.id, oldOwnerJob!.id)))[0].status, "cancelled");
    assert.equal((await db.select().from(links).where(eq(links.projectId, p)))[0].connectionId, conns[1].id);
    await enqueueWrikeSync(p, users[1].id);
    await processWrikeJob((await claimWrikeJob())!);
    assert.equal((await db.select().from(tasksTable).where(eq(tasksTable.projectId, p))).length, 3);
    await db.update(projectsTable).set({ ownerUserId: users[0].id }).where(eq(projectsTable.id, p));
    assert.equal((await transfer(users[0].id, true)).status, 200);
    rateLimit = true;
    await enqueueWrikeSync(p, users[0].id);
    const limited = (await claimWrikeJob())!;
    await processWrikeJob(limited);
    const [retry] = await db.select().from(jobs).where(eq(jobs.id, limited.id));
    assert.equal(retry.status, "retry_wait");
    assert.ok(retry.availableAt.getTime() > Date.now() + 110000);
    rateLimit = false;
    await db.update(jobs).set({ status: "cancelled" }).where(eq(jobs.id, limited.id));
    await db.update(usersTable).set({ isActive: false }).where(eq(usersTable.id, users[1].id));
    await assert.rejects(enqueueWrikeSync(projectRows[1].id, users[1].id), /inactive/);
    await db.update(usersTable).set({ isActive: true }).where(eq(usersTable.id, users[1].id));
    // Two projects using the same connection may never run together.
    const [extra] = await db.insert(projectsTable).values({ name: `Wrike test ${prefix}`, ownerUserId: users[0].id }).returning();
    await db.insert(links).values({ projectId: extra.id, remoteId: "FIXTURE_EXTRA", url: "https://www.wrike.com/open.htm?id=fixture", updatedBy: users[0].id, connectionId: conns[0].id, revision: randomUUID() });
    projectRows.push(extra);
    await enqueueWrikeSync(extra.id, users[0].id);
    // Queue 500 isolated owners; cap must hold with concurrent claimers.
    for (const project of projectRows) await enqueueWrikeSync(project.id, project.ownerUserId);
    const claimed = (await Promise.all(Array.from({ length: 8 }, () => claimWrikeJob()))).filter(Boolean);
    assert.equal(claimed.length, 4);
    assert.equal(new Set(claimed.map(j => j!.connectionId)).size, 4);
    const abandoned = claimed[0]!;
    await db.update(jobs).set({ leaseUntil: new Date(0) }).where(eq(jobs.id, abandoned.id));
    await recoverWrikeJobs();
    assert.equal((await db.select().from(jobs).where(eq(jobs.id, abandoned.id)))[0].status, "retry_wait");
    // Claimed job may not commit after ownership/link revision changes.
    const stale = claimed[1]!;
    await db.update(links).set({ revision: randomUUID() }).where(eq(links.projectId, stale.projectId));
    await processWrikeJob(stale);
    assert.equal((await db.select().from(jobs).where(eq(jobs.id, stale.id)))[0].status, "error");
    console.info("PASS: 500-owner queue, personal tokens, pagination, idempotence, Cue-only preservation, 4-global worker cap, rate-limit cooldown/retry, deactivation, lease recovery, stale-owner rejection, encryption.");
  } finally {
    globalThis.fetch = previousFetch;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    const pids = projectRows.map(p => p.id);
    await db.delete(tasksTable).where(inArray(tasksTable.projectId, pids));
    await db.delete(projectsTable).where(inArray(projectsTable.id, pids));
    await db.delete(usersTable).where(inArray(usersTable.id, users.map(u => u.id)));
  }
}
main().finally(() => pool.end()).catch(error => { console.error(error instanceof Error ? error.message : "Test failed"); process.exitCode = 1; });
