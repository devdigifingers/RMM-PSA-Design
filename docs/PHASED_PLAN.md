# Unified MSP Platform — Phased Plan

Multi-tenant **RMM + PSA** for **Digital Fingers**: operate as a support company, and license the same system to other companies.

**Complete chat capture for IDE:** [CHAT_HANDOFF.md](./CHAT_HANDOFF.md) · [DECISIONS.md](./DECISIONS.md) · [SETUP_AND_DR.md](./SETUP_AND_DR.md) · **Step order and smoke gates:** [EXECUTION_PLAN.md](./EXECUTION_PLAN.md)

**Last updated:** 2026-10-01

## Architecture (locked)

| Layer | Choice |
|-------|--------|
| Control plane | Multi-tenant orgs → customers/sites → devices → users/RBAC |
| Commercial | Per-org license + seats/devices + module feature flags |
| Remote GUI | Self-hosted **MeshCentral** (remote engine only) |
| Agents | Go agents (Linux first, then Windows `.exe`) + Mesh enrollment |
| Stack | Next.js UI · API · Redis · Postgres · MeshCentral |
| OS (all VPS) | **Ubuntu 24.04 LTS** |
| Hosting | Contabo A (app/Mesh) + Contabo B (Postgres) + InterServer (portal) |
| OpenClaw | Later AI layer only — not Phase 1 |

**Unified rule:** One customer/device/user graph and an event/audit stream from Phase 1 so later modules plug in without silos.

### Host roles

| Host | Specs | OS | Role |
|------|-------|-----|------|
| **InterServer** | 2 GB / 40 GB | Ubuntu 24.04 LTS | `digitalfingers.co.za` service chooser / welcome → Log on |
| **Contabo A** | 8 GB / 100 GB | Ubuntu 24.04 LTS | `rmm.` / API / Redis / MeshCentral |
| **Contabo B** | 8 GB / 100 GB | Ubuntu 24.04 LTS | PostgreSQL |

Portal flow: `digitalfingers.co.za` → **RMM** → welcome → **Log on** → `rmm.digitalfingers.co.za`.

### Server vs GitHub

- Build **on servers** via SSH (OS update, install from scratch).  
- **Push to GitHub** as POC/DR backup.  
- Not primary “deploy from GitHub” for Phase 1.

---

## Phase 0 — Planning & infra (current)

- [x] Product direction and remote-engine decision (MeshCentral)
- [x] Hosting layout (2× Contabo + InterServer portal)
- [x] Portal concept (`digitalfingers.co.za` service chooser → RMM welcome → Log on)
- [x] OS choice: Ubuntu 24.04 LTS on all three
- [x] Server-first + GitHub backup workflow
- [x] OpenClaw deferred
- [x] Full handoff docs for IDE move
- [x] Order / provision Contabo A and Contabo B (Ubuntu 24.04, same region)
- [x] Confirm InterServer on Ubuntu 24.04
- [x] Hand over root SSH (Portal + A + B)
- [x] OS updates and reboot (kernel `6.8.0-146-generic` on all three)
- [x] Point DNS: portal → InterServer; `rmm.` / `mesh.` / `api.` → Contabo A

**Exit criteria:** All three servers reachable on Ubuntu 24.04; DNS records match [EXECUTION_PLAN.md](./EXECUTION_PLAN.md) step S2. Work proceeds one step at a time, and only after that step's smoke test passes.

---

## Phase 1 — Foundation (first build)

**Goal:** Usable multi-tenant remote support core you own.

| Deliverable | Notes |
|-------------|--------|
| Org / site / customer / device model | Schema ready for PSA later |
| Users, roles, audit log | Every sensitive action attributed |
| License binding | Plan, seats, device cap, expiry, module flags |
| Linux agent | Enroll, heartbeat, inventory basics, scripts/shell |
| Windows agent `.exe` | Same protocol after Linux path works |
| MeshCentral integration | Install invites; browser remote sessions |
| Web console | Device list, remote launch, basic admin |
| Event stream | Foundation for monitoring/tickets/reporting later |
| Setup → GitHub backup | Scripts/configs/runbooks pushed as DR archive |

**Out of scope for Phase 1:** Full service desk, patch, deep monitoring, advanced BI, OpenClaw.

**Exit criteria:** Enroll Linux + Windows, remote via Mesh, enforce a license on a second org; key setup backed up to GitHub.

**Infra fit:** 2× Contabo 8 GB + InterServer portal is enough for this phase.

---

## Phase 2 — PSA / Service Desk

**Goal:** Ticketing on the same customers and devices.

| Deliverable | Notes |
|-------------|--------|
| Tickets | Status, priority, assignment, comments |
| Links | Ticket ↔ customer ↔ device |
| SLA basics | Response/resolve targets per org |
| Remote from ticket | Open Mesh session on linked device |
| Time notes (light) | Optional; full PSA billing can wait |

**License module:** `ticketing`

**Exit criteria:** Tech workflow ticket → device → remote → resolve.

---

## Phase 3 — Monitoring

**Goal:** Health and alerts on the same device graph.

| Deliverable | Notes |
|-------------|--------|
| Agent metrics | CPU, memory, disk, uptime, service checks |
| Alert rules | Per org/site/device |
| Alert → ticket | Optional auto-create (uses Phase 2) |
| Console views | Device health, alert inbox |

**License module:** `monitoring`

**Infra note:** Metric retention may push Postgres disk/RAM; tune retention before buying more hardware.

---

## Phase 4 — Patch management

**Goal:** Approve/deploy/report patches per customer fleet.

| Deliverable | Notes |
|-------------|--------|
| Inventory of updates | Windows + Linux (apt-first) |
| Policies | Auto vs approve |
| Deploy jobs | Via your agents |
| Compliance view | Per customer / org |

**License module:** `patch`

---

## Phase 5 — Unified reporting

**Goal:** Cross-module reporting (not a separate BI product).

| Deliverable | Notes |
|-------------|--------|
| Executive dashboards | Devices, tickets, SLAs, health, patch compliance |
| Scheduled exports | PDF/CSV per org |
| License usage reports | Seats/devices for your billing |

Depends on clean events from Phases 1–4.

---

## Later / optional

- OpenClaw (or similar) skill on **our** APIs for chat/ops
- White-label (logo, custom domain per licensee)
- On-prem install for large licensees
- Dedicated MeshCentral relay VPS when concurrent remotes grow
- Full PSA (contracts, billing, quoting) beyond service desk

---

## Module license map

| Module | Phase | Flag (example) |
|--------|-------|----------------|
| Core + remote | 1 | `core`, `remote_desktop` |
| Service desk | 2 | `ticketing` |
| Monitoring | 3 | `monitoring` |
| Patch | 4 | `patch` |
| Advanced reports | 5 | `reporting` |

Digital Fingers runs as **Org #1** (operator). Paying companies are additional orgs with purchased modules.

---

## Scale triggers

| Signal | Action |
|--------|--------|
| Concurrent Mesh remotes lagging | Larger Contabo A or split Mesh to its own VPS |
| DB/metrics growth | Larger Contabo B or retention policies |
| Many licensee orgs | Workers/queue node; consider regional app later |

---

## Next action

1. Read [EXECUTION_PLAN.md](./EXECUTION_PLAN.md). S0 through S14 have passed. Phase 1 is complete.
2. Continue at **S15 tickets**. Do not start a step whose previous smoke test failed.
