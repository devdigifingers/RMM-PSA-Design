# Operations guide

**Last updated:** 2026-10-29
How the running platform works and how to change it safely. What changed and when: [CHANGELOG.md](./CHANGELOG.md).
First-time server build and disaster recovery: [PHASE1_RUNBOOK.md](./PHASE1_RUNBOOK.md) · [SETUP_AND_DR.md](./SETUP_AND_DR.md).

No passwords, keys, licence keys, install codes or device addresses belong in this file. Secrets live only in the
mode 600 files on df-a named below.

---

## 1. What runs where

Everything runs on **df-a**.

| Part | Folder | Service | Port (local only) | Public address |
|------|--------|---------|-------------------|----------------|
| Console (Next.js) | `/opt/df-console`, owner `dfconsole` | `df-console` | 3000 | rmm.digitalfingers.co.za |
| API (Node, raw `node:http`) | `/opt/df-api`, owner `dfapi` | `df-api` | 4000 | api.digitalfingers.co.za |
| Remote engine | `/opt/meshcentral` | MeshCentral | 4430 | mesh.digitalfingers.co.za |
| Database / cache | | Postgres, Redis | | |

Secret files (root only): `/root/df-api.env`, `/root/df-platform-db.env`, `/root/df-mesh.env`, `/etc/GeoIP.conf`.

Health checks on df-a: `curl localhost:4000/health` should return `{"ok":true,"postgres":true,"redis":true}`;
`curl -o /dev/null -w '%{http_code}' localhost:3000/` should return `200`.

### Background jobs inside the API

| Every | Job |
|-------|-----|
| 15 s | Scheduled fleet exports, offline sweep, SLA breach sweep, support-session sweep |
| 1 min | Ticket remote-session sweep; tenant migrations (expiry, due runs, rollbacks, 30-day purge) |
| 2 min | Service Desk mailboxes (IMAP email-to-ticket) |
| 5 min | Uptime sampling (feeds the Uptime report) |
| 10 min | Mesh tenant isolation, daily dashboard snapshots, monthly emailed reports |
| 1 hour | Unused ticket attachment cleanup, auto-close of resolved tickets |

---

## 2. Deploying changes

Run from the project folder on the workstation. Deploys go to production, so each one needs an explicit go-ahead.

### API

```bash
tar czf /tmp/df-api.tgz -C api src/server.js src/<other changed files>
scp -q /tmp/df-api.tgz df-a:/tmp/
ssh df-a 'set -e; cd /opt/df-api && sudo -u dfapi tar xzf /tmp/df-api.tgz --no-same-owner \
  && sudo systemctl restart df-api && sleep 2 && curl -s localhost:4000/health'
```

Only when `api/schema.sql` changed, run the migration before the restart:

```bash
ssh df-a 'sudo bash -c "set -a; . /root/df-api.env; . /root/df-platform-db.env; set +a; cd /opt/df-api && node scripts/migrate.js"'
```

### Console

```bash
tar czf /tmp/df-console.tgz -C console app/<changed files or folders>
scp -q /tmp/df-console.tgz df-a:/tmp/
ssh df-a 'set -e; cd /opt/df-console && sudo -u dfconsole tar xzf /tmp/df-console.tgz --no-same-owner \
  && (sudo -u dfconsole npm run build 2>&1 | grep -E "rror|Failed" || echo build-ok) \
  && sudo systemctl restart df-console && sleep 4 && curl -s -o /dev/null -w "%{http_code}\n" localhost:3000/'
```

A deleted console file must also be removed on df-a, or the build keeps using it.

The Control → System page shows the newest entries of `docs/CHANGELOG.md`. After adding an entry, copy it to the
console (no build or restart needed):

```bash
tar czf /tmp/df-changelog.tgz -C docs CHANGELOG.md && scp -q /tmp/df-changelog.tgz df-a:/tmp/ \
  && ssh df-a 'cd /opt/df-console && sudo -u dfconsole tar xzf /tmp/df-changelog.tgz --no-same-owner'
```

### Platform version

Every deploy of the console, API or session window is a platform version (`MAJOR.MINOR.PATCH`; MINOR for features,
PATCH for fixes only). Before deploying, raise `PLATFORM_VERSION` and `PLATFORM_RELEASED` in `console/app/version.js`
and add `## <date> · Platform <version>` at the top of `docs/CHANGELOG.md`, then deploy the console with
`CHANGELOG.md` so the sign-in page, the side rail and Control → System all show the new version. Several deploys on
one day may share a version only if nothing has been deployed in between. `npm test` in `console` fails when the
version and the newest changelog heading differ.

### Checks before every deploy

- API: `cd api && npm test` (all pass) and `node --check src/server.js`.
- Console: `cd console && npm test` (settings menu and redirects), and
  `npx --yes esbuild@0.24.0 --loader=jsx --log-level=error < <file>` for each changed file.
- Settings pages live under `/settings/org`, `/remote/settings` and `/desk/settings`; the menu is defined once in
  `console/app/settings-map.js`. When a page moves, add the old address to `redirects()` in `console/next.config.mjs`.
- After deploying, check the change in the browser on rmm.digitalfingers.co.za.

---

## 3. Agent releases

Each platform has its own published version. A device is **outdated** when it is older than the release for its own
platform (a Linux 1.5.1 device is outdated when Linux is on 1.5.2, even if Windows is on 1.5.1).

| Platform | Files on df-a (`/opt/df-console/agent-bin`) | Release record |
|----------|---------------------------------------------|----------------|
| Windows | `DigitalFingersAgent.exe`, test build in `next/` | `windows.json` (version + sha256) |
| Windows remote support | `DigitalFingersRemoteSupport.exe` (the branded Mesh agent for the "Digital Fingers" staging group) | `windows-remote.json` (sha256) |
| Linux | `linux/df-agent-amd64`, `linux/df-agent-arm64`, `install.sh`, two service units | `linux/linux.json` |

The version number comes from `const agentVersion` in `agent/main.go`. Agents older than 1.5 send no version and
show as "Unknown (1.4 or older)".

**Remote support on Windows (agent 1.6+).** The agent installer no longer carries the Mesh agent inside it (that
pattern, an exe that writes and runs a hidden second exe, is what antivirus flags). Instead the device agent checks the
"Mesh Agent" service 30 seconds after start and every 2 minutes:
- stopped: it starts the service (at most every 10 minutes; a disabled service is left alone and reported);
- missing (no service, or its program file is gone): it reports that, gets the published sha256 back in the heartbeat,
  downloads `/v1/agent/remote/windows` with its device login into `C:\ProgramData\DigitalFingers`, checks the hash and
  runs `-fullinstall` (at most once an hour). The new Mesh agent joins the staging group and is moved to the tenant's
  group as usual;
- blocked: the file vanished after download or during install, or Windows refused to run it. Usually antivirus.

The state is stored on the device (`devices.remote_agent`), shown as a chip under the agent version on Devices, and
changes are audited (`device.remote_agent_missing`, `_blocked`, `_stopped`, `_ok`). Every Windows build refreshes the
remote support file, including `CHANNEL=next` builds; agents 1.5 and older ignore it.

### Windows: stage, test, publish

1. Bump `agentVersion`, then build to the **test channel** only (no device is offered it):
   ```bash
   tar czf /tmp/dfagent-src.tgz -C agent go.mod go.sum main.go os_linux.go os_windows.go patch_helper_linux.go
   scp /tmp/dfagent-src.tgz agent/deploy/build-windows.sh df-a:/tmp/
   ssh df-a 'sudo CHANNEL=next bash /tmp/build-windows.sh'
   ```
2. Test on **FED-WIN-001** (the test VM). Create an install command under Downloads → Servers and command line, then
   in Terminal (Admin) on the VM run it with the test channel added, URL in single quotes:
   `irm 'https://rmm.digitalfingers.co.za/i/<code>/windows?channel=next' | iex`
   Pass: it prints without pop-ups, the device shows the new version, and its Windows version appears in the OS report.
3. Publish the **same file** that was tested (no rebuild); the previous exe is kept as `.prev-<date>`:
   ```bash
   scp agent/deploy/build-windows.sh df-a:/tmp/ && ssh df-a 'sudo bash /tmp/build-windows.sh promote <version>'
   ```
4. Auto-update is on (`AGENT_AUTO_UPDATE=on`), so every outdated Windows PC is offered the release on an idle check-in
   (no patch deploy or job running), at most once every 30 minutes. The agent service restarts; the PC does not reboot.
   Devices on 1.4 or older get a one-time PowerShell job that fetches the new agent instead.

Roll back: copy the wanted `.prev-<date>` file back over `DigitalFingersAgent.exe` and write its version and sha256 into
`windows.json`. Agents never downgrade, so this only stops further updates.

### Linux: build and update

1. Build and publish (this also refreshes the remote desktop agent files in the install package):
   ```bash
   tar czf /tmp/dfagent-src.tgz -C agent go.mod go.sum main.go os_linux.go os_windows.go patch_helper_linux.go deploy
   scp /tmp/dfagent-src.tgz agent/deploy/build-linux.sh df-a:/tmp/
   ssh df-a 'sudo bash /tmp/build-linux.sh'
   ```
2. Update devices from the console: **Devices → Tools → Update agent to …**, or **Update outdated agents** on the
   Dashboard. There is no automatic Linux update.

How the Linux update works: the agent runs as the unprivileged `dfagent` user and cannot replace itself, so the API
sends a short root script through the **MeshCentral agent** (which runs as root). The script downloads the binary for the
processor with a single-use link (30 minutes), checks its sha256 against the API's own hash of the published file,
replaces `/usr/local/bin/df-agent`, refreshes the two service units, and restarts `df-agent` and `df-patch-helper`.
It also upgrades installs from before 1.5 (creates `dfagent` if missing, removes the old Python helper).
It needs the remote desktop agent installed and online; otherwise the console says so and the update must be installed
by hand with the update package (Account menu → Agent Updates, then `sudo ./install.sh`).

Tested 2026-10-29 on MSC-FEDORA-HM (1.5.1 → 1.5.2) and vps3231588 (1.4 → 1.5.2); both reported the new version
within 15 seconds.

---

## 4. Locations (MaxMind GeoLite2)

- Database: `/var/lib/GeoIP/GeoLite2-City.mmdb` (override with `GEOIP_DB`). Config with the licence key:
  `/etc/GeoIP.conf`, root only.
- `geoipupdate` runs from a systemd timer once a month. The API notices the new file within an hour and loads it; no
  restart is needed.
- The licence requires the credit line shown on the dashboard map and the Locations report.
- A device shows "City, Province" when known, else its country (datacenter addresses often resolve to a country only),
  else "Unknown". A Site / Branch set on the device overrides the location.

---

## 5. Rules that the numbers follow

- **Overdue ticket:** not resolved and past its resolution target. Pending tickets count; response targets do not.
  Dashboard, ticket list and customer pages all use `isOverdue` in `api/src/customer-views.js`.
- **SLA plan:** the customer's plan, falling back to the organisation default.
- **Package vs licence type:** the package (for example "Digital Fingers Suite") is what tenants see. The licence type
  (Operator, Licensee, Standard) is a control-panel-only field.

---

## 6. Tenant migrations

Control → Migrations moves or copies customers, contacts, tickets (with their timeline, attachments and time),
devices and desk settings from one tenant to another. Code: `api/src/migration-plan.js` (pure planning rules) and
`api/src/migrations.js` (dry run, approvals, run, rollback, purge).

- **Approvals:** the source tenant, the target tenant (owners, or admins when a tenant has no owner) and a second
  platform admin who is not the requester. A request expires after 7 days without all three. Changing a request
  clears the approvals. Approval links in emails ask the person to sign in; there are no signed links.
- **Run:** one database transaction with the `df.migration` setting, so a failure or restart changes nothing. It waits
  while a remote session is live on a device in scope, re-runs the dry run, and sends the request back for approval if
  the data changed a lot since (more than 10% or 2 records, or new conflicts). Devices are then re-pointed to the
  target's Mesh group.
- **Move:** the source keeps a read-only copy (`migration_lock`; database triggers refuse changes) for 30 days, then it
  is purged. **Copy** leaves the source alone and never includes devices.
- **Rollback:** within 30 days of a Move (any time for a Copy), requested by one platform admin and approved by
  another. Changes the target made since can be copied back to the source or discarded. A Copy rollback keeps
  customers the target has since used.
- **Users** are listed, never moved: one email belongs to one tenant.
- **End-to-end check:** `api/scripts/migration-selftest.js` runs a Move, rollback, Copy and Copy rollback against a
  scratch database and checks that the source is restored exactly and a third tenant is never touched. It refuses to
  run unless the database name ends in `_selftest`. Run it locally against a throwaway Postgres container, never
  against the platform database.

---

## 7. Platform team and break-glass

Platform accounts are managed in Control → Team (`api/src/platform-team.js`, rules in
`api/src/platform-team-rules.js`). Levels are stored in `users.platform_role` (`super`, `admin`, `support`).
Support is enforced in the API: any non-GET request outside the person's own login is refused. Platform accounts
must use MFA; `users.platform_mfa_due_at` is when it becomes required (now for new accounts and after an MFA reset).

If every super admin is locked out, create a new one from the server shell. It is recorded as `platform.bootstrap`
in the audit log and must set up MFA at first sign-in. Put the password in a root-only env file, not on the command
line, and delete the file afterwards:

```bash
sudo bash -c 'set -a; . /root/df-api.env; . /root/df-platform-db.env; . /root/df-break-glass.env; set +a; cd /opt/df-api && node scripts/bootstrap.js'
```

`/root/df-break-glass.env` holds `OPERATOR_EMAIL`, `OPERATOR_PASSWORD` and `OPERATOR_NAME`. Then sign in, set up MFA
and fix the team in Control.

---

## 8. Testing safely

- All online machines except the test devices are client or office PCs. Never reboot, shut down, or stop processes
  on them as a test.
- Test devices: **FED-WIN-001** (Windows VM) and **KANLDZAVFS01**. Do not click Connect on live office machines.
- Restart MeshCentral only when no remote sessions are open.
- Do not send report emails to real customer contacts while testing. The same goes for invites, ticket replies,
  resolved and rating (CSAT) emails, and migration requests, which email both tenants' owners.
- Install commands, invite links, support codes and one-time download links are credentials: do not paste them in
  chat or tickets. If one is exposed, revoke it under Downloads → Active install commands.
- Do not publish a Windows agent until it has passed on FED-WIN-001.
