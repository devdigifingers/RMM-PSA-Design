# Execution plan — phased steps and smoke gates

**Last updated:** 2026-10-02  
**Product phases:** [PHASED_PLAN.md](./PHASED_PLAN.md) · **Locked choices:** [DECISIONS.md](./DECISIONS.md)

This is the order of work. Product phases 0–5 stay as they are. Each phase is split into steps. A step is finished only when its smoke test passes. The next step does not start on a failure.

## How a smoke test works

A smoke test is a short check that the step meets its aspects. It is not a full test suite. Record the result in the smoke log at the bottom of this file. Do not paste passwords, keys, or database URLs into the log.

Every gate checks these aspects:

| Aspect | When it applies |
|--------|-----------------|
| The new thing works for the intended host or user | Every step |
| A host or org that should not have it cannot use it | Every step |
| SSH to Portal, Contabo A, and Contabo B still works | Every step |
| No live secret was written to git or this log | Every step |
| A sensitive action wrote an audit or event row | From step S7 onward |

If a step can break an earlier gate, re-run that earlier smoke before calling the new one passed.

**Stop rule:** a failed smoke test ends the session's forward work. Fix that step, re-run its smoke test, then continue.

## Where we are

| Item | State |
|------|--------|
| Planning docs | Done |
| Root SSH key on Portal, A, and B | Done (S0) |
| Ubuntu 24.04 patches and reboot to kernel `6.8.0-146-generic` | Done (S1) |
| DNS for the four hostnames | Passed (S2). Google may still cache the old `mail` name until about 15:40 SAST |
| Host baseline | Passed (S3) |
| PostgreSQL on Contabo B | Passed (S4). Database `df_platform`, role `df_app` |
| Redis on Contabo A | Passed (S5). Localhost only |
| MeshCentral on Contabo A | Passed (S6). `https://mesh.digitalfingers.co.za` |
| Control-plane API | Passed (S7). `https://api.digitalfingers.co.za` |
| Web console | Passed (S8). `https://rmm.digitalfingers.co.za` |
| Linux agent | Passed (S9). Portal host `vps3231588` enrolled in org 1 |
| Remote session from the console | Passed (S10). Terminal on `vps3231588`; org 2 denied |
| Windows agent | Passed (S11). `FED-WIN-001` enrolled; desktop session opened and closed |
| License boundaries | Passed (S12). Org 2 cap, module, and expiry denials are audited |
| Portal site | Passed (S13). Chooser on `digitalfingers.co.za`; Log on opens the console |
| GitHub backup | Passed (S14). `ee2d076` on `main` has source, templates, and the runbook |
| Tickets | Passed (S15). One ticket links a customer, a device, status, priority, assignee, and comments |
| Remote from a ticket | Passed (S16). The ticket opened Mesh on `vps3231588`, then the ticket was resolved |
| SLA | Passed (S17). Org 1 response 30 minutes and resolve 240 minutes show on the ticket |
| Ticketing gate | Passed (S18). Org 2 cannot create a ticket. Org 1 still can. Create and resolve are audited |
| Agent metrics | Passed (S19). CPU, memory, disk, and uptime show for `vps3231588` and `FED-WIN-001` |
| Alert rule | Passed (S20). Disk at or above 10% on `vps3231588` is in the inbox |
| Alert to ticket | Passed (S21). That alert opened a ticket on `vps3231588`. Org 2 could not |
| Monitoring gate | Passed (S22). Org 2 has no metrics and no alert inbox. Org 1 still does |
| Update inventory | Passed (S23). `vps3231588` lists apt updates. `FED-WIN-001` lists Windows updates |
| Patch policy | Passed (S24). Approve waits. Deploy without approval queues. Nothing was installed |
| Deploy job | Passed (S25). The agent stored success on Windows and failure on Linux |
| Patch compliance | Passed (S26). Digital Fingers office shows missing apt updates. Org 2 sees no patches |
| Dashboard | Passed (S27). One Digital Fingers view shows devices, the open ticket, SLA, health, and patch compliance |
| Scheduled export | Passed (S28). A CSV for Digital Fingers matches the dashboard counts |
| License usage | Passed (S29). Digital Fingers has 25 seats and 2 devices. Second Test Org has 5 seats and 0 devices |
| Reporting gate | Passed (S30). Second Test Org cannot open the dashboard or the export. Digital Fingers still can |
| GitHub backup of S15–S30 | Passed (S31). GitHub `main` is `e5f566e`, with no live secrets |
| Scoped reads | Passed (S32). Second Test Org sees only itself. The platform admin still sees both orgs |
| Daily export | Passed (S33). The CSV is once a day, still matches the dashboard, and 23 files are kept |
| Linux install helper | Passed (S34). `libxpm4` upgraded. The agent still cannot use sudo and keeps NoNewPrivileges |
| Command that fits the OS | Passed (S35). `FED-WIN-001` starts with `ver`. `vps3231588` starts with `uname -srm` |
| Customer on every device | Passed (S36). Both devices show Digital Fingers office. Org 2 still has no devices |
| Device asset | Passed (S37). Both devices show make, model, serial, and installed software. `libxpm4` is patched. `thermald` is still missing |
| One path for the work | Passed (S38). Offline, missing `thermald`, and the disk alert each sit on a ticket for Digital Fingers office and `vps3231588` |
| Roles that limit actions | Passed (S39). A technician can open devices, tickets, and remote. A shell and a patch approval return 403 |
| SLA clock | Passed (S40). Ticket 2 and the dashboard show the same response and resolve clocks against 30 and 240 minutes |
| GitHub backup of S36–S40 | Passed (S41). GitHub `main` is `ec0a093`. A search found no live secrets |
| Postgres dump | Passed (S42). Two dumps on Contabo A, mode 600. The live database was not restored |
| Mesh dump | Passed (S43). One archive on Contabo B. Mesh stayed up. Both devices still show |
| One missing-update ticket | Passed (S44). Heartbeats opened no new ticket. Existing missing tickets stayed |
| Email on a new ticket | Passed (S45). One new ticket mailed admin@ and was resolved. Ticket 2 stayed open |
| GitHub backup of S42–S45 | Not started (S46) |
| Device is back | Not started (S47) |
| One breach message | Not started (S48) |
| Audit in the console | Not started (S49) |
| Clock in the daily CSV | Not started (S50) |

Portal `thermald` is held by Ubuntu's phased rollout. That hold is accepted. It is not a failed gate. S41 through S45 passed. S46 through S50 are drafted and have not started. GitHub `main` is still `ec0a093`. The dump scripts, Mesh archive, one missing-update ticket, and new-ticket mail are on the servers and are not in that commit.

## Hosts

| Alias | Address | Role |
|-------|---------|------|
| `df-portal` | 69.164.244.199 | `digitalfingers.co.za` only |
| `df-a` | 169.58.10.75 | `rmm.` / `api.` / `mesh.` / Redis / MeshCentral |
| `df-b` | 169.58.10.76 | PostgreSQL only |

## Phase 0 — Access, patches, names

### S0 — Confirm SSH and role

**Status:** Passed 2026-10-01.

**Smoke:** key login as root to all three aliases. Hostname, CPU, RAM, and disk match the host table. Ubuntu 24.04.5 on each.

### S1 — OS updates and reboot

**Status:** Passed 2026-10-01.

**Smoke:** each host runs kernel `6.8.0-146-generic`. `apt-get -s upgrade` shows nothing installable. `/var/run/reboot-required` is absent.

### S2 — DNS

**Status:** Passed 2026-10-01. Google DNS may still cache the old `mail` CNAME until about 15:40 SAST. Mail at the InterServer nameservers, Cloudflare, and Quad9 already stays on `192.64.80.67`.

Point these names before any public TLS certificate:

| Name | Address |
|------|---------|
| `digitalfingers.co.za` | 69.164.244.199 |
| `rmm.digitalfingers.co.za` | 169.58.10.75 |
| `api.digitalfingers.co.za` | 169.58.10.75 |
| `mesh.digitalfingers.co.za` | 169.58.10.75 |

**Smoke:** `dig +short` for each name returns only that address. SSH still works. No certificate is requested until this passes.

## Phase 1 — Foundation

Install on the servers, then copy code, templates, and runbooks to GitHub. Do not put live secrets in git.

### S3 — Host baseline

**Status:** Passed 2026-10-01.

On all three: automatic security updates, and a firewall that allows SSH plus only the ports that host needs.

- Portal: 22, 80, 443
- Contabo A: 22, 80, 443, and MeshCentral agent port 4433. Browser sessions use 443 on `mesh.digitalfingers.co.za`
- Contabo B: 22, and Postgres port 5432 from 169.58.10.75 only

Redis port 6379 is not opened. Nothing listens on 80, 443, 4433, or 5432 yet.

**Smoke:** SSH to all three still works after the firewall is on. From the public internet, Postgres is closed. Portal cannot open Contabo A's Redis port. The Mesh and web ports that were allowed on A answer only after S5 and S6; until then they stay closed.

### S4 — PostgreSQL on Contabo B

**Status:** Passed 2026-10-01.

PostgreSQL 16 listens on `127.0.0.1` and `169.58.10.76` only. Database `df_platform` is owned by `df_app`. Connections from Contabo A require TLS. The password is in `/root/df-platform-db.env` on Contabo A and Contabo B, mode 600. It is not in git.

**Smoke:** the database service is active. Contabo A can connect with the application role. Portal cannot connect. The public internet cannot connect to port 5432. A restart of Postgres leaves A able to connect again.

### S5 — Redis on Contabo A

**Status:** Passed 2026-10-01.

Redis 7 listens on `127.0.0.1` and `::1` only. A password is required. It is in `/root/df-redis.env` on Contabo A, mode 600. It is not in git. Port 6379 stays closed in the firewall.

**Smoke:** Redis answers a ping on localhost. Portal and Contabo B cannot reach it. Redis is not listening on a public address.

### S6 — MeshCentral on Contabo A

**Status:** Passed 2026-10-01.

MeshCentral 1.2.5 is the remote engine only. Caddy terminates TLS on ports 80 and 443 and forwards `mesh.digitalfingers.co.za` to MeshCentral on `127.0.0.1:4430`. Agents use port 443 with that certificate. Port 4433 is MeshCentral's Intel AMT port. Public sign-up is off. The admin login is in `/root/df-mesh.env` and a 24-hour install invite is in `/root/df-mesh-invite.txt`, both mode 600 on Contabo A. They are not in git.

**Smoke:** the MeshCentral service is active. `https://mesh.digitalfingers.co.za` presents a valid certificate and the Mesh login. An install invite can be created. Postgres and Redis smokes still pass.

### S7 — Control-plane data and API

**Status:** Passed 2026-10-01.

The API listens on `127.0.0.1:4000` on Contabo A. Caddy serves `https://api.digitalfingers.co.za`. PostgreSQL holds orgs, licenses, customers, sites, devices, users, roles, and audit events. Digital Fingers is org 1. A second test org is org 2, with a device cap of 12. The platform operator login is in `/root/df-api.env` on Contabo A, mode 600. It is not in git. Source is in `api/`.

**Smoke:**

- API health check succeeds.
- Org 1 and a second test org can be created.
- The second org's device cap and module flags are stored.
- Creating an org writes an audit row with the acting user.
- A request without a valid login is rejected.

### S8 — Web console

**Status:** Passed 2026-10-01.

The console is a Next.js app in `console/`, served by Caddy at `https://rmm.digitalfingers.co.za` and bound to `127.0.0.1:3000` on Contabo A. It uses the navy and silver wordmark, Noto Sans, and the website favicon. The org admin for Digital Fingers is `console@digitalfingers.co.za`. The password is in `/root/df-console.env` on Contabo A, mode 600. It is not in git.

**Smoke:** `https://rmm.digitalfingers.co.za` shows the login page with a valid certificate. An org admin can sign in, see an empty device list, and sign out. A wrong password is rejected. The portal host is not serving this console.

### S9 — Linux agent

**Status:** Passed 2026-10-01.

The agent is Go, in `agent/`. It runs on the portal host `vps3231588` (`69.164.244.199`) as user `dfagent`, not on Contabo B. There is no separate test machine yet, so this host is the first enrolled device. The binary is `/usr/local/bin/df-agent`. The enroll file is `/etc/df-agent.env`, mode 600. The device token is `/var/lib/df-agent/state.json`, mode 600. Neither file is in git.

**Smoke:** the agent enrolls into org 1, sends a heartbeat, and the console shows hostname and OS. A script or shell job returns output. The device count on the license goes up by one. An audit row records the enrollment.

### S10 — Remote session from the console

**Status:** Passed 2026-10-01.

The console device row has Open. That calls the API, which checks `remote_desktop`, writes `remote.launch`, and opens MeshCentral on that device. The launch hides Mesh's left admin menu, so the technician does not get My Devices, My Account, or My Server. This host has no graphical desktop, so Open lands on the terminal. A Windows device lands on the desktop. The technician still sees Mesh's device tabs for that machine and can log out. Org 2 is blocked with `remote.deny`. The Mesh agent on `vps3231588` is online.

**Smoke:** from the Linux device row, a browser terminal opened on `vps3231588` and showed `root@vps3231588`. Disconnect returned the page to Disconnected, and Logout returned the Mesh login. Audit action `remote.launch` is by `console@digitalfingers.co.za`. Org 2 received 403 and `remote.deny` by `second@digitalfingers.co.za`. Mesh login still returns HTTP 200. API health still reports Postgres and Redis ok.

### S11 — Windows agent

**Status:** Passed 2026-10-01.

The Windows agent is the same Go program, built as `df-agent.exe`. On Windows it reads `C:\ProgramData\DigitalFingers\df-agent.env`, runs commands with `cmd.exe`, and installs as the `df-agent` service. `FED-WIN-001` is enrolled and linked to the Mesh service agent. The installed program name on that PC is Digital Fingers Agent. The files still live in `C:\Program Files\Mesh Agent`. Windows Defender flagged that Mesh agent, not `df-agent.exe`, as `Trojan:Win32/Bearfoos.B!ml` and `Behavior:Win32/Persistence.A!ml`. Both names are machine-learning detections. On this test PC, Defender exclusions cover those two folders. Customer installs still need Authenticode before this is quiet on other PCs.

**Smoke:** `FED-WIN-001` shows Microsoft Windows 11 Pro in the console. `ver` returned `Microsoft Windows [Version 10.0.26200.9278]`. Open hid My Devices, My Account, and My Server, connected the desktop, Disconnect returned Connect, and Logout returned the Mesh login. Audit `device.enroll` and `remote.launch` for device 2 are by `console@digitalfingers.co.za`. Linux `vps3231588` still heartbeats, `uname -srm` still returns output, and its terminal still opens and closes. SSH to all three hosts still works. API health reports Postgres and Redis ok. Org 2 `remote.deny` remains from S10.

### S12 — License boundaries

**Status:** Passed 2026-10-01.

Org 1 keeps cap 500 and every module on, including `remote_desktop`. Org 2 keeps cap 12, `remote_desktop` off, and no expiry. Enrollment past the cap writes `enroll.deny`. An expired license writes `enroll.deny` and `remote.deny`, and the console hides Open. A module that is off hides Open and writes `remote.deny`. The temporary probe device used to show that hide was removed afterward.

**Smoke:** Org 1 still shows `FED-WIN-001` and `vps3231588`, both with Open, and a remote launch for the Linux host still returns the Mesh terminal page. With org 2's cap set to 0, enroll returned 403 `Device cap reached` and `enroll.deny` reason `device_cap`. With the license expired, enroll and remote both returned 403 `This license has expired`, with `enroll.deny` and `remote.deny` reason `expired`. After restore, the console for `second@digitalfingers.co.za` showed Second Test Org, the text "Remote desktop is not included on this license", and no Open link. Opening that device URL returned to the device list. Org 2 is back to cap 12, no expiry, remote off, and no devices. SSH works on all three hosts. API health reports Postgres and Redis ok.

### S13 — Thin portal

**Status:** Passed 2026-10-01.

The portal is static files in `portal/`, served by Caddy on the InterServer host at `https://digitalfingers.co.za`. The certificate is valid through 30 Dec 2026. Choosing RMM opens the welcome page. Log on goes to `https://rmm.digitalfingers.co.za`. Caddy is the only new service. MeshCentral, Redis, and Postgres are not installed. The existing device agent on this host stays, because this machine is the enrolled Linux device.

**Smoke:** `https://digitalfingers.co.za` shows the service chooser. Choosing RMM shows "Welcome to your Digital Fingers Remote Monitoring and Management Services." and a Log on link. Log on opens the console login at `https://rmm.digitalfingers.co.za`. Listeners are Caddy on 80 and 443 only. MeshCentral, Redis, Postgres, and nginx are inactive. SSH works on all three hosts. Mesh login returns HTTP 200. API health reports Postgres and Redis ok.

### S14 — Phase 1 backup

**Status:** Passed 2026-10-01.

`main` on https://github.com/devdigifingers/RMM-PSA-Design is commit `ee2d076`. It contains the API, console, agent, and portal source, `deploy/caddy/contabo-a.Caddyfile`, `portal/Caddyfile`, `api/.env.example`, `agent/df-agent.env.example`, and [PHASE1_RUNBOOK.md](./PHASE1_RUNBOOK.md). A search of that commit found no live passwords, private keys, or database URLs with credentials. This file still matches the installed hosts: Postgres on Contabo B, Redis and MeshCentral on Contabo A, and the thin portal on InterServer.

**Smoke:** GitHub contains application, agent, and portal source, config templates, `.env.example`, and the runbooks written during S3–S13. A search of the commit finds no live passwords, private keys, or database URLs with credentials. A fresh reading of this file still matches what was installed.

**Phase 1 exit:** S3–S14 passed. That is the same exit as [PHASED_PLAN.md](./PHASED_PLAN.md): enroll Linux and Windows, remote via Mesh, license enforced on a second org, setup backed up to GitHub.

## Phase 2 — Service desk

Starts only after S14. License flag: `ticketing`.

| Step | Work | Smoke pass |
|------|------|------------|
| S15 | Tickets on the same customer and device records | A ticket stores status, priority, assignee, and comments, and links to one customer and one device |
| S16 | Remote from the ticket | The ticket opens a Mesh session on the linked device, then the ticket can be resolved |
| S17 | SLA fields | Response and resolve targets are stored per org and visible on the ticket |
| S18 | Module gate | An org without `ticketing` cannot create a ticket. Org 1 can. Audit rows exist for create and resolve |

### S15 — Tickets

**Status:** Passed 2026-10-01.

A ticket belongs to one customer and one device already stored for the org. It keeps status, priority, assignee, and comments. Creating the ticket attaches an unassigned device to that customer's site. Org 1 has `ticketing` on, so the console shows Tickets.

**Smoke:** The console created customer Digital Fingers office and ticket "Portal agent not reporting disk" on `vps3231588`, priority high, assignee Digital Fingers admin, status open, with a comment. Saving changed the status to pending. A second comment stayed after reload. The ticket list shows that customer, device, pending, high, and the assignee. Audit `customer.create`, `ticket.create`, `ticket.update`, and `ticket.comment` are by `console@digitalfingers.co.za`. SSH works on all three hosts.

### S16 — Remote from the ticket

**Status:** Passed 2026-10-01.

Open remote on a ticket starts the same Mesh session as Open on the device list, for that ticket's device. The launch audit records the ticket. The ticket can then be saved as resolved.

**Smoke:** Open remote on "Portal agent not reporting disk" opened the terminal for `vps3231588`. My Devices, My Account, and My Server stayed hidden. The session showed Connected and `root@vps3231588`. Disconnect returned Connect. Logout returned the Mesh login. Saving the ticket set the status to resolved. The ticket list shows that customer, device, resolved, high, and the assignee. Audit `remote.launch` for device 1 includes ticket 1, and `ticket.update` records status resolved. Both are by `console@digitalfingers.co.za`. SSH works on all three hosts. API health reports Postgres and Redis ok.

### S17 — SLA fields

**Status:** Passed 2026-10-01.

Response and resolve targets are stored once per org, in minutes. The ticket page shows that org's targets. Saving them writes `sla.update`.

**Smoke:** Org 1 saved response 30 minutes and resolve 240 minutes. Ticket "Portal agent not reporting disk" shows "Response 30 minutes. Resolve 240 minutes." after reload. The tickets page keeps those same values. Audit `sla.update` for org 1 is by `console@digitalfingers.co.za`. SSH works on all three hosts. API health reports Postgres and Redis ok.

### S18 — Module gate

**Status:** Passed 2026-10-01.

An org with `ticketing` off cannot open or create tickets. The console hides Tickets and says ticketing is not on the license. A create attempt writes `ticket.deny`. Org 1 still has Tickets, and its create and resolve stay audited.

**Smoke:** `second@digitalfingers.co.za` saw Second Test Org, no Tickets link, and "Ticketing is not included on this license." Opening the tickets address returned to the device list. Creating a ticket returned 403 `Ticketing is not included on this license` and `ticket.deny` reason `module`. Org 2 still has no tickets and `ticketing` off. Org 1 still shows Tickets, including "Portal agent not reporting disk". Audit `ticket.create` and `ticket.update` status resolved remain for that ticket. SSH works on all three hosts. API health reports Postgres and Redis ok.

## Phase 3 — Monitoring

Starts only after S18. License flag: `monitoring`.

| Step | Work | Smoke pass |
|------|------|------------|
| S19 | Agent metrics | CPU, memory, disk, and uptime for the enrolled Linux and Windows devices show in the console |
| S20 | Alert rule | A rule for one device fires, and the alert appears in the inbox |
| S21 | Alert to ticket | With `ticketing` on, the alert can create a ticket linked to that device. With `ticketing` off, it does not |
| S22 | Module gate | An org without `monitoring` has no metrics and no alert inbox |

### S19 — Agent metrics

**Status:** Passed 2026-10-01.

Each heartbeat from the Linux and Windows agents stores CPU, memory, disk, and uptime. The device list shows those four readings for an org with `monitoring` on.

**Smoke:** The console shows both enrolled devices. `vps3231588` shows CPU, memory 16% (332 MB of 1.9 GB), disk 20% (7.6 GB of 37.3 GB), and uptime 11 hours. `FED-WIN-001` shows CPU, memory 74% (3.0 GB of 4.0 GB), disk 53% (42.5 GB of 79.1 GB), and uptime 18 hours. The readings were still there after reload. SSH works on all three hosts. API health reports Postgres and Redis ok.

### S20 — Alert rule

**Status:** Passed 2026-10-01.

A rule watches one metric on one device. When the stored reading is at or above the threshold, an alert is written and shown in the inbox. Creating the rule is audited as `alert.rule`. The firing is audited as `alert.fire`.

**Smoke:** A disk rule for `vps3231588` at or above 10% fired at 20%. The inbox shows that device, Disk, 20%, and "At or above 10%" after reload. `alert.rule` is by `console@digitalfingers.co.za`. SSH works on all three hosts. API health reports Postgres and Redis ok.

### S21 — Alert to ticket

**Status:** Passed 2026-10-01.

An open alert can create a ticket for the device's customer when `ticketing` is on. The inbox then links to that ticket. An org with `ticketing` off is refused and no ticket is stored.

**Smoke:** Create ticket on the disk alert opened "Disk 20% on vps3231588" for Digital Fingers office and `vps3231588`, status open, priority high. The inbox shows Open ticket after reload. `ticket.create` for that ticket includes alert 1 and is by `console@digitalfingers.co.za`. `second@digitalfingers.co.za` received 403 `Ticketing is not included on this license` and `ticket.deny` reason `module`. Org 2 still has no tickets. SSH works on all three hosts. API health reports Postgres and Redis ok.

### S22 — Module gate

**Status:** Passed 2026-10-01.

An org with `monitoring` off has no device metrics and cannot open the alert inbox. The console hides Alerts and says monitoring is not on the license. Creating a rule writes `monitoring.deny`. Org 1 still shows metrics and the inbox.

**Smoke:** `second@digitalfingers.co.za` saw Second Test Org, no Alerts link, and no metrics. Opening the alerts address returned to the device list with "Monitoring is not included on this license." That message was still there after reload. Creating a rule returned 403 `Monitoring is not included on this license` and `monitoring.deny` reason `module`. Org 2 still has `monitoring` off and no alert rules. Org 1 still shows Alerts, CPU, memory, disk, and uptime for both devices. SSH works on all three hosts. API health reports Postgres and Redis ok.

### S23 — Update inventory

**Status:** Passed 2026-10-02.

Each enrolled agent reports the updates waiting on that device. The device list shows them when `patch` is on.

**Smoke:** `vps3231588` lists `libxpm4` 1:3.5.17-1ubuntu0.24.04.1 → 1:3.5.17-1ubuntu0.24.04.2 and `thermald` 2.5.6-2ubuntu0.24.04.5 → 2.5.6-2ubuntu0.24.04.6. `FED-WIN-001` lists Windows Malicious Software Removal Tool x64 - v5.145 (KB890830), 2026-09 .NET Framework Security Update (KB5126052), and 2026-09 Security Update (KB5129195) (26200.9457). Both lists remained after reload. SSH works on all three hosts. API health reports Postgres and Redis ok.

### S24 — Policy

**Status:** Passed 2026-10-02.

A policy is either approve-before-deploy or deploy-without-approval. Approve leaves each update waiting until someone approves that update. Deploy without approval queues the device's updates and does not offer approval. Neither policy installs the update.

**Smoke:** Approve before deploy on `FED-WIN-001` left its three Windows updates waiting. Deploy without approval on `vps3231588` queued `libxpm4` and `thermald` with no Approve button. Approving KB890830 queued only that update. KB5126052 and KB5129195 stayed waiting. The same rows remained after reload. `patch.policy` and `patch.approve` are by `console@digitalfingers.co.za`. SSH works on all three hosts. API health reports Postgres and Redis ok.

### S25 — Deploy job

**Status:** Passed 2026-10-02.

A queued deploy runs on the device through the agent. The console stores succeeded or failed. The agent does not reboot the device.

**Smoke:** KB890830 and KB5126052 on `FED-WIN-001` succeeded, both with reboot false. Those rows remained after reload. `libxpm4` and `thermald` on `vps3231588` failed because the agent cannot install packages, and the failure text remained after reload. KB5129195 was still running. `patch.deploy` records the finished results. SSH works on all three hosts. API health reports Postgres and Redis ok.

### S26 — Compliance

**Status:** Passed 2026-10-02.

The patches page lists patched and missing updates for each customer. An org with `patch` off has no Patches link, and opening the page says patch management is not on the license. A create attempt writes `patch.deny`.

**Smoke:** Digital Fingers office shows `vps3231588` with no patched updates and missing `libxpm4` and `thermald`. `FED-WIN-001` has no customer; it shows KB890830 and KB5126052 patched, and KB5129195 missing. Those rows remained after reload. `second@digitalfingers.co.za` saw Second Test Org, no Patches link, and "Patch management is not included on this license." That message remained after reload. Creating a policy returned 403 and `patch.deny` reason `module`. Org 2 still has `patch` off and no policies. SSH works on all three hosts. API health reports Postgres and Redis ok.

### S27 — Dashboard

**Status:** Passed 2026-10-02.

One org page shows enrolled devices, open tickets, SLA targets, current health, and the same patch compliance as the patches page. The numbers come from the live records.

**Smoke:** Digital Fingers shows 2 enrolled devices, `FED-WIN-001` and `vps3231588`. The only open ticket is "Disk 20% on vps3231588". SLA is response 30 minutes and resolve 240 minutes. Both devices are reporting; CPU, memory, and disk changed after reload. Patch compliance matches the patches page: Digital Fingers office / `vps3231588` has nothing patched and is missing `libxpm4` and `thermald`. `FED-WIN-001` has no customer, shows KB890830 and KB5126052 patched, and KB5129195 missing. The tickets page still lists that disk ticket as open and "Portal agent not reporting disk" as resolved. SSH works on all three hosts. API health reports Postgres and Redis ok.

### S28 — Export

**Status:** Passed 2026-10-02.

A CSV for the org is written on a schedule. It uses the same device, ticket, SLA, and patch counts as the dashboard.

**Smoke:** Scheduling a CSV every minute left the dashboard with no file. After the schedule ran, the file showed 2 devices, 1 open ticket, response 30 minutes, resolve 240 minutes, 2 patched, and 3 missing. Those counts match the dashboard on the same page. The file names Digital Fingers, ticket "Disk 20% on vps3231588", `vps3231588` with 0 patched and 2 missing, and `FED-WIN-001` with 2 patched and 1 missing. Download returned `dashboard.csv` with that same text. The counts remained after reload. SSH works on all three hosts. API health reports Postgres and Redis ok.

### S29 — License usage

**Status:** Passed 2026-10-02.

The license report lists seats, enrolled devices, and the device cap for Digital Fingers and the second org.

**Smoke:** Digital Fingers shows 25 seats, 2 devices, and a cap of 500. Second Test Org shows 5 seats, 0 devices, and a cap of 12. Those rows remained after reload. The device list still says Digital Fingers · 2 enrolled. SSH works on all three hosts. API health reports Postgres and Redis ok.

### S30 — Module gate

**Status:** Passed 2026-10-02.

An org with `reporting` off has no Dashboard link. Opening the dashboard or the export returns to the device list and says reporting is not on the license. Scheduling an export writes `reporting.deny`.

**Smoke:** `second@digitalfingers.co.za` saw Second Test Org, 0 enrolled, and only a Devices link. Opening the dashboard and the export both showed "Reporting is not included on this license." That message remained after reload. Scheduling an export returned 403 and `reporting.deny` reason `module`. The dashboard and the export each returned 403. `canReport` is false and the device count is 0. Digital Fingers still opens the dashboard, including the scheduled CSV. SSH works on all three hosts. API health reports Postgres and Redis ok.

### S31 — GitHub backup of S15–S30

**Status:** Passed 2026-10-02.

Copy the live API, console, agent, and this plan through S30 to GitHub. The commit must not contain live passwords, private keys, or database URLs.

**Smoke:** GitHub `main` is `e5f566e`. It matches local `main` and contains the service desk, monitoring, patch, and reporting source. This file in that commit records S0–S30 as passed. A search of `e5f566e` found no live passwords, private keys, or database URLs with credentials.

### S32 — Scoped org and audit reads

**Status:** Passed 2026-10-02.

A user sees only their own org in the org list and only that org's audit events. A platform admin still sees every org. Looking up another org returns not found. The Digital Fingers license report still lists both orgs.

**Smoke:** `second@digitalfingers.co.za` received only Second Test Org. Org 1 returned 404. Audit events were org 2 only. The dashboard and license report stayed closed. `console@digitalfingers.co.za` received only Digital Fingers in the org list, audit events were org 1 only, and org 2 returned 404. The dashboard still showed 2 devices and the CSV. The license report still listed Digital Fingers at 25 seats and 2 devices, and Second Test Org at 5 seats and 0 devices. The platform admin received both orgs and audit events for org 1 and org 2. SSH works on all three hosts. API health reports Postgres and Redis ok.

### S33 — Daily export

**Status:** Passed 2026-10-02.

The Digital Fingers export runs once a day. Stored files stay at 30 or fewer. The latest file still matches the dashboard counts.

**Smoke:** The dashboard says "CSV once a day. Next file in 23 hours." That line remained after reload. The file still shows 2 devices, 1 open ticket, response 30 minutes, resolve 240 minutes, 2 patched, and 3 missing, matching the dashboard. 23 files are stored, which is inside the limit of 30. SSH works on all three hosts. API health reports Postgres and Redis ok.

### S34 — Allowlisted Linux install

**Status:** Passed 2026-10-02.

A root helper upgrades one package name. The agent asks the helper over a local socket. The agent stays `dfagent` with `NoNewPrivileges`. It has no sudo. A name that is not a package is rejected.

**Smoke:** `libxpm4` on `vps3231588` succeeded and is now `1:3.5.17-1ubuntu0.24.04.2`. The deploy row stayed succeeded after reload. Compliance shows `libxpm4` patched and `thermald` still missing. `thermald` is still `2.5.6-2ubuntu0.24.04.5`. A request for "not a package" was rejected. `sudo -n` for `dfagent` still asks for a password. `NoNewPrivileges` is still yes. SSH works on all three hosts. API health reports Postgres and Redis ok.

### S35 — Command that fits the OS

**Status:** Passed 2026-10-02.

A Windows device starts with `ver`. Any other device starts with `uname -srm`.

**Smoke:** `FED-WIN-001` is Microsoft Windows 11 Pro. Its command box is `ver`. The run returned `Microsoft Windows [Version 10.0.26200.9278]`, and that line remained after reload. `vps3231588` is Ubuntu 24.04.5 LTS. Its command box is `uname -srm`. The run returned `Linux 6.8.0-146-generic x86_64`, and that line remained after reload. SSH works on all three hosts. API health reports Postgres and Redis ok.

## Expansion — one system

Starts only after S35. These steps join the customers, devices, tickets, alerts, patches, remote, and dashboard already built. A step is finished only when its smoke test passes.

### S36 — Customer on every device

**Status:** Passed 2026-10-02.

`FED-WIN-001` is linked to the existing customer Digital Fingers office, the same customer as `vps3231588`. Devices, tickets, patches, and the dashboard show that customer on both devices. No second customer is created. Tickets 1 and 2 stay.

**Smoke:** Both devices show Digital Fingers office on the device list, on patch compliance, and on the dashboard. Those names remained after reload. Ticket "Windows device linked" shows Digital Fingers office and `FED-WIN-001`, and it is resolved. The open ticket is still "Disk 20% on vps3231588". Digital Fingers still has one customer. Second Test Org has no devices. `device.link` for device 2 is by `console@digitalfingers.co.za`. SSH works on all three hosts. API health reports Postgres and Redis ok.

### S37 — Device asset

**Status:** Passed 2026-10-02.

The agent stores make, model, serial, and installed software for each device. Patched and missing come from that installed list together with updates still waiting. `thermald` is not installed. The Windows PC is not rebooted.

**Smoke:** `vps3231588` shows a make, model, and serial. Installed software includes `libxpm4` at `1:3.5.17-1ubuntu0.24.04.2`, and compliance no longer lists it as missing. `thermald` is still missing and is still `2.5.6-2ubuntu0.24.04.5`. `FED-WIN-001` shows a make, model, and serial, and lists installed software. KB5129195 remains missing. Those rows remain after reload. Org 2 sees no assets. SSH works on all three hosts. API health reports Postgres and Redis ok.

### S38 — One path for the work

**Status:** Passed 2026-10-02.

An offline agent, a missing update, or an alert attaches to a ticket for that customer and device. The ticket keeps Open remote and the command that fits the OS. The portal agent may be stopped only for the offline check, and the smoke fails if it is not active again at the end. `thermald` is not installed. The Windows PC is not rebooted.

**Smoke:** The disk alert on `vps3231588` stays on ticket "Disk 20% on vps3231588" for Digital Fingers office. Missing `thermald` is on a ticket for that same customer and device, and the package is not installed. Stopping `df-agent` on the portal opens an offline ticket or alert for `vps3231588` and Digital Fingers office. `df-agent` is active again and last seen is fresh before the step can pass. The ticket for each device still opens remote, and its command box is `ver` on `FED-WIN-001` and `uname -srm` on `vps3231588`. Org 2 cannot open that path. SSH works on all three hosts. API health reports Postgres and Redis ok.

### S39 — Roles that limit actions

**Status:** Passed 2026-10-02.

The technician password is in `/root/df-tech.env` on Contabo A, mode 600. It is not in git.

`owner` and `admin` may run a shell and approve a patch. `tech` may open devices, tickets, and remote, and may not run a shell or approve a patch. The tech password stays out of git and out of this log. The Windows service account stays as it is.

**Smoke:** A tech in Digital Fingers sees the devices and the tickets. Creating a job and approving a patch return 403, and each denial is audited. The console admin still runs `uname -srm` on `vps3231588` and the result is stored. Org 2 is still denied by its license. The tech cannot see org 2. SSH works on all three hosts. API health reports Postgres and Redis ok.

### S40 — SLA clock

**Status:** Passed 2026-10-02.

The response clock starts when the ticket is created and stops at the first comment by an org user. The resolve clock stops when the ticket is resolved. The targets stay 30 and 240 minutes. The ticket and the dashboard show the same clock. Ticket 2 stays open.

**Smoke:** Ticket "Disk 20% on vps3231588" and the dashboard show the same response clock and the same resolve clock against 30 and 240 minutes. The clocks remain after reload. Org 2 has no SLA. The targets are still 30 and 240. SSH works on all three hosts. API health reports Postgres and Redis ok.

## Operations — keep it and tell someone

Starts only after S40. These steps make the live system recoverable and keep the desk from mailing a flood. A step is finished only when its smoke test passes. S41 through S45 have passed.

### S41 — GitHub backup of S36–S40

**Status:** Passed, 2 Oct 2026.

GitHub `main` is `ec0a093`. That commit holds the customer link, device asset, work tickets, role limits, and SLA clock. A search of that commit found no live passwords, private keys, or database URLs. SSH works on all three hosts. API health reports Postgres and Redis ok. The operations plan text in this working tree is not inside that commit.

**Smoke:** GitHub `main` is `ec0a093`. A search of that commit finds no live passwords, private keys, or database URLs. SSH works on all three hosts. API health reports Postgres and Redis ok.

### S42 — Postgres dump

**Status:** Passed, 2 Oct 2026.

Two dumps of `df_platform` are in `/var/backups/df-platform` on Contabo A, mode 600. `pg_restore --list` shows `orgs`, `devices`, and `tickets`. The second run left the first file in place. Nothing was restored. The files are not in git. Contabo B has no copy and still accepts the API. Org 2 has no devices. `df-pg-dump.timer` runs daily at 03:15 UTC and keeps seven dumps. The next run is 3 Oct 2026.

**Smoke:** One dump file on Contabo A lists the `orgs`, `devices`, and `tickets` tables. A second run replaces nothing that is still inside the seven-file cap. The file is not in git. Contabo B still accepts the API. Org 2 still has no devices. SSH works on all three hosts. API health reports Postgres and Redis ok.

### S43 — Mesh dump

**Status:** Passed, 2 Oct 2026.

One archive of `meshcentral-data` is in `/var/backups/df-mesh` on Contabo B, mode 600. It contains `meshcentral.db`. It is not in git. Mesh stayed up. `https://mesh.digitalfingers.co.za` returned HTTP 200. `vps3231588` and `FED-WIN-001` still show in the console. The Mesh password was not printed and was not rotated. `df-mesh-dump.timer` runs daily at 03:45 UTC and keeps seven archives. The next run is 3 Oct 2026.

**Smoke:** One Mesh archive exists on Contabo B and is not in git. `https://mesh.digitalfingers.co.za` still returns HTTP 200. `vps3231588` and `FED-WIN-001` still show in the console. SSH works on all three hosts. API health reports Postgres and Redis ok.

### S44 — One missing-update ticket

**Status:** Passed, 2 Oct 2026.

Further missing updates for a device are added to the oldest open ticket whose subject starts with "Missing" for that customer and device. They do not open another ticket. After the next heartbeats Digital Fingers still has the same nine tickets. "Missing thermald on vps3231588" stays open and `thermald` is still `2.5.6-2ubuntu0.24.04.5`. KB5129195 stays missing on its ticket. Ticket 2 stays "Disk 20% on vps3231588", open, with no comments. Org 2 still has no tickets. `thermald` was not installed. The Windows PC was not rebooted.

**Smoke:** After the next heartbeats, Digital Fingers has no new ticket. `thermald` is still on its ticket and is still `2.5.6-2ubuntu0.24.04.5`. KB5129195 is still missing and still on its ticket. Ticket 2 is still "Disk 20% on vps3231588" and still open. Org 2 still has no tickets. SSH works on all three hosts. API health reports Postgres and Redis ok.

### S45 — Email on a new ticket

**Status:** Passed, 2 Oct 2026.

A new ticket mails `admin@digitalfingers.co.za` through `mail.digitalfingers.co.za`. Tickets that already exist are not mailed. The mail password is in `/root/df-mail.env` on Contabo A, mode 600. It is not in git and it is not in this log. Ticket "Mail check" sent one message and is resolved. Ticket 2 stays "Disk 20% on vps3231588" and open. Org 2 sent nothing.

**Smoke:** One new ticket sends one message and is then resolved. "Disk 20% on vps3231588" stays open and does not send a message. Org 2 sends nothing. The mail password is not in git or this log. SSH works on all three hosts. API health reports Postgres and Redis ok.

## Desk — say what is true

Starts only after S45. These steps put the live source on GitHub, clear an offline ticket when the device is back, mail a breach once, show the audit, and put the clock in the daily file. A step is finished only when its smoke test passes. None of these steps has started. Mesh password rotation stays out until asked.

### S46 — GitHub backup of S42–S45

**Status:** Not started.

The dump scripts, Mesh archive, one missing-update ticket, and new-ticket mail are running on the servers. GitHub `main` is still `ec0a093`, which stops at the SLA clock. The push happens only when asked. Dump files, the Mesh archive, and the mail password stay out of git.

**Smoke:** GitHub `main` contains those scripts and the mail path, and matches this tree. A search of that commit finds no live passwords, private keys, or database URLs. SSH works on all three hosts. API health reports Postgres and Redis ok.

### S47 — Device is back

**Status:** Not started.

A heartbeat from a device that is online resolves the open ticket "Offline on {hostname}" for that device. It does not resolve a missing-update ticket. It does not resolve "Disk 20% on vps3231588". It does not send a message. The agent is not stopped for this check.

**Smoke:** "Offline on vps3231588" and "Offline on FED-WIN-001" are resolved after the next heartbeats. "Missing thermald on vps3231588" and the KB5129195 ticket stay open. Ticket 2 stays open. No new ticket is opened. Org 2 still has no tickets. SSH works on all three hosts. API health reports Postgres and Redis ok.

### S48 — One breach message

**Status:** Not started.

When a response or resolve clock passes its target, one message goes to `admin@digitalfingers.co.za`. A later sweep does not send that message again. Tickets that were already past the target before this step, including "Disk 20% on vps3231588", are not mailed. The targets stay 30 and 240. Org 2 sends nothing.

**Smoke:** One new ticket that is already past 30 minutes sends one message and is then resolved. A second sweep sends nothing more. Ticket 2 stays open and sends nothing. Org 2 sends nothing. The mail password is not in git or this log. SSH works on all three hosts. API health reports Postgres and Redis ok.

### S49 — Audit in the console

**Status:** Not started.

An admin and a technician can open the audit for their own org. The list shows `ticket.mail` and does not show a password. A technician still cannot run a shell. Org 2 does not see Digital Fingers events.

**Smoke:** The console shows the mail audit for "Mail check" and no password. `tech@digitalfingers.co.za` can open that list and a shell still returns 403. Org 2 sees none of those rows. SSH works on all three hosts. API health reports Postgres and Redis ok.

### S50 — Clock in the daily CSV

**Status:** Not started.

The next daily file shows the elapsed response and resolve clocks for open tickets, the same numbers as the dashboard. The schedule stays once a day. Stored files stay within 30. The schedule is not put back to one minute.

**Smoke:** The stored file names ticket 2 and the same response and resolve clocks as the dashboard. The next file is still about a day away. The file count is within 30. Ticket 2 stays open. SSH works on all three hosts. API health reports Postgres and Redis ok.

## Phase 4 — Patch

Starts only after S22. License flag: `patch`.

| Step | Work | Smoke pass |
|------|------|------------|
| S23 | Update inventory | The Linux test device lists apt updates. The Windows test device lists its updates |
| S24 | Policy | One policy approves before deploy. One policy deploys without a manual approve. Each does only what it says |
| S25 | Deploy job | A deploy runs through our agent and stores success or failure |
| S26 | Compliance | The console shows patched and missing updates per customer. An org without `patch` sees none of this |

## Phase 5 — Reporting

Starts only after S26. License flag: `reporting`. Uses events from earlier phases. It does not add a separate product.

| Step | Work | Smoke pass |
|------|------|------------|
| S27 | Dashboard | One org view shows devices, open tickets, SLA, health, and patch compliance from live data |
| S28 | Export | A scheduled PDF or CSV for that org is produced and matches the dashboard counts |
| S29 | License usage | A report lists seats and devices for org 1 and the second org |
| S30 | Module gate | An org without `reporting` cannot open the dashboard or the export |
| S31 | GitHub backup | `main` matches the live API, console, agent, and this plan through S30, with no live secrets |
| S32 | Scoped reads | An org user sees only that org. A platform admin still sees every org |
| S33 | Daily export | The latest CSV matches the dashboard. The next run is a day away. Stored files stay within 30 |
| S34 | Allowlisted Linux install | One named package records success or a clear failure. The agent keeps NoNewPrivileges and has no sudo |
| S35 | Command that fits the OS | A Windows device runs `ver`. A Linux device still runs `uname -srm` |

## Expansion

Starts only after S35. Each step joins the modules already built. Do not start a step whose previous smoke test failed.

| Step | Work | Smoke pass |
|------|------|------------|
| S36 | Customer on every device | Both devices show Digital Fingers office on devices, tickets, patches, and the dashboard. Org 2 still has no devices |
| S37 | Device asset | Both devices show make, model, serial, and installed software. `libxpm4` is no longer missing. `thermald` is still missing and was not installed |
| S38 | One path for the work | Offline, a missing update, and an alert each attach to a ticket for that customer and device. Remote and the OS command stay on the ticket. The portal agent is active again at the end |
| S39 | Roles that limit actions | A tech cannot run a shell or approve a patch. An admin still can. Org 2 stays behind its license |
| S40 | SLA clock | The open ticket and the dashboard show the same response and resolve clocks against 30 and 240 minutes |
| S41 | GitHub backup of S36–S40 | GitHub `main` is `ec0a093`, with no live secrets |
| S42 | Postgres dump | A dump of `df_platform` is stored on Contabo A, not in git, and the live database stays up |
| S43 | Mesh dump | A Mesh archive is stored on Contabo B, Mesh still answers, and both devices remain |
| S44 | One missing-update ticket | Another heartbeat does not open a new ticket. `thermald` and KB5129195 stay on the tickets they already have |
| S45 | Email on a new ticket | One new ticket sends one message and is resolved. Existing tickets are not mailed. Org 2 sends nothing |
| S46 | GitHub backup of S42–S45 | GitHub `main` contains the dumps, the Mesh archive, the one missing ticket, and new-ticket mail, with no live secrets |
| S47 | Device is back | The two offline tickets are resolved. Missing updates and ticket 2 stay open |
| S48 | One breach message | One past-due ticket sends one message and is resolved. Ticket 2 sends nothing |
| S49 | Audit in the console | The mail audit is visible. A technician still cannot run a shell. Org 2 sees only itself |
| S50 | Clock in the daily CSV | The daily file shows the same clocks as the dashboard. The schedule stays once a day |

## Later

OpenClaw, white-label domains, on-prem installs, a separate Mesh relay, and full PSA billing stay out of this sequence. Mesh password rotation stays out until asked. Seats are displayed and not enforced. Contabo A and Contabo B are not enrolled devices. The older missing-update tickets stay as they are.

## Smoke log

| Gate | Date | Result | Evidence |
|------|------|--------|----------|
| S0 | 2026-10-01 | Pass | Root key login. Portal `vps3231588` 1 CPU / 1.9 GB / 38 GB. A `vmi3616352` and B `vmi3616353`, each 4 CPU / 7.8 GB / 96 GB. Ubuntu 24.04.5. |
| S1 | 2026-10-01 | Pass | Kernel `6.8.0-146-generic` on all three. No installable upgrades. Reboot not required. Portal `thermald` left in Ubuntu phasing. |
| S2 | 2026-10-01 | Pass | Authoritative and public resolvers: apex `69.164.244.199`; `rmm`, `api`, and `mesh` `169.58.10.75`. MX `0 mail.digitalfingers.co.za` → `192.64.80.67`. SPF no longer uses `+a`. At check time, `8.8.8.8` still had the old `mail` CNAME for about 3 hours 45 minutes. |
| S3 | 2026-10-01 | Pass | Unattended upgrades already enabled for security. UFW active on all three. SSH open. Public and Portal cannot reach B:5432. Portal cannot reach A:6379. A is allowed to B:5432 and gets connection refused because Postgres is not installed. A:80, A:443, and A:4433 have no listener. |
| S4 | 2026-10-01 | Pass | PostgreSQL 16 active. `df_app` on `df_platform` from Contabo A over TLS. Portal and the public internet are filtered on port 5432. After a restart, A connected again. |
| S5 | 2026-10-01 | Pass | Local ping returned PONG. A ping without the password was rejected. Listeners are `127.0.0.1:6379` and `[::1]:6379` only. Portal, Contabo B, and the public internet are filtered on port 6379. |
| S6 | 2026-10-01 | Pass | MeshCentral active. Let's Encrypt certificate for `mesh.digitalfingers.co.za`, valid through 30 Dec 2026. Login page returned HTTP 200. A device-group invite link was created. Postgres still accepts `df_app`. Redis still answers PONG. |
| S7 | 2026-10-01 | Pass | Health returned ok for Postgres and Redis. Org 1 is Digital Fingers. Org 2 stores device cap 12 and module flags. Both creates are audited as `operator@digitalfingers.co.za`. A request without a login returned 401. |
| S8 | 2026-10-01 | Pass | Login page HTTP 200 with a Let's Encrypt certificate for `rmm.digitalfingers.co.za` through 30 Dec 2026. Org admin signed in, saw an empty device list for Digital Fingers, and signed out. A wrong password stayed on the login page. Creating that admin wrote a `user.create` audit row. Portal ports 80 and 443 are closed. Mesh login and API health still pass. |
| S9 | 2026-10-01 | Pass | Portal host `vps3231588` enrolled into org 1. Console shows hostname, Ubuntu 24.04.5 LTS, and last seen. Device count is 1. Audit action `device.enroll` is by `console@digitalfingers.co.za`. `uname -srm` returned `Linux 6.8.0-146-generic x86_64`. Contabo B has no agent. Mesh login and API health still pass. |
| S10 | 2026-10-01 | Pass | Open on `vps3231588` hid My Devices, My Account, and My Server and opened the terminal. The page showed Connected and `root@vps3231588`. Disconnect showed Disconnected. Logout returned the Mesh login. Audit `remote.launch` is by `console@digitalfingers.co.za`. Org 2 got 403 and `remote.deny`. Mesh HTTP 200. API health ok. |
| S11 | 2026-10-01 | Pass | `FED-WIN-001` enrolled as Microsoft Windows 11 Pro. Console `ver` returned Windows version 10.0.26200.9278. Desktop showed Connected, Disconnect returned Connect, and Logout returned the Mesh login. Audit `device.enroll` and `remote.launch` are by `console@digitalfingers.co.za`. Linux terminal on `vps3231588` still opens and closes. SSH works on all three hosts. API health ok. |
| S12 | 2026-10-01 | Pass | Org 1 still has both devices and Open. Org 2 cap denial, expiry denial, and hidden remote each wrote an audit row for `second@digitalfingers.co.za`. Org 2 was restored to cap 12, remote off, and no devices. SSH works on all three hosts. API health ok. |
| S13 | 2026-10-01 | Pass | `https://digitalfingers.co.za` shows the chooser. RMM shows the welcome text. Log on opens `https://rmm.digitalfingers.co.za`. Certificate through 30 Dec 2026. Portal listeners are Caddy on 80 and 443. MeshCentral, Redis, and Postgres are not installed. SSH works on all three hosts. Mesh HTTP 200. API health ok. |
| S14 | 2026-10-01 | Pass | GitHub `main` commit `ee2d076` has the API, console, agent, portal, Caddy templates, `.env.example` files, and `docs/PHASE1_RUNBOOK.md`. Secret search found no live passwords, private keys, or database URLs. This plan still matches the installed hosts. |
| S15 | 2026-10-01 | Pass | Ticket "Portal agent not reporting disk" links customer Digital Fingers office and device `vps3231588`. Status pending, priority high, assignee Digital Fingers admin, and both comments remained after reload. Audits are by `console@digitalfingers.co.za`. SSH works on all three hosts. |
| S16 | 2026-10-01 | Pass | Open remote on that ticket opened the `vps3231588` terminal, hid My Devices, My Account, and My Server, then Disconnect and Logout closed it. The ticket was saved as resolved. `remote.launch` records ticket 1. SSH works on all three hosts. API health ok. |
| S17 | 2026-10-01 | Pass | Org 1 response 30 minutes and resolve 240 minutes remain on ticket "Portal agent not reporting disk" after reload. `sla.update` is by `console@digitalfingers.co.za`. SSH works on all three hosts. API health ok. |
| S18 | 2026-10-01 | Pass | Org 2 has no Tickets link. Opening tickets shows "Ticketing is not included on this license." Create returned 403 and `ticket.deny` reason `module` for `second@digitalfingers.co.za`. Org 1 still has the ticket, with `ticket.create` and a resolved `ticket.update`. SSH works on all three hosts. API health ok. |
| S19 | 2026-10-01 | Pass | Device list shows CPU, memory, disk, and uptime for `vps3231588` and `FED-WIN-001`. Readings remained after reload. SSH works on all three hosts. API health ok. |
| S20 | 2026-10-01 | Pass | Disk rule for `vps3231588` at or above 10% fired at 20%. Inbox still shows that row after reload. `alert.rule` is by `console@digitalfingers.co.za`. SSH works on all three hosts. API health ok. |
| S21 | 2026-10-01 | Pass | The disk alert created ticket "Disk 20% on vps3231588" for Digital Fingers office and that device. Inbox links to it. Org 2 got 403 and `ticket.deny`, and still has no tickets. SSH works on all three hosts. API health ok. |
| S22 | 2026-10-01 | Pass | Org 2 has no Alerts link and no metrics. Opening alerts shows "Monitoring is not included on this license." Create returned 403 and `monitoring.deny` reason `module`. Org 1 still shows metrics and the inbox. SSH works on all three hosts. API health ok. |
| S23 | 2026-10-02 | Pass | `vps3231588` lists `libxpm4` and `thermald`. `FED-WIN-001` lists KB890830, KB5126052, and KB5129195. Both lists remained after reload. SSH works on all three hosts. API health ok. |
| S24 | 2026-10-02 | Pass | Approve before deploy on `FED-WIN-001` waited. Deploy without approval queued `libxpm4` and `thermald`. Approving KB890830 queued only that update. Nothing was installed. SSH works on all three hosts. API health ok. |
| S25 | 2026-10-02 | Pass | KB890830 and KB5126052 succeeded with reboot false. `libxpm4` and `thermald` failed and the failure stayed after reload. KB5129195 was still running. SSH works on all three hosts. API health ok. |
| S26 | 2026-10-02 | Pass | Digital Fingers office shows `vps3231588` missing `libxpm4` and `thermald`. Org 2 has no Patches link. Opening patches shows the license message. Create returned 403 and `patch.deny` reason `module`. SSH works on all three hosts. API health ok. |
| S27 | 2026-10-02 | Pass | Digital Fingers dashboard shows 2 devices, open ticket "Disk 20% on vps3231588", SLA 30 and 240, live health, and the same patch rows as the patches page. SSH works on all three hosts. API health ok. |
| S28 | 2026-10-02 | Pass | A scheduled CSV for Digital Fingers matches the dashboard: 2 devices, 1 open ticket, SLA 30 and 240, 2 patched, 3 missing. Download is `dashboard.csv`. SSH works on all three hosts. API health ok. |
| S29 | 2026-10-02 | Pass | License usage lists Digital Fingers at 25 seats and 2 devices, cap 500, and Second Test Org at 5 seats and 0 devices, cap 12. The device list still shows 2 enrolled. SSH works on all three hosts. API health ok. |
| S30 | 2026-10-02 | Pass | Second Test Org has no Dashboard link. Opening the dashboard and the export shows the license message. Schedule returned 403 and `reporting.deny` reason `module`. Digital Fingers still opens the dashboard and the CSV. SSH works on all three hosts. API health ok. |
| S31 | 2026-10-02 | Pass | GitHub `main` is `e5f566e` and matches local `main`. It has the API, console, and agent through the reporting gate. A search of that commit found no live passwords, private keys, or database URLs. |
| S32 | 2026-10-02 | Pass | Second Test Org sees only itself. Org 1 is not found. Audit events are org 2 only. Digital Fingers still opens the dashboard, the CSV, and the license report for both orgs. The platform admin sees both orgs and both audit orgs. SSH works on all three hosts. API health ok. |
| S33 | 2026-10-02 | Pass | Digital Fingers CSV is once a day, next file in 23 hours, and still matches the dashboard: 2 devices, 1 open ticket, SLA 30 and 240, 2 patched, 3 missing. 23 files are stored, inside the limit of 30. SSH works on all three hosts. API health ok. |
| S34 | 2026-10-02 | Pass | `libxpm4` on `vps3231588` upgraded to `1:3.5.17-1ubuntu0.24.04.2`. `thermald` was not changed. The agent user is `dfagent`, `NoNewPrivileges` is yes, and sudo still asks for a password. SSH works on all three hosts. API health ok. |
| S35 | 2026-10-02 | Pass | `FED-WIN-001` command is `ver` and returned `Microsoft Windows [Version 10.0.26200.9278]`. `vps3231588` command is `uname -srm` and returned `Linux 6.8.0-146-generic x86_64`. Both lines remained after reload. SSH works on all three hosts. API health ok. |
| S36 | 2026-10-02 | Pass | Both devices show Digital Fingers office on devices, patches, and the dashboard after reload. Ticket "Windows device linked" for `FED-WIN-001` is resolved. The open ticket is still "Disk 20% on vps3231588". One customer. Org 2 has no devices. `device.link` is by `console@digitalfingers.co.za`. SSH works on all three hosts. API health ok. |
| S37 | 2026-10-02 | Pass | `vps3231588` is QEMU, Ubuntu 24.04 PC, serial `ab3c914e-b579-44be-9338-67267582dd08`, with 536 packages. `libxpm4` is `1:3.5.17-1ubuntu0.24.04.2` and is patched. `thermald` is still `2.5.6-2ubuntu0.24.04.5` and still missing. `FED-WIN-001` is innotek GmbH VirtualBox, serial `VirtualBox-87859da1-b350-483f-98f7-df3dee79ac23`, with 32 programs. KB5129195 is still missing. Rows remained after reload. Org 2 has no devices. SSH works on all three hosts. API health ok. |
| S38 | 2026-10-02 | Pass | Disk alert stays on "Disk 20% on vps3231588" for Digital Fingers office. "Missing thermald on vps3231588" is open for that customer and device. `thermald` is still `2.5.6-2ubuntu0.24.04.5`. Stopping `df-agent` opened "Offline on vps3231588". The agent is active again and last seen is 02 Oct 2026, 09:04. Tickets open remote. Command is `ver` on `FED-WIN-001` and `uname -srm` on `vps3231588`. Org 2 ticketing returns 403. SSH works on all three hosts. API health ok. |
| S39 | 2026-10-02 | Pass | `tech@digitalfingers.co.za` sees both devices and the tickets, including Open remote, and does not see Second Test Org. A shell and a patch approval return 403. `job.deny` and `patch.deny` are by that technician, reason `role`. The console admin ran `uname -srm` on `vps3231588`; job 8 stored `Linux 6.8.0-146-generic x86_64`. Org 2 ticketing and patch approval stay denied by its license. The admin license report still lists both orgs. SSH works on all three hosts. API health ok. |
| S40 | 2026-10-02 | Pass | Ticket "Disk 20% on vps3231588" stays open and shows Response 663 of 30 minutes and Resolve 663 of 240 minutes. The dashboard shows the same clock after reload. Targets on the tickets page stay 30 and 240. Org 2 has no SLA. SSH works on all three hosts. API health ok. |
| S41 | 2026-10-02 | Pass | GitHub `main` is `ec0a093`. The API, console, and agent match that commit. A search found no live passwords, private keys, or database URLs. SSH works on all three hosts. API health reports Postgres and Redis ok. |
| S42 | 2026-10-02 | Pass | Two dumps of `df_platform` are on Contabo A, mode 600. `pg_restore --list` shows `orgs`, `devices`, and `tickets`. The second run left the first file in place. The files are not in git. Contabo B has no dump and still accepts the API. Org 2 has no devices. SSH works on all three hosts. API health reports Postgres and Redis ok. |
| S43 | 2026-10-02 | Pass | One Mesh archive is on Contabo B, mode 600, and contains `meshcentral.db`. It is not in git. `https://mesh.digitalfingers.co.za` returned HTTP 200. `vps3231588` and `FED-WIN-001` still show in the console. The Mesh password was not printed and was not rotated. SSH works on all three hosts. API health reports Postgres and Redis ok. |
| S44 | 2026-10-02 | Pass | After the next heartbeats Digital Fingers still has nine tickets. `thermald` is still `2.5.6-2ubuntu0.24.04.5` on "Missing thermald on vps3231588". KB5129195 is still missing on its ticket. Ticket 2 is still "Disk 20% on vps3231588" and still open. Org 2 still has no tickets. SSH works on all three hosts. API health reports Postgres and Redis ok. |
| S45 | 2026-10-02 | Pass | Ticket "Mail check" sent one message to `admin@digitalfingers.co.za` and is resolved. Ticket 2 is still "Disk 20% on vps3231588" and still open. Org 2 sent nothing. The mail password is mode 600 and is not in git or this log. SSH works on all three hosts. API health reports Postgres and Redis ok. |
| S46 | | Not run | Waiting for GitHub `main` to contain the live source through S45. |
| S47 | | Not run | Waiting for the offline tickets to resolve when the devices are back. |
| S48 | | Not run | Waiting for one past-due ticket to send one message. |
| S49 | | Not run | Waiting for the audit list in the console. |
| S50 | | Not run | Waiting for the daily file to show the clocks. |
