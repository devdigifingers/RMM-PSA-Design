# Execution plan — phased steps and smoke gates

**Last updated:** 2026-10-01  
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

Portal `thermald` is held by Ubuntu's phased rollout. That hold is accepted. It is not a failed gate.

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

## Phase 3 — Monitoring

Starts only after S18. License flag: `monitoring`.

| Step | Work | Smoke pass |
|------|------|------------|
| S19 | Agent metrics | CPU, memory, disk, and uptime for the enrolled Linux and Windows devices show in the console |
| S20 | Alert rule | A rule for one device fires, and the alert appears in the inbox |
| S21 | Alert to ticket | With `ticketing` on, the alert can create a ticket linked to that device. With `ticketing` off, it does not |
| S22 | Module gate | An org without `monitoring` has no metrics and no alert inbox |

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

## Later

OpenClaw, white-label domains, on-prem installs, and a separate Mesh relay are out of this sequence. Revisit them only after S30.

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
| S15–S30 | | Not run | |
