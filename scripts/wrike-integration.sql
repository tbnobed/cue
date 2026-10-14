-- Run after release-foundation.sql or the normal Drizzle schema migration.
BEGIN;
ALTER TABLE project_wrike_links ADD COLUMN IF NOT EXISTS remote_title text;
ALTER TABLE project_wrike_links ADD COLUMN IF NOT EXISTS auto_sync boolean NOT NULL DEFAULT false;
ALTER TABLE project_wrike_links ADD COLUMN IF NOT EXISTS sync_status text NOT NULL DEFAULT 'idle';
ALTER TABLE project_wrike_links ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;
ALTER TABLE project_wrike_links ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz;
ALTER TABLE project_wrike_links ADD COLUMN IF NOT EXISTS last_error text;
ALTER TABLE project_wrike_links ADD COLUMN IF NOT EXISTS lock_token text;
ALTER TABLE project_wrike_links ADD COLUMN IF NOT EXISTS locked_until timestamptz;
CREATE TABLE IF NOT EXISTS wrike_connections (
  id integer PRIMARY KEY, generation text NOT NULL, host text NOT NULL,
  access_token text NOT NULL, refresh_token text NOT NULL, expires_at timestamptz NOT NULL,
  connected_by integer NOT NULL, connected_at timestamptz NOT NULL DEFAULT now(), last_error text
);
CREATE TABLE IF NOT EXISTS wrike_task_links (
  id serial PRIMARY KEY, project_id integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  remote_id text NOT NULL, task_id integer NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  permalink text NOT NULL, remote_status text NOT NULL, last_synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS wrike_task_project_remote_unique ON wrike_task_links(project_id, remote_id);
CREATE TABLE IF NOT EXISTS wrike_sync_runs (
  id serial PRIMARY KEY, project_id integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'running', created integer NOT NULL DEFAULT 0,
  updated integer NOT NULL DEFAULT 0, skipped integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz, error text, actor_id integer
);
COMMIT;
