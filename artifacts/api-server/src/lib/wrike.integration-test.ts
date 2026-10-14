// Development-only integration test. Never uses live Wrike credentials/API.
// Refuses to run if a real organization connection is present.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { db, pool, projectsTable, tasksTable, projectWrikeLinksTable, wrikeConnectionsTable, wrikeSyncRunsTable, wrikeTaskLinksTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { syncWrikeProject } from "./wrike-sync";
import { openWrikeToken, sealWrikeToken, validWrikeHost, wrikeConfig } from "./wrike-security";

async function main() {
  assert.equal((await db.select().from(wrikeConnectionsTable)).length, 0, "Refusing to replace an existing Wrike connection");
  process.env.WRIKE_CLIENT_ID = "fixture";
  process.env.WRIKE_CLIENT_SECRET = "fixture";
  process.env.WRIKE_TOKEN_KEY = randomBytes(32).toString("hex");
  process.env.PUBLIC_URL = "https://cue.obtv.io";
  assert.equal(wrikeConfig().redirectUri, "https://cue.obtv.io/api/integrations/wrike/callback");
  const encrypted = sealWrikeToken("fixture-token");
  assert.notEqual(encrypted, "fixture-token");
  assert.equal(openWrikeToken(encrypted), "fixture-token");
  assert.throws(() => openWrikeToken(encrypted + "tampered"));
  assert.throws(() => validWrikeHost("evil.example"));
  const [project] = await db.insert(projectsTable).values({ name: `Wrike test ${randomUUID()}` }).returning();
  const generation = randomUUID();
  let fail = false, renamed = false, refreshes = 0, pages = 0;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "login.wrike.com" && url.pathname === "/oauth2/token") {
      refreshes++;
      return Response.json({ access_token: "fixture-refreshed", refresh_token: "fixture-rotated", expires_in: 3600, host: "www.wrike.com" });
    }
    assert.equal(url.hostname, "www.wrike.com", "No arbitrary outbound hosts");
    assert.equal(init?.method ?? "GET", "GET", "No Wrike write requests");
    if (url.pathname === "/api/v4/folders/FIXTURE") return Response.json({ data: [{ id: "FIXTURE", title: "Pilot", permalink: "https://www.wrike.com/open.htm?id=fixture" }] });
    if (url.pathname.endsWith("/tasks")) {
      pages++;
      if (fail) return Response.json({ error: "denied" }, { status: 403 });
      const second = url.searchParams.get("nextPageToken") === "page2";
      return Response.json({
        data: [{ id: second ? "REMOTE2" : "REMOTE1", title: renamed ? "Changed" : "Original", status: second ? "Completed" : "Active", importance: "High", permalink: "https://www.wrike.com/open.htm?id=task" }],
        nextPageToken: second ? undefined : "page2",
      });
    }
    throw new Error(`Unexpected fixture API path ${url.pathname}`);
  };
  try {
    await db.insert(wrikeConnectionsTable).values({
      id: 1, generation, host: "www.wrike.com", accessToken: sealWrikeToken("fixture-old"),
      refreshToken: sealWrikeToken("fixture-refresh"), expiresAt: new Date(0), connectedBy: 0,
    });
    await db.insert(projectWrikeLinksTable).values({ projectId: project.id, remoteId: "FIXTURE", url: "https://www.wrike.com/open.htm?id=fixture", updatedBy: 0 });
    const [local] = await db.insert(tasksTable).values({ projectId: project.id, title: "Cue-only task" }).returning();
    const first = await syncWrikeProject(project.id, null);
    assert.equal(first.created, 2);
    assert.equal(pages, 2);
    assert.equal(refreshes, 1);
    const [conn] = await db.select().from(wrikeConnectionsTable);
    assert.equal(openWrikeToken(conn.refreshToken), "fixture-rotated");
    renamed = true;
    const second = await syncWrikeProject(project.id, null);
    assert.equal(second.created, 0);
    assert.equal(second.updated, 2);
    assert.equal((await db.select().from(tasksTable).where(eq(tasksTable.projectId, project.id))).length, 3);
    assert.equal((await db.select().from(tasksTable).where(eq(tasksTable.id, local.id)))[0].title, "Cue-only task");
    await db.update(projectWrikeLinksTable).set({ lockedUntil: new Date(Date.now() + 60000), lockToken: "other" }).where(eq(projectWrikeLinksTable.projectId, project.id));
    await assert.rejects(syncWrikeProject(project.id, null), /already running/);
    await db.update(projectWrikeLinksTable).set({ lockedUntil: null, lockToken: null }).where(eq(projectWrikeLinksTable.projectId, project.id));
    fail = true;
    await assert.rejects(syncWrikeProject(project.id, null), /permission/);
    const [link] = await db.select().from(projectWrikeLinksTable).where(eq(projectWrikeLinksTable.projectId, project.id));
    assert.equal(link.syncStatus, "error");
    assert.equal(link.lockToken, null);
    assert.equal((await db.select().from(tasksTable).where(eq(tasksTable.projectId, project.id))).length, 3);
    console.info("PASS: encryption/tampering, host guard, refresh rotation, pagination, idempotency, local-task preservation, sync overlap, durable failure");
  } finally {
    globalThis.fetch = previousFetch;
    await db.delete(wrikeTaskLinksTable).where(eq(wrikeTaskLinksTable.projectId, project.id));
    await db.delete(wrikeSyncRunsTable).where(eq(wrikeSyncRunsTable.projectId, project.id));
    await db.delete(tasksTable).where(eq(tasksTable.projectId, project.id));
    await db.delete(projectsTable).where(eq(projectsTable.id, project.id));
    await db.delete(wrikeConnectionsTable).where(and(eq(wrikeConnectionsTable.id, 1), eq(wrikeConnectionsTable.generation, generation)));
  }
}
main().finally(() => pool.end()).catch(() => { console.error("Wrike integration test failed"); process.exitCode = 1; });
