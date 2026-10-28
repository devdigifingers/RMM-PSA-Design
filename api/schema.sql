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
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
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

ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_secret text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enabled_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_recovery jsonb;
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS require_mfa boolean NOT NULL DEFAULT false;
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS ip_allowlist text[] NOT NULL DEFAULT '{}';

ALTER TABLE orgs ADD COLUMN IF NOT EXISTS mesh_group_id text;
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS mesh_users jsonb;

ALTER TABLE devices ADD COLUMN IF NOT EXISTS agent_version text;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS agent_update_requested_at timestamptz;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS agent_update_offered_at timestamptz;

ALTER TABLE customers ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'company';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS website text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS alt_phone text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS registration_number text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS vat_number text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customers_kind_check') THEN
    ALTER TABLE customers ADD CONSTRAINT customers_kind_check CHECK (kind IN ('company', 'sole_proprietor', 'other'));
  END IF;
END $$;

-- Skipped while an org still has duplicate names; the API rejects new duplicates either way.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'customers_org_name_key')
     AND NOT EXISTS (SELECT 1 FROM customers GROUP BY org_id, lower(name) HAVING count(*) > 1) THEN
    CREATE UNIQUE INDEX customers_org_name_key ON customers (org_id, lower(name));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS contacts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id bigint NOT NULL REFERENCES orgs (id),
  customer_id bigint NOT NULL REFERENCES customers (id),
  name text NOT NULL,
  email text,
  phone text,
  alt_phone text,
  job_title text,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contacts_org_id_idx ON contacts (org_id);
CREATE INDEX IF NOT EXISTS contacts_customer_id_idx ON contacts (customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS contacts_one_primary_idx ON contacts (customer_id) WHERE is_primary;

INSERT INTO contacts (org_id, customer_id, name, email, is_primary)
SELECT c.org_id, c.id, c.contact_name, c.contact_email, true
FROM customers c
WHERE c.contact_name IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM contacts ct WHERE ct.customer_id = c.id);

UPDATE customers c
SET contact_name = NULL, contact_email = NULL
WHERE c.contact_name IS NOT NULL
  AND EXISTS (SELECT 1 FROM contacts ct WHERE ct.customer_id = c.id);

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS contact_id bigint REFERENCES contacts (id);
CREATE INDEX IF NOT EXISTS tickets_contact_id_idx ON tickets (contact_id);

ALTER TABLE enroll_tokens ADD COLUMN IF NOT EXISTS customer_id bigint REFERENCES customers (id);

ALTER TABLE devices ADD COLUMN IF NOT EXISTS contact_id bigint REFERENCES contacts (id);
CREATE INDEX IF NOT EXISTS devices_contact_id_idx ON devices (contact_id);
ALTER TABLE tickets ALTER COLUMN device_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS packages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  features text[] NOT NULL DEFAULT '{}',
  default_seats integer NOT NULL CHECK (default_seats > 0),
  default_devices integer NOT NULL CHECK (default_devices >= 0),
  default_sessions integer NOT NULL CHECK (default_sessions >= 0),
  price_monthly numeric(12, 2),
  currency text NOT NULL DEFAULT 'ZAR',
  active boolean NOT NULL DEFAULT true,
  is_custom boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT packages_features_known CHECK (
    features <@ ARRAY['enrollment', 'remote_sessions', 'remote_support', 'monitoring', 'patching', 'ticketing', 'reporting']::text[]
  )
);

INSERT INTO packages (code, name, description, features, default_seats, default_devices, default_sessions)
VALUES
  ('REMOTE', 'Remote Desk', 'Remote monitoring and support',
   ARRAY['enrollment', 'remote_sessions', 'remote_support', 'monitoring', 'patching'], 5, 50, 1),
  ('SERVICE', 'Service Desk', 'Tickets and customer support',
   ARRAY['ticketing'], 5, 0, 0),
  ('SUITE', 'Digital Fingers Suite', 'Remote Desk and Service Desk',
   ARRAY['enrollment', 'remote_sessions', 'remote_support', 'monitoring', 'patching', 'ticketing'], 10, 100, 2)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE licenses ADD COLUMN IF NOT EXISTS package_id bigint REFERENCES packages (id);
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS seats_override integer CHECK (seats_override > 0);
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS devices_override integer CHECK (devices_override >= 0);
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS sessions_override integer CHECK (sessions_override >= 0);
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS features_added text[] NOT NULL DEFAULT '{}';
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS features_removed text[] NOT NULL DEFAULT '{}';
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS no_expiry boolean NOT NULL DEFAULT false;
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS updated_by bigint REFERENCES users (id);
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS licenses_package_id_idx ON licenses (package_id);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'licenses_status_check') THEN
    ALTER TABLE licenses ADD CONSTRAINT licenses_status_check CHECK (status IN ('active', 'suspended'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'licenses_no_expiry_check') THEN
    ALTER TABLE licenses ADD CONSTRAINT licenses_no_expiry_check CHECK (NOT (no_expiry AND expires_at IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'licenses_features_known') THEN
    ALTER TABLE licenses ADD CONSTRAINT licenses_features_known CHECK (
      features_added <@ ARRAY['enrollment', 'remote_sessions', 'remote_support', 'monitoring', 'patching', 'ticketing', 'reporting']::text[]
      AND features_removed <@ ARRAY['enrollment', 'remote_sessions', 'remote_support', 'monitoring', 'patching', 'ticketing', 'reporting']::text[]
    );
  END IF;
END $$;

-- The package model replaced these; limits and module flags are now derived from the package.
ALTER TABLE licenses DROP CONSTRAINT IF EXISTS licenses_modules_object;
ALTER TABLE licenses DROP COLUMN IF EXISTS modules;
ALTER TABLE licenses DROP COLUMN IF EXISTS seats;
ALTER TABLE licenses DROP COLUMN IF EXISTS device_cap;
ALTER TABLE licenses DROP COLUMN IF EXISTS support_concurrent;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM licenses WHERE package_id IS NULL) THEN
    ALTER TABLE licenses ALTER COLUMN package_id SET NOT NULL;
  END IF;
END $$;

ALTER TABLE ribbon_notices ADD COLUMN IF NOT EXISTS starts_at timestamptz;
ALTER TABLE ribbon_notices ADD COLUMN IF NOT EXISTS ends_at timestamptz;
ALTER TABLE ribbon_notices ADD COLUMN IF NOT EXISTS unpublished_at timestamptz;
ALTER TABLE ribbon_notices ADD COLUMN IF NOT EXISTS unpublished_by bigint REFERENCES users (id);
CREATE INDEX IF NOT EXISTS audit_events_action_idx ON audit_events (action);

CREATE TABLE IF NOT EXISTS sla_plans (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id bigint NOT NULL REFERENCES orgs (id),
  name text NOT NULL,
  response_minutes integer NOT NULL CHECK (response_minutes BETWEEN 1 AND 43200),
  resolve_minutes integer NOT NULL CHECK (resolve_minutes BETWEEN 1 AND 43200),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sla_plans_org_name_key ON sla_plans (org_id, lower(name));

-- NULL sla_plan_id means the tenant default in org_slas.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS sla_plan_id bigint REFERENCES sla_plans (id);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS contract_start date;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS contract_end date;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS contract_notes text;
CREATE INDEX IF NOT EXISTS customers_sla_plan_id_idx ON customers (sla_plan_id);
CREATE INDEX IF NOT EXISTS audit_events_target_idx ON audit_events (target_type, target_id);

-- 'note' comments are internal: never emailed, never shown to customers.
ALTER TABLE ticket_comments ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'reply';
-- Shown instead of "System" when an automation wrote the comment.
ALTER TABLE ticket_comments ADD COLUMN IF NOT EXISTS author_label text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ticket_comments_kind_check') THEN
    ALTER TABLE ticket_comments ADD CONSTRAINT ticket_comments_kind_check CHECK (kind IN ('reply', 'note'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS ticket_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id bigint NOT NULL REFERENCES orgs (id),
  ticket_id bigint NOT NULL REFERENCES tickets (id),
  kind text NOT NULL,
  actor_user_id bigint REFERENCES users (id),
  actor_label text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ticket_events_ticket_idx ON ticket_events (ticket_id, created_at, id);
CREATE INDEX IF NOT EXISTS ticket_events_org_kind_idx ON ticket_events (org_id, kind, created_at);

CREATE OR REPLACE FUNCTION ticket_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ticket_events is append-only';
END $$;
DROP TRIGGER IF EXISTS ticket_events_append_only ON ticket_events;
CREATE TRIGGER ticket_events_append_only BEFORE UPDATE OR DELETE ON ticket_events
  FOR EACH ROW EXECUTE FUNCTION ticket_events_append_only();

-- Uploaded first, then linked to a ticket and comment when the reply or ticket is saved.
CREATE TABLE IF NOT EXISTS ticket_attachments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id bigint NOT NULL REFERENCES orgs (id),
  ticket_id bigint REFERENCES tickets (id),
  comment_id bigint REFERENCES ticket_comments (id),
  uploaded_by bigint REFERENCES users (id),
  file_name text NOT NULL,
  content_type text NOT NULL,
  is_image boolean NOT NULL DEFAULT false,
  size_bytes integer NOT NULL CHECK (size_bytes > 0),
  storage_key text NOT NULL UNIQUE,
  linked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ticket_attachments_ticket_idx ON ticket_attachments (ticket_id);
CREATE INDEX IF NOT EXISTS ticket_attachments_comment_idx ON ticket_attachments (comment_id);
CREATE INDEX IF NOT EXISTS ticket_attachments_pending_idx ON ticket_attachments (created_at) WHERE linked_at IS NULL;

CREATE TABLE IF NOT EXISTS ticket_time_entries (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id bigint NOT NULL REFERENCES orgs (id),
  ticket_id bigint NOT NULL REFERENCES tickets (id),
  user_id bigint REFERENCES users (id),
  minutes integer NOT NULL CHECK (minutes BETWEEN 1 AND 1440),
  billable boolean NOT NULL DEFAULT true,
  note text,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'timer')),
  started_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ticket_time_entries_ticket_idx ON ticket_time_entries (ticket_id, id);
CREATE INDEX IF NOT EXISTS ticket_time_entries_org_idx ON ticket_time_entries (org_id, created_at);

CREATE TABLE IF NOT EXISTS ticket_timers (
  org_id bigint NOT NULL REFERENCES orgs (id),
  ticket_id bigint NOT NULL REFERENCES tickets (id),
  user_id bigint NOT NULL REFERENCES users (id),
  started_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ticket_id, user_id)
);

-- One-time backfill so existing tickets start with a timeline.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ticket_events) THEN
    INSERT INTO ticket_events (org_id, ticket_id, kind, actor_user_id, actor_label, detail, created_at)
    SELECT t.org_id, t.id, 'created', t.created_by,
           CASE WHEN t.created_by IS NOT NULL THEN NULL
                WHEN t.subject LIKE 'Offline on %' THEN 'Offline monitor'
                WHEN t.subject LIKE 'Missing %' THEN 'Patch monitor'
                ELSE NULL END,
           jsonb_build_object('backfilled', true), t.created_at
    FROM tickets t;

    INSERT INTO ticket_events (org_id, ticket_id, kind, actor_user_id, actor_label, detail, created_at)
    SELECT tc.org_id, tc.ticket_id, tc.kind, tc.author_user_id,
           CASE WHEN tc.author_user_id IS NULL AND tc.body LIKE 'Missing %' THEN 'Patch monitor' END,
           jsonb_build_object('commentId', tc.id, 'backfilled', true), tc.created_at
    FROM ticket_comments tc;

    INSERT INTO ticket_events (org_id, ticket_id, kind, actor_user_id, actor_label, detail, created_at)
    SELECT org_id, ticket_id, field, actor_user_id, NULL,
           jsonb_build_object('from', prev, 'to', value, 'backfilled', true), created_at
    FROM (
      SELECT e.org_id, t.id AS ticket_id, e.actor_user_id, e.created_at, e.action, f.field, e.detail->>f.key AS value,
             LAG(e.detail->>f.key) OVER (PARTITION BY t.id, f.field ORDER BY e.id) AS prev,
             ROW_NUMBER() OVER (PARTITION BY t.id, f.field ORDER BY e.id) AS seq
      FROM audit_events e
      JOIN tickets t ON e.target_id ~ '^[0-9]+$' AND t.id = e.target_id::bigint AND t.org_id = e.org_id
      CROSS JOIN (VALUES ('status', 'status'), ('priority', 'priority'), ('assignee', 'assigneeUserId')) AS f (field, key)
      WHERE e.target_type = 'ticket' AND e.action IN ('ticket.create', 'ticket.update') AND e.detail ? f.key
    ) changes
    WHERE action = 'ticket.update' AND seq > 1 AND value IS DISTINCT FROM prev;

    INSERT INTO ticket_events (org_id, ticket_id, kind, actor_user_id, actor_label, detail, created_at)
    SELECT e.org_id, t.id, CASE e.action WHEN 'ticket.breach' THEN 'sla_breach' ELSE 'email' END, NULL, NULL,
           jsonb_build_object('template', CASE e.action WHEN 'ticket.breach' THEN 'breach' ELSE 'new_ticket' END, 'backfilled', true),
           e.created_at
    FROM audit_events e
    JOIN tickets t ON e.target_id ~ '^[0-9]+$' AND t.id = e.target_id::bigint AND t.org_id = e.org_id
    WHERE e.target_type = 'ticket' AND e.action IN ('ticket.breach', 'ticket.mail');

    INSERT INTO ticket_events (org_id, ticket_id, kind, actor_user_id, actor_label, detail, created_at)
    SELECT e.org_id, t.id, 'remote_start', e.actor_user_id, NULL,
           jsonb_build_object('deviceId', e.target_id::bigint, 'user', e.detail->>'user', 'backfilled', true), e.created_at
    FROM audit_events e
    JOIN tickets t ON (e.detail->>'ticketId') ~ '^[0-9]+$' AND t.id = (e.detail->>'ticketId')::bigint AND t.org_id = e.org_id
    WHERE e.action = 'remote.launch' AND e.target_id ~ '^[0-9]+$';

    INSERT INTO ticket_events (org_id, ticket_id, kind, actor_user_id, actor_label, detail, created_at)
    SELECT j.org_id, j.ticket_id, 'command', j.created_by, NULL,
           jsonb_build_object('jobId', j.id, 'command', j.command, 'deviceId', j.device_id, 'backfilled', true), j.created_at
    FROM jobs j JOIN tickets t ON t.id = j.ticket_id AND t.org_id = j.org_id;

    INSERT INTO ticket_events (org_id, ticket_id, kind, actor_user_id, actor_label, detail, created_at)
    SELECT j.org_id, j.ticket_id, 'command_result', NULL, d.hostname,
           jsonb_build_object('jobId', j.id, 'exitCode', j.exit_code, 'output', left(COALESCE(j.output, ''), 4000), 'backfilled', true),
           j.finished_at
    FROM jobs j
    JOIN tickets t ON t.id = j.ticket_id AND t.org_id = j.org_id
    JOIN devices d ON d.id = j.device_id
    WHERE j.status = 'finished' AND j.finished_at IS NOT NULL;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION audit_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END $$;
DROP TRIGGER IF EXISTS audit_events_append_only ON audit_events;
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_append_only();
