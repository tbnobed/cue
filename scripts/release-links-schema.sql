-- Additive migration, safe to run repeatedly on existing Cue installations.
BEGIN;
CREATE TABLE IF NOT EXISTS release_links (
  id serial PRIMARY KEY,
  token text NOT NULL UNIQUE,
  project_id integer NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  template_id integer NOT NULL REFERENCES release_templates(id),
  title text NOT NULL,
  production_date date,
  signers jsonb NOT NULL,
  created_by integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE TABLE IF NOT EXISTS release_enrollments (
  id serial PRIMARY KEY,
  link_id integer NOT NULL REFERENCES release_links(id),
  email text NOT NULL,
  release_id integer NOT NULL REFERENCES releases(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS release_enrollments_link_email ON release_enrollments(link_id,email);
COMMIT;
