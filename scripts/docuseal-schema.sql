-- Additive development bootstrap; production uses the normal Drizzle migration.
CREATE TABLE IF NOT EXISTS release_templates (
  id serial PRIMARY KEY,
  remote_id integer NOT NULL,
  name text NOT NULL,
  version text NOT NULL,
  guest_role text NOT NULL,
  roles jsonb NOT NULL,
  fingerprint text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  approved_by integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS release_signing (
  release_id integer PRIMARY KEY REFERENCES releases(id) ON DELETE RESTRICT,
  template_id integer NOT NULL REFERENCES release_templates(id),
  request_key text NOT NULL UNIQUE,
  submission_id integer UNIQUE,
  state text NOT NULL DEFAULT 'sending',
  signers jsonb NOT NULL,
  last_error text,
  next_check_at timestamptz NOT NULL DEFAULT now(),
  last_reminder_at timestamptz,
  reminder_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
