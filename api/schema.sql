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

ALTER TABLE devices ADD COLUMN IF NOT EXISTS metrics jsonb;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS updates jsonb;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS make text;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS model text;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS serial text;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS software jsonb;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS ipv4 text;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS users jsonb;
UPDATE devices SET display_name = hostname WHERE display_name IS NULL OR btrim(display_name) = '';

CREATE TABLE IF NOT EXISTS device_samples (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id bigint NOT NULL REFERENCES orgs (id),
  device_id bigint NOT NULL REFERENCES devices (id),
  cpu_percent integer,
  memory_percent integer,
  disk_percent integer,
  sampled_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS device_samples_device_id_idx ON device_samples (device_id, id DESC);

ALTER TABLE customers ADD COLUMN IF NOT EXISTS contact_name text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS contact_email text;

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

CREATE TABLE IF NOT EXISTS tickets (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id bigint NOT NULL REFERENCES orgs (id),
  customer_id bigint NOT NULL REFERENCES customers (id),
  device_id bigint NOT NULL REFERENCES devices (id),
  assignee_user_id bigint REFERENCES users (id),
  subject text NOT NULL,
  status text NOT NULL,
  priority text NOT NULL,
  created_by bigint REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tickets_status_check CHECK (status IN ('open', 'pending', 'resolved')),
  CONSTRAINT tickets_priority_check CHECK (priority IN ('low', 'normal', 'high', 'urgent'))
);

CREATE INDEX IF NOT EXISTS tickets_org_id_idx ON tickets (org_id, id DESC);
CREATE INDEX IF NOT EXISTS tickets_customer_id_idx ON tickets (customer_id);
CREATE INDEX IF NOT EXISTS tickets_device_id_idx ON tickets (device_id);

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS ticket_id bigint REFERENCES tickets (id);

CREATE TABLE IF NOT EXISTS ticket_comments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id bigint NOT NULL REFERENCES orgs (id),
  ticket_id bigint NOT NULL REFERENCES tickets (id),
  author_user_id bigint REFERENCES users (id),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ticket_comments_ticket_id_idx ON ticket_comments (ticket_id, id);

CREATE TABLE IF NOT EXISTS org_slas (
  org_id bigint PRIMARY KEY REFERENCES orgs (id),
  response_minutes integer NOT NULL CHECK (response_minutes BETWEEN 1 AND 43200),
  resolve_minutes integer NOT NULL CHECK (resolve_minutes BETWEEN 1 AND 43200),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS alert_rules (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id bigint NOT NULL REFERENCES orgs (id),
  device_id bigint NOT NULL REFERENCES devices (id),
  metric text NOT NULL,
  threshold integer NOT NULL CHECK (threshold BETWEEN 1 AND 100),
  created_by bigint REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT alert_rules_metric_check CHECK (metric IN ('cpu', 'memory', 'disk'))
);

CREATE INDEX IF NOT EXISTS alert_rules_device_id_idx ON alert_rules (device_id);

CREATE TABLE IF NOT EXISTS alerts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id bigint NOT NULL REFERENCES orgs (id),
  rule_id bigint NOT NULL REFERENCES alert_rules (id),
  device_id bigint NOT NULL REFERENCES devices (id),
  metric text NOT NULL,
  value integer NOT NULL,
  threshold integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS alerts_org_id_idx ON alerts (org_id, id DESC);

ALTER TABLE alerts ADD COLUMN IF NOT EXISTS ticket_id bigint REFERENCES tickets (id);

CREATE TABLE IF NOT EXISTS patch_policies (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id bigint NOT NULL REFERENCES orgs (id),
  device_id bigint NOT NULL UNIQUE REFERENCES devices (id),
  name text NOT NULL,
  mode text NOT NULL,
  created_by bigint REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT patch_policies_mode_check CHECK (mode IN ('approve', 'auto'))
);

CREATE INDEX IF NOT EXISTS patch_policies_org_id_idx ON patch_policies (org_id);

CREATE TABLE IF NOT EXISTS patch_deploys (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id bigint NOT NULL REFERENCES orgs (id),
  policy_id bigint NOT NULL REFERENCES patch_policies (id),
  device_id bigint NOT NULL REFERENCES devices (id),
  package_name text NOT NULL,
  status text NOT NULL,
  created_by bigint REFERENCES users (id),
  approved_by bigint REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT patch_deploys_status_check CHECK (status IN ('waiting', 'queued', 'running', 'succeeded', 'failed'))
);

CREATE INDEX IF NOT EXISTS patch_deploys_org_id_idx ON patch_deploys (org_id, id);

ALTER TABLE patch_deploys ADD COLUMN IF NOT EXISTS detail text;
ALTER TABLE patch_deploys ADD COLUMN IF NOT EXISTS finished_at timestamptz;
ALTER TABLE patch_deploys DROP CONSTRAINT IF EXISTS patch_deploys_status_check;
ALTER TABLE patch_deploys ADD CONSTRAINT patch_deploys_status_check
  CHECK (status IN ('waiting', 'approved', 'queued', 'running', 'succeeded', 'failed'));
ALTER TABLE patch_deploys ALTER COLUMN policy_id DROP NOT NULL;
ALTER TABLE patch_deploys ADD COLUMN IF NOT EXISTS kb text;
ALTER TABLE patch_deploys ADD COLUMN IF NOT EXISTS severity text;
ALTER TABLE patch_deploys ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE patch_deploys ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE patch_deploys ADD COLUMN IF NOT EXISTS pushed_by bigint REFERENCES users (id);
ALTER TABLE patch_deploys ADD COLUMN IF NOT EXISTS pushed_at timestamptz;
ALTER TABLE patch_deploys ADD COLUMN IF NOT EXISTS restart_required boolean NOT NULL DEFAULT false;
ALTER TABLE patch_deploys ADD COLUMN IF NOT EXISTS restart_mode text;
ALTER TABLE patch_deploys ADD COLUMN IF NOT EXISTS restart_handled_at timestamptz;
ALTER TABLE patch_deploys DROP CONSTRAINT IF EXISTS patch_deploys_restart_mode_check;
ALTER TABLE patch_deploys ADD CONSTRAINT patch_deploys_restart_mode_check
  CHECK (restart_mode IS NULL OR restart_mode IN ('later', 'auto', 'ask'));
CREATE INDEX IF NOT EXISTS patch_deploys_device_id_idx ON patch_deploys (device_id, id);

ALTER TABLE devices ADD COLUMN IF NOT EXISTS reboot_pending boolean NOT NULL DEFAULT false;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS updates_checked_at timestamptz;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS update_scan_requested_at timestamptz;

CREATE TABLE IF NOT EXISTS patch_rules (
  org_id bigint NOT NULL REFERENCES orgs (id),
  category text NOT NULL,
  created_by bigint REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, category)
);

CREATE TABLE IF NOT EXISTS report_schedules (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id bigint NOT NULL UNIQUE REFERENCES orgs (id),
  interval_minutes integer NOT NULL,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT report_schedules_interval_check CHECK (interval_minutes BETWEEN 1 AND 1440)
);

CREATE TABLE IF NOT EXISTS report_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id bigint NOT NULL REFERENCES orgs (id),
  schedule_id bigint NOT NULL REFERENCES report_schedules (id),
  csv text NOT NULL,
  device_count integer NOT NULL,
  open_ticket_count integer NOT NULL,
  response_minutes integer,
  resolve_minutes integer,
  patched_count integer NOT NULL,
  missing_count integer NOT NULL,
  produced_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS report_runs_org_id_idx ON report_runs (org_id, id DESC);

ALTER TABLE users ADD COLUMN IF NOT EXISTS account_number bigint;
UPDATE users SET account_number = 900000000 + id WHERE account_number IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_account_number_idx ON users (account_number);

CREATE OR REPLACE FUNCTION users_set_account_number() RETURNS trigger AS $$
BEGIN
  UPDATE users SET account_number = 900000000 + NEW.id WHERE id = NEW.id AND account_number IS NULL;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_account_number ON users;
CREATE TRIGGER users_account_number
  AFTER INSERT ON users
  FOR EACH ROW
  EXECUTE FUNCTION users_set_account_number();

CREATE TABLE IF NOT EXISTS device_notices (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id bigint NOT NULL REFERENCES orgs (id),
  device_id bigint REFERENCES devices (id) ON DELETE SET NULL,
  hostname text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS device_notices_org_idx ON device_notices (org_id, id DESC);

CREATE TABLE IF NOT EXISTS device_notice_states (
  notice_id bigint NOT NULL REFERENCES device_notices (id) ON DELETE CASCADE,
  user_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  read_at timestamptz,
  deleted_at timestamptz,
  PRIMARY KEY (notice_id, user_id)
);

CREATE TABLE IF NOT EXISTS ribbon_notices (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id bigint REFERENCES orgs (id),
  body text NOT NULL,
  link_label text,
  link_url text,
  created_by bigint REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  active boolean NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS ribbon_notices_active_idx ON ribbon_notices (active, id DESC);

CREATE TABLE IF NOT EXISTS ribbon_dismissals (
  notice_id bigint NOT NULL REFERENCES ribbon_notices (id) ON DELETE CASCADE,
  user_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notice_id, user_id)
);

ALTER TABLE licenses ADD COLUMN IF NOT EXISTS support_concurrent integer NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS support_sessions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id bigint NOT NULL REFERENCES orgs (id),
  code text NOT NULL,
  status text NOT NULL DEFAULT 'waiting',
  topic text,
  customer_email text,
  ticket_id bigint REFERENCES tickets (id),
  mesh_group_id text,
  mesh_node_id text,
  hostname text,
  os_name text,
  notes text,
  created_by bigint REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  joined_at timestamptz,
  ended_at timestamptz,
  ended_by bigint REFERENCES users (id),
  CONSTRAINT support_sessions_status_check CHECK (status IN ('waiting', 'connected', 'ended', 'expired'))
);

CREATE UNIQUE INDEX IF NOT EXISTS support_sessions_live_code_idx
  ON support_sessions (code) WHERE status IN ('waiting', 'connected');
CREATE INDEX IF NOT EXISTS support_sessions_org_id_idx ON support_sessions (org_id, id);

ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled_at timestamptz;
