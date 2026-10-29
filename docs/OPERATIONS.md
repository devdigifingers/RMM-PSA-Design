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
| 1 min | Ticket remote-session sweep |
| 5 min | Uptime sampling (feeds the Uptime report) |
| 10 min | Mesh tenant isolation, daily dashboard snapshots, monthly emailed reports |
| 1 hour | Unused ticket attachment cleanup |

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

### Checks before every deploy

- API: `cd api && npm test` (all pass) and `node --check src/server.js`.
- Console: `npx --yes esbuild@0.24.0 --loader=jsx --log-level=error < <file>` for each changed file.
- After deploying, check the change in the browser on rmm.digitalfingers.co.za.

---

## 3. Agent releases

Each platform has its own published version. A device is **outdated** when it is older than the release for its own
platform (a Linux 1.5.1 device is outdated when Linux is on 1.5.2, even if Windows is on 1.5.1).

| Platform | Files on df-a (`/opt/df-console/agent-bin`) | Release record |
|----------|---------------------------------------------|----------------|
| Windows | `DigitalFingersAgent.exe`, test build in `next/` | `windows.json` (version + sha256) |
| Linux | `linux/df-agent-amd64`, `linux/df-agent-arm64`, `install.sh`, two service units | `linux/linux.json` |

The version number comes from `const agentVersion` in `agent/main.go`. Agents older than 1.5 send no version and
show as "Unknown (1.4 or older)".

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

## 6. Testing safely

- All online machines except the test devices are client or office PCs. Never reboot, shut down, or stop processes
  on them as a test.
- Test devices: **FED-WIN-001** (Windows VM) and **KANLDZAVFS01**. Do not click Connect on live office machines.
- Restart MeshCentral only when no remote sessions are open.
- Do not send report emails to real customer contacts while testing.
- Install commands, invite links, support codes and one-time download links are credentials: do not paste them in
  chat or tickets. If one is exposed, revoke it under Downloads → Active install commands.
- Do not publish a Windows agent until it has passed on FED-WIN-001.
