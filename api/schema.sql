CREATE TABLE IF NOT EXISTS orgs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS licenses (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id bigint NOT NULL UNIQUE REFERENCES orgs (id),
  plan text NOT NULL,
  seats integer NOT NULL CHECK (seats > 0),
  device_cap integer NOT NULL CHECK (device_cap >= 0),
  expires_at timestamptz,
  modules jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT licenses_modules_object CHECK (jsonb_typeof(modules) = 'object')
);

CREATE TABLE IF NOT EXISTS customers (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id bigint NOT NULL REFERENCES orgs (id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS customers_org_id_idx ON customers (org_id);

CREATE TABLE IF NOT EXISTS sites (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id bigint NOT NULL REFERENCES orgs (id),
  customer_id bigint NOT NULL REFERENCES customers (id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sites_org_id_idx ON sites (org_id);
CREATE INDEX IF NOT EXISTS sites_customer_id_idx ON sites (customer_id);

CREATE TABLE IF NOT EXISTS users (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id bigint REFERENCES orgs (id),
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  is_platform_admin boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS users_org_id_idx ON users (org_id);

CREATE TABLE IF NOT EXISTS roles (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id bigint NOT NULL REFERENCES orgs (id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

CREATE INDEX IF NOT EXISTS roles_org_id_idx ON roles (org_id);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id bigint NOT NULL REFERENCES users (id),
  role_id bigint NOT NULL REFERENCES roles (id),
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS devices (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id bigint NOT NULL REFERENCES orgs (id),
  site_id bigint REFERENCES sites (id),
  hostname text NOT NULL,
  os_name text,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE devices ADD COLUMN IF NOT EXISTS agent_token_hash text;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS mesh_node_id text;
CREATE UNIQUE INDEX IF NOT EXISTS devices_agent_token_hash_idx ON devices (agent_token_hash);

CREATE INDEX IF NOT EXISTS devices_org_id_idx ON devices (org_id);
CREATE INDEX IF NOT EXISTS devices_site_id_idx ON devices (site_id);

CREATE TABLE IF NOT EXISTS enroll_tokens (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id bigint NOT NULL REFERENCES orgs (id),
  token_hash text NOT NULL UNIQUE,
  created_by bigint REFERENCES users (id),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS enroll_tokens_org_id_idx ON enroll_tokens (org_id);

CREATE TABLE IF NOT EXISTS jobs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id bigint NOT NULL REFERENCES orgs (id),
  device_id bigint NOT NULL REFERENCES devices (id),
  command text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  exit_code integer,
  output text,
  created_by bigint REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS jobs_device_id_idx ON jobs (device_id, id DESC);

CREATE TABLE IF NOT EXISTS audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id bigint REFERENCES orgs (id),
  actor_user_id bigint REFERENCES users (id),
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_events_org_id_idx ON audit_events (org_id);
CREATE INDEX IF NOT EXISTS audit_events_actor_user_id_idx ON audit_events (actor_user_id);
CREATE INDEX IF NOT EXISTS audit_events_created_at_idx ON audit_events (created_at DESC);
