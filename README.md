# Digital Fingers — Unified MSP Platform (RMM + PSA)

Self-hosted, multi-tenant remote monitoring & management with **MeshCentral** as the remote engine, growing into service desk, monitoring, patch, and unified reporting.

## Status

**Planning complete and documented for IDE handoff (2026-10-01).**  
**GitHub:** https://github.com/devdigifingers/RMM-PSA-Design  
Implementation starts at Phase 1 when all three Ubuntu servers and SSH access are available.

| Doc | Contents |
|-----|----------|
| **[docs/CHAT_HANDOFF.md](docs/CHAT_HANDOFF.md)** | **Complete update of the planning chat — start here in the IDE** |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Locked decisions |
| [docs/PHASED_PLAN.md](docs/PHASED_PLAN.md) | Phases, modules, exit criteria |
| [docs/SETUP_AND_DR.md](docs/SETUP_AND_DR.md) | Server-first work, GitHub backup, IDE move |

## Hosting

| Server | OS | Role |
|--------|-----|------|
| InterServer — 2 GB / 40 GB | Ubuntu 24.04 LTS | `digitalfingers.co.za` portal |
| Contabo A — 8 GB / 100 GB | Ubuntu 24.04 LTS | RMM app, API, Redis, MeshCentral |
| Contabo B — 8 GB / 100 GB | Ubuntu 24.04 LTS | PostgreSQL |

**Workflow:** SSH-build on servers → push POC/setup to GitHub for DR. OpenClaw deferred.

## Phases (summary)

1. **Foundation** — tenants, licenses, agents, Mesh remote  
2. **PSA** — service desk / ticketing  
3. **Monitoring** — metrics & alerts  
4. **Patch** — patch management  
5. **Reporting** — cross-module reports  

## Local / IDE

Application code lands in Phase 1 on the VPS; this repo currently holds the full plan.  
In Cursor Desktop, open `docs/CHAT_HANDOFF.md` and use the paste prompt in §8.
