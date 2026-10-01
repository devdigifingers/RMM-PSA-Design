# Setup, servers, GitHub backup, and IDE move

**Last updated:** 2026-10-01  
Full context: [CHAT_HANDOFF.md](./CHAT_HANDOFF.md)

## Operating model (locked)

| Step | What happens |
|------|----------------|
| 1 | Owner provisions three Ubuntu 24.04 VPS and hands **root SSH** |
| 2 | Agent SSHs in, runs OS updates, installs stack **on the servers** |
| 3 | POC is built and proven **on Contabo / InterServer** |
| 4 | Code, compose/templates, and setup runbooks are **pushed to GitHub** |
| 5 | GitHub is the **backup / DR archive**, not the day-one deploy pipeline |

**Now:** servers → GitHub. **After a crash:** GitHub (+ dumps) → new servers.

## Servers to hand over

| Alias | Provider | Spec | OS | Role |
|-------|----------|------|-----|------|
| Portal | InterServer | 2 GB / 40 GB | Ubuntu 24.04 LTS | `digitalfingers.co.za` |
| A | Contabo | 8 GB / 100 GB | Ubuntu 24.04 LTS | App + Mesh + API + Redis |
| B | Contabo | 8 GB / 100 GB | Ubuntu 24.04 LTS | Postgres |

When ready, send for each: hostname/IP, root (or sudo) auth, and role label (Portal / A / B), plus domain DNS plan.

## Move planning → Cursor Desktop

**GitHub repo:** https://github.com/devdigifingers/RMM-PSA-Design

1. Push the planning commits into that repo (see [CHAT_HANDOFF.md §7](./CHAT_HANDOFF.md)).  
2. Open/clone **RMM-PSA-Design** in **Cursor Desktop**.  
3. Branch: `cursor/platform-phased-plan-b80e` (or merge to `main`).  
4. New IDE chat: paste the prompt from [CHAT_HANDOFF.md §8](./CHAT_HANDOFF.md).  

Cloud chat history may not fully follow you. **`docs/CHAT_HANDOFF.md` is the complete update.**

## What we push to GitHub (backup)

| Artifact | Purpose |
|----------|---------|
| App / agent / portal source | Rebuild software |
| `docs/*` | Plan and decisions |
| Install & backup scripts | Repeat OS/app setup |
| Compose / config **templates** | Non-secret configuration |
| `.env.example` | Placeholder env keys |

**Never commit:** live passwords, TLS keys, Mesh secrets, DB credentials.

## DR sketch (after backups exist)

1. Rebuild Contabo B → restore Postgres dump.  
2. Rebuild Contabo A → re-run setup from backed-up scripts/configs → restore Mesh data if saved.  
3. Rebuild InterServer portal from backed-up portal code.  
4. Fix DNS if IPs changed.  

The Phase 1 install record is [PHASE1_RUNBOOK.md](./PHASE1_RUNBOOK.md).

## OS choice

**Ubuntu 24.04 LTS** on all three. AlmaLinux declined for this project’s Mesh/Docker/docs path unless a future policy forces RHEL-clones.
