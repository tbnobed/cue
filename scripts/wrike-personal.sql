-- Non-destructive upgrade from the shared Wrike connection. Run with the
-- old app STOPPED so no legacy scheduler imports while ownership changes.
BEGIN;
CREATE SEQUENCE IF NOT EXISTS wrike_connections_id_seq;
ALTER SEQUENCE wrike_connections_id_seq OWNED BY wrike_connections.id;
ALTER TABLE wrike_connections ALTER COLUMN id SET DEFAULT nextval('wrike_connections_id_seq');
SELECT setval('wrike_connections_id_seq', GREATEST(COALESCE((SELECT max(id) FROM wrike_connections), 0) + 1, 1), false);
ALTER TABLE wrike_connections ADD COLUMN IF NOT EXISTS owner_user_id integer;
UPDATE wrike_connections SET owner_user_id = connected_by WHERE owner_user_id IS NULL;
ALTER TABLE wrike_connections ALTER COLUMN owner_user_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS wrike_connection_owner_unique ON wrike_connections(owner_user_id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wrike_connections_owner_user_id_users_id_fk') THEN
    ALTER TABLE wrike_connections ADD CONSTRAINT wrike_connections_owner_user_id_users_id_fk
      FOREIGN KEY(owner_user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
END $$;
ALTER TABLE wrike_connections ADD COLUMN IF NOT EXISTS cooldown_until timestamptz;
ALTER TABLE wrike_connections ADD COLUMN IF NOT EXISTS revoked_at timestamptz;
ALTER TABLE wrike_connections ADD COLUMN IF NOT EXISTS next_request_at timestamptz;
ALTER TABLE project_wrike_links ADD COLUMN IF NOT EXISTS connection_id integer;
ALTER TABLE project_wrike_links ADD COLUMN IF NOT EXISTS revision text NOT NULL DEFAULT 'legacy';
ALTER TABLE project_wrike_links ADD COLUMN IF NOT EXISTS next_sync_at timestamptz;
-- Assign only unmigrated links to the ORIGINAL connecting user's connection.
UPDATE project_wrike_links
SET connection_id = (SELECT id FROM wrike_connections WHERE id = 1),
    revision = gen_random_uuid()::text,
    auto_sync = false, sync_status = 'paused',
    last_error = 'Shared connection migrated. Review sync ownership and project audience before enabling imports.',
    lock_token = NULL, locked_until = NULL
WHERE revision = 'legacy';
ALTER TABLE wrike_sync_runs ADD COLUMN IF NOT EXISTS connection_id integer;
ALTER TABLE wrike_sync_runs ADD COLUMN IF NOT EXISTS link_revision text;
ALTER TABLE wrike_sync_runs ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
ALTER TABLE wrike_sync_runs ADD COLUMN IF NOT EXISTS available_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE wrike_sync_runs ADD COLUMN IF NOT EXISTS lease_token text;
ALTER TABLE wrike_sync_runs ADD COLUMN IF NOT EXISTS lease_until timestamptz;
UPDATE wrike_sync_runs SET status = 'error', finished_at = now(),
  error = 'Legacy sync interrupted by migration. Retry from Cue.'
WHERE status = 'running' AND connection_id IS NULL;
CREATE INDEX IF NOT EXISTS wrike_jobs_due_idx ON wrike_sync_runs(status, available_at);
CREATE UNIQUE INDEX IF NOT EXISTS wrike_one_active_job ON wrike_sync_runs(project_id)
  WHERE status IN ('queued', 'running', 'retry_wait');
COMMIT;
