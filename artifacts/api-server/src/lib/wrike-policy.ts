import { db, usersTable, projectsTable, wrikeConnectionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { WrikeError } from "./wrike-security";

export async function checkWrikeSyncOwner(connectionId: number, projectId: number, reader: Pick<typeof db, "select"> = db) {
  const [connection] = await reader.select().from(wrikeConnectionsTable).where(eq(wrikeConnectionsTable.id, connectionId));
  if (!connection || connection.revokedAt) throw new WrikeError("The designated Wrike connection is disconnected. Reconnect it or take over sync with your own account.", 409);
  const [owner] = await reader.select().from(usersTable).where(eq(usersTable.id, connection.ownerUserId));
  const [project] = await reader.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!owner?.isActive || !project || (!owner.isAdmin && project.ownerUserId !== owner.id)) {
    throw new WrikeError("The sync owner is inactive or no longer manages this Cue project. An authorized manager must take over sync.", 409);
  }
  return connection;
}
