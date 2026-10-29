# Change log

What changed on the live platform, newest first. How things work: [OPERATIONS.md](./OPERATIONS.md).
Add an entry with every deploy or agent release.

## 2026-10-29

**Agents**
- Windows agent **1.5.2 published** after passing on FED-WIN-001. It reports the Windows version and build, and the
  command-line install runs silently and refuses a non-admin PowerShell. Auto-update is rolling it out.
- Linux agents can now be updated from the console (Devices → Tools → Update agent, or Update outdated agents on the
  Dashboard), through the MeshCentral agent. MSC-FEDORA-HM and vps3231588 updated to 1.5.2; vps3231588 was on 1.4.
- `build-windows.sh promote <version>` publishes the tested test-channel build without rebuilding it.

**29 Oct review fixes**
- One overdue rule (`isOverdue`): the Dashboard and the ticket list both count unresolved tickets past their resolution
  target (the Dashboard had shown 8, the list 9).
- Ticket list fits the page with no sideways scroll; Owner is no longer clipped. Channel is icon-only.
- Dashboard grows to 1600px wide.
- Agent versions legend explains why a version is outdated (for example "Linux release is 1.5.2").
- Manage Subscription shows the package name instead of the licence type.
- A device whose address resolves only to a country shows that country instead of "Unknown".

**Control panel**
- New **System** page (Control → System): published and staged agent versions, the fleet's agent versions per platform
  across every tenant, automatic update activity, recent agent updates, service health and this change log.

**Docs**
- Added this change log and [OPERATIONS.md](./OPERATIONS.md).

## 2026-10-28 and earlier this week

- **Reports app** (Dashboard and Reports spec, phase 3): seven reports (agents, operating systems, locations, patches,
  uptime, remote sessions, service desk) with filters, charts, CSV/PDF downloads, location drill-down and monthly
  emailed reports per customer. Scheduled exports moved from the Dashboard to Reports → Scheduled exports.
- **Locations** switched from ip-api to MaxMind GeoLite2 with monthly database updates.
- **Customers per app:** Remote Desk and Service Desk customer views with entitlement checks, SLA plans and contracts,
  clipboard paste and remote agent restart.
