# Change log

What changed on the live platform, newest first. How things work: [OPERATIONS.md](./OPERATIONS.md).
Add an entry with every deploy or agent release.

**Versions.** The platform (console, API and session window) has one version, `MAJOR.MINOR.PATCH`, shown under the
sign-in card and at the bottom of the side rail. Raise MINOR for new features, PATCH for fixes only, MAJOR for changes
that need customers to act. Each deploy raises it in `console/app/version.js` and starts a section headed
`## <date> · Platform <version>`; a console test fails if the two differ. Versioning started at 1.0.0 on 30 Oct 2026;
earlier sections have dates only. Agent versions are separate and listed under [Agent releases](#agent-releases).

## 2026-10-30 · Platform 1.0.0

**Platform version**
- The platform version is shown under the sign-in card and at the bottom of the side rail (hover for the release
  date). Every deploy raises it and adds a section here.

**Remote session stays open when the user signs out**
- Signing the user out (Ctrl-Alt-Del → Sign out, or Log Off) used to end the session window. The window now shows
  "Reconnecting…" and reopens the desktop on the Windows sign-in screen, so the technician can sign in as another
  profile. It gives up after 2 minutes or if the device goes offline. Quick support sessions are unchanged.

**Remote support self-repair (Windows agent 1.6.0, published)**
- The Windows agent installer no longer embeds the remote support (Mesh) agent; the device agent downloads it with
  its device login, checks the published hash and installs it within a few minutes of check-in.
- The agent watches the remote support service: it restarts a stopped service and reinstalls a missing one (for
  example after antivirus quarantined it, as on HNA-PORTVLLE-01). If the file is removed again it reports "blocked".
- Devices shows "Remote support stopped / missing / blocked" under the agent version, with the reason on hover.
  State changes are in the audit log.
- Fixed: uninstall and detection looked for the Mesh agent in the old `C:\Program Files\Mesh Agent` folder instead of
  `C:\Program Files\Digital Fingers\Mesh Agent`.

**Platform team**
- Control → Team lists everyone who can sign in to Control, with their level, MFA state and status.
- Three levels: **Super admin** (everything, plus managing the team), **Platform admin** (runs Control, can't change
  the team) and **Support** (read-only: the API refuses every change and View as tenant). Support accounts don't
  count as migration approvers.
- Super admins invite people by email (7-day link), change levels, deactivate or reactivate accounts, and reset a
  lost authenticator. Nobody can change their own account there, and the last active super admin can't be demoted
  or deactivated. Every change is in the audit log (platform entries).
- MFA is compulsory for platform accounts and can't be turned off. Invited accounts set it up at first sign-in; the
  two existing accounts have until 6 Nov 2026, with a banner in Control until then.
- The server bootstrap script is now break-glass only: it creates a super admin, requires MFA at first sign-in and
  writes an audit entry.

**Tenant migrations (Tenant Migration spec)**
- Control → Migrations, with a badge for requests waiting on you. A wizard picks the source and target tenants, what
  moves (customers and contacts, tickets with their history, devices, desk settings), all or chosen customers, Copy or
  Move, and when it runs (default 19:00 South African time).
- A dry run shows what would move, records that already exist in the target (merge, bring in renamed, or skip),
  licence problems that need an OK, and users (listed only). Nothing changes until both tenants and a second platform
  admin approve; requests expire after 7 days.
- Tenants see a banner and Settings → Data migration, where owners (or admins) approve or decline with a reason.
- Runs in one transaction: a failure changes nothing. Tickets get new numbers and keep "Migrated from DF-#n". After a
  Move the source keeps a read-only copy for 30 days (ticket and customer pages say so), then it is removed.
- Rollback within 30 days, approved by a second platform admin, optionally copying the target's changes back.
- Control → tenant has a "Migrate data…" button and a Migrations tab. Every step is in both tenants' audit logs.
- Fixed before release: moving a device would also have moved the source's tickets for that device instead of copying
  them. Found by the new end-to-end self-test.

**Service Desk phase 5**
- Customer pages in Service Desk: an Overview with a 6-month created/resolved chart, average response and resolve
  times, ratings and an All/Open/On hold ticket panel; a History tab; an Attachments tab; and a Devices tab (when the
  tenant also has Remote Desk) with open tickets per device.
- Customer satisfaction (CSAT): when on (Service Desk settings → Automations), the resolved email asks the customer to
  rate Good, OK or Bad and add a comment. The rating shows on the ticket and in the Service Desk report's happiness
  score. Rating links are signed, and opening a link alone does not record a rating, so mail scanners cannot vote.

**Service Desk phase 4**
- Email-to-ticket over IMAP: new mail opens a ticket for the matching customer; replies thread into the existing
  ticket. Agent replies can be emailed to the customer.
- Automations on new or updated tickets (assign to a user, set priority, status or category, add a tag), and
  auto-close of resolved tickets.
- Alerts can open tickets, tickets can be linked under a parent, and people can watch a ticket.

**Service Desk phase 3 (Service Desk upgrade spec)**
- New Ticket form: channel (Phone, Email, Walk-in, Portal, Remote session), category and tags with suggestions, CC
  contacts, custom statuses, priority labels, and a due date filled in from the SLA that can be overridden. A
  "Possible duplicates" box lists open tickets for the same customer with a similar subject.
- Ticket page: due date override, channel and CC can be changed; the header shows the SLA due time, or "SLA paused"
  while Pending. Canned replies can be inserted into the reply box, with `{contact.name}`, `{ticket.id}` and
  `{agent.name}` filled in.
- SLA engine (`api/src/sla-engine.js`): one set of rules for the ticket list, ticket page, Dashboard, customer page,
  reports and the breach sweep. Targets scale by priority (percentage per SLA plan), count only business hours when
  those are on (South African time, holidays skipped), and stop while a ticket is Pending. A due date set by hand wins.
  The sweep now raises a one-off "SLA due soon" warning when under 25% of a target is left, before the breach.
- New Service Desk settings: Ticket Setup (custom statuses that count as Open/Pending/Resolved, priority labels,
  categories, tags), Business Hours and Holidays (with "Load South African Public Holidays"), Canned Replies and
  Notification Rules. SLA Targets has a percentage per priority.
- Ticket notifications: a bell in the top bar lists new tickets, assignments and SLA warnings/breaches for the user.
  Who gets in-app and email notices is set per event. Until a tenant saves its rules, email still only goes to the
  platform support inbox, as before.
- Only owners and admins can change the default SLA targets (the API had allowed any technician).

**Packages, tenants and customers (spec gaps)**
- Invite users by email (Control → tenant → Users, and Settings → Manage technicians). The invite link lasts 7 days and
  needs a free seat; the new tenant wizard invites the first admin by default.
- "View as tenant" for platform admins, with a purple banner and Back to Control. Start and end are audited.
- Audit entries record the role, IP address and browser of the person who acted.
- Remote Desk device and enrolment endpoints check the Remote Desk app is in the package; Manage Subscription is
  owner/admin only. Old `/customers/:id` links redirect into the app's customer page.
- Control → tenant shows 30 days of usage history.

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
- Dashboard fills the full screen width (it had stopped at 1440px, then 1600px).
- Devices list: a Columns button above the table shows or hides columns (Hostname and Remote always stay); the choice is remembered in the browser.
- Report line charts (Uptime, Patches and others) draw at the card's real width with a fixed 240px height, so axis text
  stays 11px instead of growing with the screen.
- Agent versions legend explains why a version is outdated (for example "Linux release is 1.5.2").
- Manage Subscription shows the package name instead of the licence type.
- A device whose address resolves only to a country shows that country instead of "Unknown".

**Settings (Settings menus spec, slices 1–2)**
- The gear opens the current app's settings plus the shared Organisation settings, with a "Settings for: Remote Desk ▾ |
  Organisation" switch. Remote Desk never shows Service Desk settings and the reverse; search covers the current app and
  Organisation only. Owner/admin-only items are hidden from technicians and still blocked by the pages and the API.
- Settings home pages: `/settings/org`, `/remote/settings` and `/desk/settings` (the last two need the app in the package).
- Settings pages moved under those roots, with a Settings › Section › Item breadcrumb. Old addresses redirect, for example
  `/tickets/setup` → `/desk/settings/service-levels`, `/subscription` → `/settings/org/subscription`,
  `/settings/deployment` → `/remote/settings/deployment`.
- Contacts left the settings menu (it lives in Customers). Items not built yet are listed as "Soon".

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

## Agent releases

Every Digital Fingers Agent version, newest first. Versions before 1.4.0 report no version and show as
"Unknown (1.4 or older)". How to build and publish: [OPERATIONS.md](./OPERATIONS.md).

**1.6.0 (Windows), published 30 Oct**
- The installer no longer carries the remote support (Mesh) agent inside it; the agent downloads it with its device
  login, checks the published hash and installs it within a few minutes of check-in.
- Watches the remote support service: restarts it when stopped, reinstalls it when missing (at most once an hour) and
  reports "blocked" when antivirus removes it. Devices shows the state under the agent version.
- Uninstall and detection use the branded `C:\Program Files\Digital Fingers\Mesh Agent` folder.
- Tested on FED-WIN-001: installed over 1.5.2, then Mesh was uninstalled and the agent reinstalled it in 17 seconds.
- Rolled out to all nine online Windows PCs within 3 minutes; all report remote support running. The first fresh
  install (POS-3316E-Setup) set up remote support by itself about 2 minutes after enrolling.

**1.5.2 (Windows and Linux), published 29 Oct**
- Reports the Windows version and build for the OS report.
- The command-line install runs silently and refuses a non-admin PowerShell.
- Linux agents can be updated from the console through the MeshCentral agent (tested 1.5.1 → 1.5.2 and 1.4 → 1.5.2).

**1.5.1 (Windows), published 25 Oct**
- Updates itself from the server: the heartbeat offers the release, the agent downloads it with its device login,
  checks the SHA-256, swaps the exe and rolls back if the service doesn't stay running. Remote support is untouched.
- Jobs run with the raw command line, which fixes commands with double quotes and the patch restart warning.
- Devices shows an Agent column; owners and admins get "Update agent" in Tools; automatic updates when idle.

**1.5.0 (Windows), test step only, 25 Oct**
- First version to report its version in the heartbeat and accept server updates. Used on FED-WIN-001 to test the
  update from 1.4.0 (by a one-off job) and to 1.5.1 (by self-update); not published.

**1.4.0 (Windows), published 25 Oct**
- The installer locks `C:\ProgramData\DigitalFingers` to SYSTEM and Administrators, and re-locks it at each start.
- Jobs run in their own worker, so heartbeats continue during a job; a timed-out job's whole process tree is stopped.
- Enrolment retries with backoff instead of stopping the service.
- Always uses `https://api.digitalfingers.co.za`; the env file only supplies the enrolment token.
