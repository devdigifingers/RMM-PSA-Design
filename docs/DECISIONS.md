# Decision log (locked)

Durable record for Cursor Desktop / GitHub. Full narrative: [CHAT_HANDOFF.md](./CHAT_HANDOFF.md).

**Last updated:** 2026-10-01  
**GitHub:** https://github.com/devdigifingers/RMM-PSA-Design

## Product

- Owned **multi-tenant MSP platform** (RMM + PSA) under **Digital Fingers**.
- Not a TacticalRMM fork.
- Operator mode (our customers) + vendor mode (licensed orgs).
- **Truly unified** data model: org → customer/site → device → user; modules attach later.
- Roadmap modules: service desk, monitoring, patch, advanced reporting (phased; list incomplete on purpose).

## Remote engine

- **MeshCentral** self-hosted = GUI remote engine.
- Do **not** build remote desktop from scratch.
- Guacamole + UltraVNC rejected as primary remote stack.
- Own control plane owns tenants, agents, scripts, licensing, audit.
- Linux agent install: no vendor code-signing token gate; we issue Mesh/enroll invites.
- Windows Authenticode optional later (SmartScreen only).

## OpenClaw

- AI assistant layer only; **not** the RMM/PSA.
- **Out of Phase 1.** Revisit after our APIs exist.
- Do not depend on third-party RMM OpenClaw skills (Tactical/Datto/etc.).

## Agents & stack

- Go agents: Linux first, then Windows `.exe`.
- Next.js UI · API · Redis · Postgres · MeshCentral.

## Hosting & OS

| Host | Role | OS |
|------|------|-----|
| InterServer 2 GB / 40 GB | Portal `digitalfingers.co.za` only | Ubuntu 24.04 LTS |
| Contabo A 8 GB / 100 GB | App, API, Redis, MeshCentral | Ubuntu 24.04 LTS |
| Contabo B 8 GB / 100 GB | PostgreSQL only | Ubuntu 24.04 LTS |

- Prefer Ubuntu over AlmaLinux for this stack (docs, Docker, MeshCentral path).
- Same Ubuntu major on all three. 22.04 acceptable only if 24.04 unavailable — keep all three matched.
- Contabo A + B same region.
- InterServer never runs MeshCentral.

## Portal UX

- Service icons → RMM welcome → Log on → `rmm.digitalfingers.co.za`.
- Thin portal first; separate host from RMM.

## Server vs GitHub workflow

- Agent takes **root SSH** on all three servers.
- OS updates + installs **on the servers from scratch**.
- Build POC on servers; **push to GitHub** as backup / DR proof.
- Not “deploy from GitHub to servers” as the primary Phase 1 workflow.
- Crash later → rebuild from GitHub backup + DB/Mesh dumps.

## Phased delivery

See [PHASED_PLAN.md](./PHASED_PLAN.md): 0 planning → 1 foundation → 2 PSA → 3 monitoring → 4 patch → 5 reporting.  
Step-by-step order and the smoke test after each step: [EXECUTION_PLAN.md](./EXECUTION_PLAN.md).
