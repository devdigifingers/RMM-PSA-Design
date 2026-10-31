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

-- Retired on 31 Oct 2026: ticket history now lives in activity_events (type 'ticket.<kind>', detail in payload).
-- Kept read-only as an archive; rows only disappear when a tenant migration purge or rollback deletes the ticket.
CREATE OR REPLACE FUNCTION ticket_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND COALESCE(current_setting('df.migration', true), '') <> '' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'ticket_events is retired; ticket history is written to activity_events';
END $$;
DROP TRIGGER IF EXISTS ticket_events_append_only ON ticket_events;
CREATE TRIGGER ticket_events_append_only BEFORE INSERT OR UPDATE OR DELETE ON ticket_events
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

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS merged_into_id bigint REFERENCES tickets (id);
CREATE INDEX IF NOT EXISTS tickets_org_category_idx ON tickets (org_id, lower(category));
CREATE INDEX IF NOT EXISTS tickets_tags_idx ON tickets USING gin (tags);

CREATE TABLE IF NOT EXISTS ticket_saved_views (
  id bigserial PRIMARY KEY,
  org_id bigint NOT NULL REFERENCES orgs (id),
  user_id bigint NOT NULL REFERENCES users (id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  query text NOT NULL DEFAULT '',
  columns text[],
  shared boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ticket_saved_views_org_idx ON ticket_saved_views (org_id, shared, user_id);

CREATE TABLE IF NOT EXISTS ticket_list_prefs (
  user_id bigint PRIMARY KEY REFERENCES users (id),
  org_id bigint NOT NULL REFERENCES orgs (id),
  columns text[] NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE enroll_tokens ADD COLUMN IF NOT EXISTS max_uses integer NOT NULL DEFAULT 1;
ALTER TABLE enroll_tokens ADD COLUMN IF NOT EXISTS use_count integer NOT NULL DEFAULT 0;
ALTER TABLE enroll_tokens ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'package';
ALTER TABLE enroll_tokens ADD COLUMN IF NOT EXISTS revoked_at timestamptz;
UPDATE enroll_tokens SET use_count = 1 WHERE used_at IS NOT NULL AND use_count = 0;

ALTER TABLE devices ADD COLUMN IF NOT EXISTS os_version text;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS os_build text;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_boot_at timestamptz;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS remote_agent jsonb;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS public_ip text;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS geo_country text;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS geo_country_name text;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS geo_region text;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS geo_city text;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS geo_lat numeric(5, 2);
ALTER TABLE devices ADD COLUMN IF NOT EXISTS geo_lon numeric(5, 2);
ALTER TABLE devices ADD COLUMN IF NOT EXISTS geo_updated_at timestamptz;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS site_override text
  CHECK (site_override IS NULL OR length(site_override) BETWEEN 1 AND 80);

CREATE TABLE IF NOT EXISTS device_daily_stats (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id bigint NOT NULL REFERENCES orgs (id),
  customer_id bigint REFERENCES customers (id),
  day date NOT NULL,
  device_count integer NOT NULL,
  online_count integer NOT NULL,
  seen_day_count integer NOT NULL,
  agent_versions jsonb NOT NULL,
  os_counts jsonb NOT NULL,
  country_counts jsonb NOT NULL,
  region_counts jsonb NOT NULL,
  patched_count integer NOT NULL,
  missing_count integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (org_id, customer_id, day)
);
CREATE INDEX IF NOT EXISTS device_daily_stats_org_day_idx ON device_daily_stats (org_id, day);
-- NULL on snapshots written before these were collected; reports show those days as gaps.
ALTER TABLE device_daily_stats ADD COLUMN IF NOT EXISTS build_counts jsonb;
ALTER TABLE device_daily_stats ADD COLUMN IF NOT EXISTS scanned_count integer;
ALTER TABLE device_daily_stats ADD COLUMN IF NOT EXISTS compliant_count integer;

-- Sampled every 5 minutes; online share for a day is online_checks / checks.
CREATE TABLE IF NOT EXISTS device_uptime_daily (
  org_id bigint NOT NULL REFERENCES orgs (id),
  device_id bigint NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
  day date NOT NULL,
  checks integer NOT NULL DEFAULT 0,
  online_checks integer NOT NULL DEFAULT 0,
  PRIMARY KEY (device_id, day)
);
CREATE INDEX IF NOT EXISTS device_uptime_daily_org_day_idx ON device_uptime_daily (org_id, day);

-- One row per Connect. Mesh does not report when a viewer closes, so ended_at is the last time
-- the device still showed a session. 'untracked' rows were backfilled from launches before tracking.
CREATE TABLE IF NOT EXISTS remote_sessions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id bigint NOT NULL REFERENCES orgs (id),
  device_id bigint REFERENCES devices (id) ON DELETE SET NULL,
  customer_id bigint REFERENCES customers (id) ON DELETE SET NULL,
  user_id bigint REFERENCES users (id),
  ticket_id bigint REFERENCES tickets (id),
  device_name text NOT NULL,
  status text NOT NULL DEFAULT 'launched'
    CHECK (status IN ('launched', 'live', 'ended', 'untracked')),
  started_at timestamptz NOT NULL DEFAULT now(),
  connected_at timestamptz,
  last_seen_at timestamptz,
  ended_at timestamptz,
  audit_event_id bigint UNIQUE
);
CREATE INDEX IF NOT EXISTS remote_sessions_org_started_idx ON remote_sessions (org_id, started_at);
CREATE INDEX IF NOT EXISTS remote_sessions_open_idx ON remote_sessions (status) WHERE status IN ('launched', 'live');

INSERT INTO remote_sessions (org_id, device_id, customer_id, user_id, ticket_id, device_name, status, started_at, audit_event_id)
SELECT e.org_id, d.id, s.customer_id, e.actor_user_id,
       CASE WHEN (e.detail->>'ticketId') ~ '^[0-9]+$'
            THEN (SELECT t.id FROM tickets t WHERE t.id = (e.detail->>'ticketId')::bigint AND t.org_id = e.org_id) END,
       COALESCE(d.display_name, d.hostname, 'Removed device'), 'untracked', e.created_at, e.id
FROM audit_events e
LEFT JOIN devices d ON e.target_id ~ '^[0-9]+$' AND d.id = e.target_id::bigint AND d.org_id = e.org_id
LEFT JOIN sites s ON s.id = d.site_id
WHERE e.action = 'remote.launch' AND e.target_type = 'device'
  AND NOT EXISTS (SELECT 1 FROM remote_sessions WHERE status <> 'untracked')
ON CONFLICT (audit_event_id) DO NOTHING;

-- Monthly PDF of one report for one customer (or the whole org), emailed to a contact.
CREATE TABLE IF NOT EXISTS report_subscriptions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id bigint NOT NULL REFERENCES orgs (id),
  report_key text NOT NULL CHECK (report_key IN ('agents', 'os', 'locations', 'patches', 'uptime', 'sessions', 'service-desk')),
  customer_id bigint REFERENCES customers (id) ON DELETE CASCADE,
  contact_id bigint REFERENCES contacts (id) ON DELETE SET NULL,
  email text NOT NULL CHECK (length(email) BETWEEN 3 AND 254),
  next_run_at timestamptz NOT NULL,
  paused_at timestamptz,
  created_by bigint REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS report_subscriptions_org_idx ON report_subscriptions (org_id, id);
CREATE INDEX IF NOT EXISTS report_subscriptions_due_idx ON report_subscriptions (next_run_at) WHERE paused_at IS NULL;

CREATE TABLE IF NOT EXISTS report_deliveries (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id bigint NOT NULL REFERENCES orgs (id),
  subscription_id bigint REFERENCES report_subscriptions (id) ON DELETE SET NULL,
  report_key text NOT NULL,
  customer_id bigint REFERENCES customers (id) ON DELETE SET NULL,
  email text NOT NULL,
  period_from date NOT NULL,
  period_to date NOT NULL,
  status text NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  detail text,
  pdf_bytes integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS report_deliveries_org_idx ON report_deliveries (org_id, id DESC);

ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS actor_role text;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS ip text;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS user_agent text;

-- Only the hash of the emailed token is stored; accepting creates the user and uses a seat.
CREATE TABLE IF NOT EXISTS user_invites (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id bigint NOT NULL REFERENCES orgs (id),
  email text NOT NULL CHECK (length(email) BETWEEN 3 AND 254),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'tech')),
  token_hash text NOT NULL UNIQUE,
  invited_by bigint REFERENCES users (id),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_user_id bigint REFERENCES users (id),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_invites_org_idx ON user_invites (org_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS user_invites_open_email_idx ON user_invites (lower(email))
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- Service Desk setup: custom statuses, labels, business hours, canned replies, notifications.
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS due_at timestamptz;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS channel text;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS sla_paused_at timestamptz;
-- Closed pending intervals as [[start, end], ...]; the SLA engine counts them in business minutes.
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS sla_pauses jsonb NOT NULL DEFAULT '[]'::jsonb;
-- Targets ('response', 'resolve') that already raised a pre-breach warning.
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS sla_warned text[] NOT NULL DEFAULT '{}';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tickets_channel_check') THEN
    ALTER TABLE tickets ADD CONSTRAINT tickets_channel_check CHECK (
      channel IS NULL OR channel IN ('phone', 'email', 'walk_in', 'portal', 'remote', 'console', 'alert', 'automatic', 'support')
    );
  END IF;
END $$;
UPDATE tickets t SET channel = CASE
    WHEN EXISTS (SELECT 1 FROM alerts a WHERE a.ticket_id = t.id) THEN 'alert'
    WHEN EXISTS (SELECT 1 FROM support_sessions ss WHERE ss.ticket_id = t.id) THEN 'support'
    WHEN t.created_by IS NULL THEN 'automatic'
    ELSE 'console' END
WHERE t.channel IS NULL;
UPDATE tickets SET sla_paused_at = updated_at WHERE status = 'pending' AND sla_paused_at IS NULL;

CREATE OR REPLACE FUNCTION tickets_sla_pause() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'pending' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'pending') THEN
    NEW.sla_paused_at := now();
  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'pending' AND NEW.status <> 'pending' THEN
    IF OLD.sla_paused_at IS NOT NULL THEN
      NEW.sla_pauses := COALESCE(OLD.sla_pauses, '[]'::jsonb) || jsonb_build_array(jsonb_build_array(OLD.sla_paused_at, now()));
    END IF;
    NEW.sla_paused_at := NULL;
  END IF;
  -- A custom status only sticks while the ticket's base status still matches it (bulk edits, automations).
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status AND NEW.status_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM desk_statuses s WHERE s.id = NEW.status_id AND s.base = NEW.status) THEN
    NEW.status_id := NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tickets_sla_pause ON tickets;
CREATE TRIGGER tickets_sla_pause BEFORE INSERT OR UPDATE OF status ON tickets
  FOR EACH ROW EXECUTE FUNCTION tickets_sla_pause();

CREATE TABLE IF NOT EXISTS desk_statuses (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id bigint NOT NULL REFERENCES orgs (id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  base text NOT NULL CHECK (base IN ('open', 'pending', 'resolved')),
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS desk_statuses_org_name_key ON desk_statuses (org_id, lower(name));
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS status_id bigint REFERENCES desk_statuses (id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS desk_priorities (
  org_id bigint NOT NULL REFERENCES orgs (id),
  priority text NOT NULL CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 30),
  PRIMARY KEY (org_id, priority)
);

CREATE TABLE IF NOT EXISTS desk_categories (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id bigint NOT NULL REFERENCES orgs (id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS desk_categories_org_name_key ON desk_categories (org_id, lower(name));

CREATE TABLE IF NOT EXISTS desk_tags (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id bigint NOT NULL REFERENCES orgs (id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 30),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS desk_tags_org_name_key ON desk_tags (org_id, lower(name));

CREATE TABLE IF NOT EXISTS desk_business_hours (
  org_id bigint PRIMARY KEY REFERENCES orgs (id),
  enabled boolean NOT NULL DEFAULT false,
  hours jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS desk_holidays (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id bigint NOT NULL REFERENCES orgs (id),
  day date NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  UNIQUE (org_id, day)
);

ALTER TABLE org_slas ADD COLUMN IF NOT EXISTS priority_percent jsonb NOT NULL
  DEFAULT '{"low": 100, "normal": 100, "high": 100, "urgent": 100}'::jsonb;
ALTER TABLE sla_plans ADD COLUMN IF NOT EXISTS priority_percent jsonb NOT NULL
  DEFAULT '{"low": 100, "normal": 100, "high": 100, "urgent": 100}'::jsonb;

CREATE TABLE IF NOT EXISTS desk_canned_replies (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id bigint NOT NULL REFERENCES orgs (id),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 80),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  created_by bigint REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS desk_canned_replies_org_title_key ON desk_canned_replies (org_id, lower(title));

CREATE TABLE IF NOT EXISTS desk_notification_rules (
  org_id bigint NOT NULL REFERENCES orgs (id),
  event text NOT NULL CHECK (event IN ('new_ticket', 'assigned', 'customer_reply', 'sla_warning', 'sla_breach')),
  email boolean NOT NULL DEFAULT false,
  in_app boolean NOT NULL DEFAULT true,
  PRIMARY KEY (org_id, event)
);

CREATE TABLE IF NOT EXISTS ticket_cc (
  org_id bigint NOT NULL REFERENCES orgs (id),
  ticket_id bigint NOT NULL REFERENCES tickets (id) ON DELETE CASCADE,
  contact_id bigint NOT NULL REFERENCES contacts (id) ON DELETE CASCADE,
  PRIMARY KEY (ticket_id, contact_id)
);

CREATE TABLE IF NOT EXISTS user_notifications (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id bigint NOT NULL REFERENCES orgs (id),
  user_id bigint NOT NULL REFERENCES users (id),
  ticket_id bigint REFERENCES tickets (id) ON DELETE CASCADE,
  kind text NOT NULL,
  title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);
CREATE INDEX IF NOT EXISTS user_notifications_user_idx ON user_notifications (user_id, created_at DESC);

-- Service Desk phase 4: email channel, automations, links and watchers.
CREATE TABLE IF NOT EXISTS desk_mailboxes (
  org_id bigint PRIMARY KEY REFERENCES orgs (id),
  address text NOT NULL CHECK (length(address) BETWEEN 3 AND 254),
  host text NOT NULL CHECK (length(host) BETWEEN 1 AND 253),
  port integer NOT NULL DEFAULT 993 CHECK (port BETWEEN 1 AND 65535),
  secure boolean NOT NULL DEFAULT true,
  username text NOT NULL CHECK (length(username) BETWEEN 1 AND 254),
  password_sealed text NOT NULL,
  folder text NOT NULL DEFAULT 'INBOX',
  enabled boolean NOT NULL DEFAULT false,
  send_replies boolean NOT NULL DEFAULT false,
  acknowledge boolean NOT NULL DEFAULT false,
  default_customer_id bigint REFERENCES customers (id) ON DELETE SET NULL,
  uid_validity bigint,
  last_uid bigint,
  last_polled_at timestamptz,
  last_error text,
  messages_in integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ticket_comments ADD COLUMN IF NOT EXISTS email_message_id text;
ALTER TABLE ticket_comments ADD COLUMN IF NOT EXISTS email_from text;
CREATE INDEX IF NOT EXISTS ticket_comments_message_idx ON ticket_comments (org_id, email_message_id) WHERE email_message_id IS NOT NULL;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS email_message_id text;
CREATE INDEX IF NOT EXISTS tickets_message_idx ON tickets (org_id, email_message_id) WHERE email_message_id IS NOT NULL;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS parent_id bigint REFERENCES tickets (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS tickets_parent_idx ON tickets (parent_id) WHERE parent_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS ticket_watchers (
  org_id bigint NOT NULL REFERENCES orgs (id),
  ticket_id bigint NOT NULL REFERENCES tickets (id) ON DELETE CASCADE,
  user_id bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ticket_id, user_id)
);

CREATE TABLE IF NOT EXISTS desk_options (
  org_id bigint PRIMARY KEY REFERENCES orgs (id),
  -- NULL means pending tickets are never closed automatically.
  auto_close_days integer CHECK (auto_close_days BETWEEN 1 AND 90),
  alert_tickets boolean NOT NULL DEFAULT false,
  brand_color text NOT NULL DEFAULT '#8B5CF6' CHECK (brand_color ~ '^#[0-9A-Fa-f]{6}$'),
  signature text CHECK (length(signature) <= 1000),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS desk_automations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id bigint NOT NULL REFERENCES orgs (id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  trigger text NOT NULL CHECK (trigger IN ('created', 'updated')),
  conditions jsonb NOT NULL DEFAULT '[]'::jsonb,
  actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS desk_automations_org_idx ON desk_automations (org_id, trigger, position);

-- Service Desk phase 5: customer satisfaction.
ALTER TABLE desk_options ADD COLUMN IF NOT EXISTS csat_enabled boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS ticket_ratings (
  ticket_id bigint PRIMARY KEY REFERENCES tickets (id) ON DELETE CASCADE,
  org_id bigint NOT NULL REFERENCES orgs (id),
  rating text NOT NULL CHECK (rating IN ('good', 'ok', 'bad')),
  comment text CHECK (length(comment) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ticket_ratings_org_idx ON ticket_ratings (org_id, updated_at DESC);

-- Tenant migrations: platform-admin requests approved by both tenants and a second platform admin.
CREATE TABLE IF NOT EXISTS migration_requests (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_tenant_id bigint NOT NULL REFERENCES orgs (id),
  target_tenant_id bigint NOT NULL REFERENCES orgs (id),
  scope jsonb NOT NULL,
  mode text NOT NULL CHECK (mode IN ('copy', 'move')),
  resolutions jsonb NOT NULL DEFAULT '{}'::jsonb,
  acknowledged text[] NOT NULL DEFAULT '{}',
  schedule_at timestamptz,
  status text NOT NULL CHECK (status IN ('draft', 'pending', 'approved', 'scheduled', 'running', 'completed', 'failed',
    'rolled_back', 'declined', 'expired', 'cancelled')),
  requested_by bigint NOT NULL REFERENCES users (id),
  dry_run_snapshot jsonb NOT NULL,
  progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  purged_at timestamptz,
  rollback_requested_by bigint REFERENCES users (id),
  rollback_requested_at timestamptz,
  rollback_keep boolean,
  rollback_approved_by bigint REFERENCES users (id),
  rollback_approved_at timestamptz,
  rolled_back_at timestamptz,
  wait_warned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source_tenant_id <> target_tenant_id)
);
CREATE INDEX IF NOT EXISTS migration_requests_status_idx ON migration_requests (status, schedule_at);
CREATE INDEX IF NOT EXISTS migration_requests_source_idx ON migration_requests (source_tenant_id, id DESC);
CREATE INDEX IF NOT EXISTS migration_requests_target_idx ON migration_requests (target_tenant_id, id DESC);

-- Rows with cleared_at set were wiped by an edit to the request and no longer count.
CREATE TABLE IF NOT EXISTS migration_approvals (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id bigint NOT NULL REFERENCES migration_requests (id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('source_owner', 'target_owner', 'platform_admin')),
  user_id bigint NOT NULL REFERENCES users (id),
  decision text NOT NULL CHECK (decision IN ('approved', 'declined')),
  reason text CHECK (length(reason) <= 1000),
  decided_at timestamptz NOT NULL DEFAULT now(),
  cleared_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS migration_approvals_live_idx ON migration_approvals (request_id, role) WHERE cleared_at IS NULL;

-- merged rows point at records the target already had; rollback leaves those alone.
CREATE TABLE IF NOT EXISTS migration_id_map (
  request_id bigint NOT NULL REFERENCES migration_requests (id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  source_id bigint NOT NULL,
  target_id bigint NOT NULL,
  merged boolean NOT NULL DEFAULT false,
  detail jsonb,
  PRIMARY KEY (request_id, entity_type, source_id)
);
CREATE INDEX IF NOT EXISTS migration_id_map_target_idx ON migration_id_map (request_id, entity_type, target_id);

CREATE TABLE IF NOT EXISTS migration_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id bigint NOT NULL REFERENCES migration_requests (id) ON DELETE CASCADE,
  kind text NOT NULL,
  actor_user_id bigint REFERENCES users (id),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS migration_events_request_idx ON migration_events (request_id, id);

CREATE OR REPLACE FUNCTION migration_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'migration_events is append-only';
END $$;
DROP TRIGGER IF EXISTS migration_events_append_only ON migration_events;
CREATE TRIGGER migration_events_append_only BEFORE UPDATE OR DELETE ON migration_events
  FOR EACH ROW EXECUTE FUNCTION migration_events_append_only();

-- After a Move the source copy stays read-only (migration_lock = request id) until it is purged or rolled back.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS migration_lock bigint;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS migration_lock bigint;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS migration_lock bigint;
CREATE INDEX IF NOT EXISTS tickets_migration_lock_idx ON tickets (migration_lock) WHERE migration_lock IS NOT NULL;

-- The migration job sets df.migration for its own transaction; everyone else gets DF_MIGRATION_LOCKED.
CREATE OR REPLACE FUNCTION df_migration_job() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('df.migration', true), '') <> ''
$$;

CREATE OR REPLACE FUNCTION df_migration_row_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF df_migration_job() THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF OLD.migration_lock IS NOT NULL THEN
    RAISE EXCEPTION 'DF_MIGRATION_LOCKED';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE OR REPLACE FUNCTION df_migration_ticket_child_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target bigint;
BEGIN
  IF df_migration_job() THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  target := CASE WHEN TG_OP = 'DELETE' THEN OLD.ticket_id ELSE NEW.ticket_id END;
  IF target IS NOT NULL AND EXISTS (SELECT 1 FROM tickets WHERE id = target AND migration_lock IS NOT NULL) THEN
    RAISE EXCEPTION 'DF_MIGRATION_LOCKED';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE OR REPLACE FUNCTION df_migration_customer_child_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF df_migration_job() THEN
    RETURN NEW;
  END IF;
  IF NEW.customer_id IS NOT NULL AND EXISTS (SELECT 1 FROM customers WHERE id = NEW.customer_id AND migration_lock IS NOT NULL) THEN
    RAISE EXCEPTION 'DF_MIGRATION_LOCKED';
  END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['customers', 'contacts', 'tickets'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', name || '_migration_guard', name);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION df_migration_row_guard()',
      name || '_migration_guard', name);
  END LOOP;
  FOREACH name IN ARRAY ARRAY['ticket_comments', 'ticket_events', 'ticket_time_entries', 'ticket_attachments', 'ticket_cc',
    'ticket_watchers', 'ticket_timers', 'ticket_ratings'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', name || '_migration_guard', name);
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION df_migration_ticket_child_guard()',
      name || '_migration_guard', name);
  END LOOP;
  FOREACH name IN ARRAY ARRAY['contacts', 'tickets'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', name || '_migration_parent_guard', name);
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF customer_id ON %I FOR EACH ROW EXECUTE FUNCTION df_migration_customer_child_guard()',
      name || '_migration_parent_guard', name);
  END LOOP;
END $$;
-- Platform team: super admins manage the team, admins run Control, support can only look.
ALTER TABLE users ADD COLUMN IF NOT EXISTS platform_role text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS platform_mfa_due_at timestamptz;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_platform_role_check') THEN
    ALTER TABLE users ADD CONSTRAINT users_platform_role_check CHECK (
      (is_platform_admin = false AND platform_role IS NULL)
      OR (is_platform_admin = true AND platform_role IN ('super', 'admin', 'support'))
    ) NOT VALID;
  END IF;
END $$;
UPDATE users SET platform_role = 'super', platform_mfa_due_at = COALESCE(platform_mfa_due_at, now() + interval '7 days')
WHERE is_platform_admin = true AND platform_role IS NULL;
ALTER TABLE users VALIDATE CONSTRAINT users_platform_role_check;

CREATE TABLE IF NOT EXISTS platform_invites (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email text NOT NULL CHECK (length(email) BETWEEN 3 AND 254),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  platform_role text NOT NULL CHECK (platform_role IN ('super', 'admin', 'support')),
  token_hash text NOT NULL UNIQUE,
  invited_by bigint REFERENCES users (id),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_user_id bigint REFERENCES users (id),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS platform_invites_open_email_idx ON platform_invites (lower(email))
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE OR REPLACE FUNCTION audit_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END $$;
DROP TRIGGER IF EXISTS audit_events_append_only ON audit_events;
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_append_only();

-- Tenant API tokens (Organisation settings → Security → API tokens). Only the SHA-256 of a token is stored.
CREATE TABLE IF NOT EXISTS api_tokens (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id bigint NOT NULL REFERENCES orgs (id),
  name text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  hint text NOT NULL,
  scopes text[] NOT NULL DEFAULT '{jobs}',
  device_ids bigint[] NOT NULL,
  allowed_ips text[] NOT NULL DEFAULT '{}',
  created_by bigint NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_used_at timestamptz,
  last_used_ip text,
  revoked_at timestamptz,
  revoked_by bigint REFERENCES users (id)
);

CREATE INDEX IF NOT EXISTS api_tokens_org_id_idx ON api_tokens (org_id, created_at DESC);

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS api_token_id bigint REFERENCES api_tokens (id);

-- 'script' jobs carry a multi-line PowerShell script in command; agents before 1.6.1 cannot run them.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'command';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_kind_check') THEN
    ALTER TABLE jobs ADD CONSTRAINT jobs_kind_check CHECK (kind IN ('command', 'script'));
  END IF;
END $$;

-- Remote Desk → Settings → Script library. The built-in starter scripts live in code (script-library.js);
-- this table holds each organisation's own scripts. Archived scripts stay so old jobs can still name them.
CREATE TABLE IF NOT EXISTS scripts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id bigint NOT NULL REFERENCES orgs (id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  description text NOT NULL DEFAULT '',
  shell text NOT NULL CHECK (shell IN ('powershell', 'cmd', 'bash')),
  body text NOT NULL,
  parameters jsonb NOT NULL DEFAULT '[]'::jsonb,
  risk text NOT NULL DEFAULT 'safe' CHECK (risk IN ('safe', 'approval')),
  fixes text[] NOT NULL DEFAULT '{}',
  created_by bigint REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS scripts_org_name_key ON scripts (org_id, lower(name)) WHERE archived_at IS NULL;

-- Which library script a job ran: a built-in key such as 'flush-dns', or the id of an organisation script.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS script_ref text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS script_name text;

-- One history for each customer and device. customer_id is fixed when the event happens, so a device that later
-- moves to another customer keeps its earlier events with the first one. The ids are not foreign keys: history
-- outlives the records it mentions. (source, source_id) makes the backfill and live writes safe to repeat.
CREATE TABLE IF NOT EXISTS activity_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id bigint NOT NULL REFERENCES orgs (id),
  customer_id bigint,
  device_id bigint,
  ticket_id bigint,
  contact_id bigint,
  type text NOT NULL,
  app text NOT NULL CHECK (app IN ('core', 'remote', 'servicedesk')),
  actor_type text NOT NULL CHECK (actor_type IN ('user', 'system', 'automation', 'api')),
  actor_user_id bigint,
  actor_label text,
  summary text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text,
  source_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS activity_events_customer_idx ON activity_events (org_id, customer_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS activity_events_device_idx ON activity_events (org_id, device_id, created_at DESC, id DESC) WHERE device_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS activity_events_ticket_idx ON activity_events (org_id, ticket_id, created_at, id) WHERE ticket_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS activity_events_source_idx ON activity_events (source, source_id) WHERE source IS NOT NULL;

-- Rows are only changed or removed by a tenant migration, which sets df.migration for its transaction.
CREATE OR REPLACE FUNCTION activity_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF COALESCE(current_setting('df.migration', true), '') <> '' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION 'activity_events is append-only';
END $$;
DROP TRIGGER IF EXISTS activity_events_append_only ON activity_events;
CREATE TRIGGER activity_events_append_only BEFORE UPDATE OR DELETE ON activity_events
  FOR EACH ROW EXECUTE FUNCTION activity_events_append_only();
-- Ticket history lives here, so a ticket locked by a migration gets no new events (like its comments).
DROP TRIGGER IF EXISTS activity_events_migration_guard ON activity_events;
CREATE TRIGGER activity_events_migration_guard BEFORE INSERT ON activity_events
  FOR EACH ROW EXECUTE FUNCTION df_migration_ticket_child_guard();
CREATE INDEX IF NOT EXISTS activity_events_type_idx ON activity_events (type, created_at);
