# Chat handoff — complete planning record

**Purpose:** Single document to open in Cursor Desktop so nothing from the cloud planning chat is lost.  
**Brand:** Digital Fingers (`digitalfingers.co.za`)  
**Last updated:** 2026-10-01  
**GitHub (canonical backup):** https://github.com/devdigifingers/RMM-PSA-Design  
**Branch:** `cursor/platform-phased-plan-b80e`

Related docs: [DECISIONS.md](./DECISIONS.md) · [PHASED_PLAN.md](./PHASED_PLAN.md) · [SETUP_AND_DR.md](./SETUP_AND_DR.md)

---

## 1. What we are building

Owned **multi-tenant MSP platform** (RMM + PSA), operated by Digital Fingers and licensable to other support companies.

- **Not** a TacticalRMM fork or skin.
- **Not** remote desktop written from scratch.
- **Truly unified:** one org → customers/sites → devices → users; tickets, alerts, patches, reports attach to the same graph later.
- Module list will grow; service desk, patch, monitoring, next-level reporting are in scope but **phased**.

### Two commercial modes (same codebase)

1. **Operator** — Digital Fingers supports its own customers on the platform.  
2. **Licensor** — other companies buy an org license + modules and manage their own fleets.

---

## 2. Locked architecture

| Layer | Decision |
|-------|----------|
| Control plane | Multi-tenant orgs, sites/customers, devices, RBAC, audit |
| Licensing | Per-org plan: seats, device caps, expiry, feature flags |
| Remote GUI | Self-hosted **MeshCentral** (remote engine only) |
| Rejected for primary remote | Guacamole + UltraVNC (thinner but weaker for dual-OS + NAT) |
| Agents | **Go** — Linux first, then Windows `.exe`; Mesh enrollment for desktop |
| App stack | Next.js UI · API · Redis · Postgres · MeshCentral |
| Portal | Separate site: service chooser → branded welcome → Log on |

### Why MeshCentral (not Guacamole)

- Stronger remote platform for Windows + Linux and hard networks.  
- Guacamole is a gateway; you still babysit VNC/RDP.  
- Control plane stays ours; Mesh only owns the screen session.  
- Self-hosted Mesh = **no Tactical-style vendor “code sign token” gate** for Linux installs. Enrollment invites are ours. Windows Authenticode optional later for SmartScreen only.

### OpenClaw

- OpenClaw is an **AI assistant / skills agent**, not an RMM.  
- **Not** on the Phase 1 critical path.  
- Optional **later** as a chat/ops layer on top of *our* APIs.  
- Do **not** use OpenClaw’s Tactical/Datto skills as a shortcut — that ties us to other products.

---

## 3. Hosting (three servers)

| Host | Specs | Role | OS |
|------|-------|------|-----|
| **InterServer** | 2 GB RAM / 40 GB | `digitalfingers.co.za` brand portal / service chooser only | **Ubuntu 24.04 LTS** |
| **Contabo A** | 8 GB / 100 GB / 4 vCPU | RMM app, API, Redis, MeshCentral, TLS proxy | **Ubuntu 24.04 LTS** |
| **Contabo B** | 8 GB / 100 GB / 4 vCPU | PostgreSQL only | **Ubuntu 24.04 LTS** |

- Same Contabo **region** for A and B.  
- InterServer is **not** for MeshCentral (too small; wrong role).  
- Portal must **not** run on Contabo A.  
- Rejected: putting Mesh on InterServer 2 GB; mixing three weak mismatched roles without Contabo pair.  
- Growth will need more resources later (expected). Scale triggers: Mesh concurrency → bigger A or Mesh split; metrics/DB → bigger B or retention.

### Domains (planned)

| Host | Hostname |
|------|----------|
| Portal | `digitalfingers.co.za` → InterServer |
| RMM UI | `rmm.digitalfingers.co.za` → Contabo A |
| API (optional split) | `api.digitalfingers.co.za` → Contabo A |
| Mesh | `mesh.digitalfingers.co.za` → Contabo A |

### Portal UX

1. Tenant lands on `digitalfingers.co.za`.  
2. Clicks service icon (e.g. **RMM**).  
3. Welcome: *Welcome to your Digital Fingers Remote Monitoring and Management Services…*  
4. **Log on** → `rmm.digitalfingers.co.za`.  
5. Later buttons: Service Desk, etc.

Thin portal first; full marketing site does not block Phase 1.

---

## 4. How we work on servers vs GitHub

**Server-first POC (owner’s rule — locked):**

1. Agent gets **root SSH** on all three servers.  
2. Agent runs OS updates and installs/configures apps **on the servers from scratch**.  
3. We build and prove the stack **on those machines**.  
4. We **push code, configs, and setup process docs to GitHub** as backup / proof of concept.  
5. We are **not** treating GitHub as “CI deploy → servers” for this phase.

**Direction:**

- **Now:** servers → GitHub (backup POC + runbooks).  
- **If crash later:** GitHub (+ DB/Mesh backups) → rebuild servers.

Never commit live secrets; commit `.env.example` and runbooks only.

---

## 5. Phased delivery

| Phase | Focus | Status |
|-------|--------|--------|
| **0** | Planning, OS choice, hosting, portal concept, SSH handoff | Docs done; await Contabo + access |
| **1** | Foundation: tenants, licenses, Linux then Windows agents, Mesh remote, audit/events | Next |
| **2** | PSA / service desk (tickets ↔ customer/device; remote from ticket) | Later |
| **3** | Monitoring & alerts (optional alert → ticket) | Later |
| **4** | Patch management | Later |
| **5** | Unified / next-level reporting | Later |

Phase 1 must still create shared IDs + event/audit stream so later modules stay unified.

### License module flags (examples)

`core` · `remote_desktop` · `ticketing` · `monitoring` · `patch` · `reporting`

Digital Fingers = Org #1 (operator). Paying companies = additional orgs.

Full exit criteria: [PHASED_PLAN.md](./PHASED_PLAN.md).

---

## 6. Discussion timeline (condensed)

1. Explored building own tactical RMM; advised Linux-first desired-state + mesh + audit, not cloning Tactical.  
2. Scope: own fleet + MSP clients; Windows required; GUI remote wanted; UltraVNC discussed.  
3. Chose **MeshCentral** as remote engine over Guacamole/UltraVNC.  
4. Confirmed no Tactical-style Linux sign-token gate when Mesh is self-hosted.  
5. Infra: early 4 GB ideas → Contabo 8 GB DB → **2× Contabo 8 GB** (app + DB); InterServer for **portal**.  
6. Product expanded to unified RMM + PSA (ticketing, patch, monitoring, reporting — phased).  
7. Portal concept for `digitalfingers.co.za` service launcher.  
8. Move to IDE + GitHub for durability; then clarified **server-first**, GitHub as backup.  
9. OpenClaw: optional later AI layer only.  
10. OS: **Ubuntu 24.04 LTS** on all three (not AlmaLinux for this stack).

---

## 7. IDE move checklist

- [x] GitHub repo created: https://github.com/devdigifingers/RMM-PSA-Design.git  
- [ ] Push this planning branch into that GitHub repo (Git Desktop / commands below).  
- [ ] Open **RMM-PSA-Design** in **Cursor Desktop**.  
- [ ] Checkout `cursor/platform-phased-plan-b80e` (or merge to `main`).  
- [ ] Point new IDE chat at this file + `DECISIONS.md` + `PHASED_PLAN.md`.  
- [ ] Order/provision Contabo A + B (Ubuntu 24.04), same region.  
- [ ] Confirm InterServer on Ubuntu 24.04 for portal.  
- [ ] Hand agent root SSH for all three + domain DNS access/plan.  
- [ ] Start Phase 1 on Contabo; thin portal on InterServer in parallel or pre-go-live.

### Push planning docs into your GitHub repo (run locally / in Desktop terminal)

If the cloud project is already open locally with these commits:

```bash
git remote add github https://github.com/devdigifingers/RMM-PSA-Design.git
# or, if you prefer github as origin after cloning empty repo:
# git remote set-url origin https://github.com/devdigifingers/RMM-PSA-Design.git

git push -u github cursor/platform-phased-plan-b80e
git push github main
```

Then in Desktop: clone/open `devdigifingers/RMM-PSA-Design`, checkout `cursor/platform-phased-plan-b80e`, open `docs/CHAT_HANDOFF.md`.

---

## 8. First message to paste in the IDE agent

```text
Continue Digital Fingers MSP platform from docs/CHAT_HANDOFF.md,
docs/DECISIONS.md, and docs/PHASED_PLAN.md.

Locked: MeshCentral remote engine, multi-tenant + licenses,
Ubuntu 24.04 on InterServer (portal) + Contabo A (app/Mesh) +
Contabo B (Postgres). Server-first: SSH, build on servers,
backup code/setup to GitHub. OpenClaw later only. Start Phase 1
when SSH is available.
```
