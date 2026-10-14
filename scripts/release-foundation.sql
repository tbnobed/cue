-- Additive, repeatable migration for existing self-hosted installations.
-- Does not modify existing document storage or historical records.
BEGIN;
CREATE TABLE IF NOT EXISTS releases (
  id serial PRIMARY KEY,
  project_id integer NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  guest_name text NOT NULL, guest_email text NOT NULL,
  title text NOT NULL, template_version text NOT NULL,
  production_date date,
  status text NOT NULL DEFAULT 'draft',
  notes text NOT NULL DEFAULT '',
  storage_key text, file_name text, sha256 text, file_size bigint,
  created_by integer NOT NULL, archived_by integer,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS project_wrike_links (
  project_id integer PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  remote_id text NOT NULL UNIQUE, url text NOT NULL,
  updated_by integer NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS release_events (
  id serial PRIMARY KEY,
  release_id integer NOT NULL REFERENCES releases(id) ON DELETE RESTRICT,
  actor_id integer NOT NULL, action text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
