# Phase 1 runbook

**Last updated:** 2026-10-01  
This is the backup of what S3–S13 installed. Live passwords, private keys, and database URLs with credentials are not in git. They stay in the mode 600 files named below.

Step order and smoke results: [EXECUTION_PLAN.md](./EXECUTION_PLAN.md).

## Hosts

| Alias | Address | Role |
|-------|---------|------|
| `df-portal` | 69.164.244.199 | `digitalfingers.co.za` and the enrolled Linux agent |
| `df-a` | 169.58.10.75 | `rmm.` / `api.` / `mesh.` / Redis / MeshCentral / API / console |
| `df-b` | 169.58.10.76 | PostgreSQL only |

Ubuntu 24.04.5 on all three. Firewall is UFW. SSH is port 22 on each host.

## Versions checked on the servers

| Piece | Where | Version |
|-------|--------|---------|
| Caddy | Portal and Contabo A | 2.6.2 |
| Node.js | Contabo A | 20.20.2 |
| Redis | Contabo A, localhost only | 7.0.15 |
| MeshCentral | Contabo A | 1.2.5 |
| PostgreSQL | Contabo B | 16.15 |

## What each host runs

Portal listens on 80 and 443 with Caddy. The site root is `/var/www/df-portal`. The Caddyfile in git is `portal/Caddyfile`. MeshCentral, Redis, and Postgres are not installed. `df-agent` is active because this host is the enrolled Linux device. Its unit is `agent/deploy/df-agent.service`. The enroll file is `/etc/df-agent.env`, mode 600.

Contabo A runs Caddy, Redis, MeshCentral, `df-api`, and `df-console`. The Caddyfile in git is `deploy/caddy/contabo-a.Caddyfile`. It forwards `mesh` to `127.0.0.1:4430`, `api` to `127.0.0.1:4000`, and `rmm` to `127.0.0.1:3000`. Application source on the server is `/opt/df-api` and `/opt/df-console`. MeshCentral is `/opt/meshcentral`.

Contabo B runs PostgreSQL 16. Database `df_platform`, role `df_app`. Contabo A connects with TLS. The portal and the public internet do not.

## Templates in this repo

| Template | Installed as |
|----------|----------------|
| `portal/Caddyfile` | `/etc/caddy/Caddyfile` on the portal |
| `deploy/caddy/contabo-a.Caddyfile` | `/etc/caddy/Caddyfile` on Contabo A |
| `api/deploy/df-api.service` | `df-api.service` on Contabo A |
| `console/deploy/df-console.service` | `df-console.service` on Contabo A |
| `agent/deploy/df-agent.service` | `df-agent.service` on the portal |
| `agent/deploy/install-windows.ps1` | Windows service install |
| `api/.env.example` | Key names for `/root/df-api.env` |
| `agent/df-agent.env.example` | Key names for the agent enroll file |

## Secret files, not in git

| File | Host | Mode |
|------|------|------|
| `/root/df-api.env` | Contabo A | 600 |
| `/root/df-platform-db.env` | Contabo A and B | 600 |
| `/root/df-redis.env` | Contabo A | 600 |
| `/root/df-mesh.env` | Contabo A | 600 |
| `/root/df-console.env` | Contabo A | 600 |
| `/etc/df-agent.env` | Portal | 600 |
| `/var/lib/df-agent/state.json` | Portal | 600 |

MeshCentral `config.json` holds certificates. Do not copy it into git.

## Rebuild order

1. Contabo B: PostgreSQL, then the `df_platform` database and `df_app` role.
2. Contabo A: Redis on localhost, MeshCentral, Caddy, then the API and console from `api/` and `console/`.
3. Portal: Caddy and the files in `portal/www`. Re-enroll `df-agent` with a new enroll token.
4. Point DNS only if the addresses changed. Certificates are Let's Encrypt, valid through 30 Dec 2026 at the time of this backup.

Source for the API, console, agent, and portal is this repository. GitHub is the backup. It is not the day-one deploy pipeline.
