# Change log

What changed on the live platform, newest first. How things work: [OPERATIONS.md](./OPERATIONS.md).
Add an entry with every deploy or agent release.

**Versions.** The platform (console, API and session window) has one version, `MAJOR.MINOR.PATCH`, shown under the
sign-in card and at the bottom of the side rail. Raise MINOR for new features, PATCH for fixes only, MAJOR for changes
that need customers to act. Each deploy raises it in `console/app/version.js` and starts a section headed
`## <date> · Platform <version>`; a console test fails if the two differ. Versioning started at 1.0.0 on 30 Oct 2026;
earlier sections have dates only. Agent versions are separate and listed under [Agent releases](#agent-releases).

## 2026-11-13 · Platform 1.11.1

**Session window: End always ends the session**
- **End → End session** (and **Close window** / **Close session** in the "Session ended" and reconnect messages)
  sometimes did nothing, because the browser refused to close the window, so the remote desktop stayed connected.
  The session window now disconnects the remote desktop, tells the console the session is closed and stops checking
  in before it closes. If the browser keeps the window open, it shows **Session ended** and says the window can be
  closed.

## 2026-11-12 · Platform 1.11.0

**Session Panel, Phase C: files (pilot: POS-3316E-Setup only)**
- The person at the computer can send files to the technician from the Session Panel (**Send a file…** or drag and
  drop), and the technician can send files to them from the session window (**Files → Send a file to the customer**,
  or drop a file on **Session files**). Only on a device whose Session Panel is ready; others keep Web File Transfer.
- Files go through Digital Fingers (`/var/lib/df-api/session-files`, owner-only), must arrive at exactly the size
  offered, and are stored with their SHA-256. Up to 100 MB each (a tenant can set less); larger files are refused
  before anything is sent.
- Files for the customer: the agent downloads the file, checks it against the SHA-256 and has Windows Defender scan
  it (a threat fails the transfer). The customer then clicks **Save** or **Decline**; programs and scripts show a
  warning and need **Save anyway** (or the tenant can block or allow them). Saved files go to
  `Downloads\Digital Fingers\<date>`, are checked against the hash again and are marked as downloaded from the
  internet, so SmartScreen still checks programs. **Open folder** shows the file.
- Session window: **Session files** lists both directions with progress, Cancel, Defender and Accept status, and
  Download for files from the customer. It opens with a notice when a file arrives.
- Timelines: one entry per file on the device timeline (and on the ticket when the session was opened from one):
  received "name" (size) from the customer / sent "name" (size) to the customer, who saved it / declined / could not
  send, with the SHA-256 and a **Download** link while the file is kept. Audited as `remote.file`.
- Retention: stored files are deleted after 30 days (the timeline entry, name, size and hash stay). Unfinished,
  declined, cancelled and failed transfers are removed after two hours.
- Remote Desk → Settings → Session Panel → Files: allow each direction, largest file (1–100 MB), and programs and
  scripts sent to the customer (warn, don't allow, allow).
- API: `POST /v1/devices/:id/session-files`, `PUT …/:fileId/content`, `POST …/:fileId` (cancel),
  `GET /v1/remote-session-files/:id/content`; agent `POST /v1/agent/support/files`, `PUT|GET …/:id/content`,
  `POST …/:id` (scan, accept, decline, cancel, fail). The chat long-poll carries the file list (`files` cursor).
  The API now allows 30 minutes to receive a request, for slow uploads.

## 2026-11-12 · Platform 1.10.0

**Session Panel, Phase B: chat (pilot: POS-3316E-Setup only)**
- The technician and the person at the computer can chat during a remote session. On a device whose Session Panel
  is ready, the session window's **Chat with User** uses the panel instead of opening a MeshCentral chat window on
  the computer; every other device keeps the MeshCentral chat as before.
- Session window: messages arrive within about a second (long-poll through `GET /devices/:id/session-chat` on the
  console, `GET /v1/devices/:id/session-chat` on the API), with "typing" dots and "Seen" under the last message the
  customer read. The chat window opens on its own when the customer writes first. Closing it only hides it.
- Messages are stored with the session (`remote_session_messages`, at most 2,000 characters each, only the session's
  own technician in its own tenant can read or write them; nothing can be sent once the customer ends the session).
- Timelines: when the session is over (customer ended it, or the session window has been closed for 10 minutes), one
  entry per session, "chatted with the customer during a remote session (N messages)", on the device timeline, and on
  the ticket when the session was opened from one. **View chat** shows the whole conversation
  (`GET /v1/remote-sessions/:id/chat`). Audited as `remote.chat`.

## 2026-11-12 · Platform 1.9.0

**Session Panel, Phase A (pilot: POS-3316E-Setup only)**
- During a remote session the person at a Windows computer can see a Digital Fingers panel docked on the right in
  place of MeshCentral's thin "connected" strip: logo, "Digital Fingers Remote Support", session timer, status dot
  (green connected, amber paused, red reconnecting), the technician (initials, name, role, company, ticket, start
  time, "Controlling your mouse and keyboard"), **Pause/Resume** and **End** (asks "End the support session with
  …?"). The "…" menu has About, Session details, Pause and End; ✕ and Alt+F4 ask before ending. It collapses to a
  slim tab with the logo and timer, can be dragged up and down the right edge (position remembered), follows light
  or dark mode and has a taskbar button while the session is live. By default it is hidden from the technician's view
  (`WDA_EXCLUDEFROMCAPTURE`, Windows 10 2004+).
- Tray icon in every signed-in session (green dot in a session, amber when paused): Open support panel, the tenant's
  support phone and email, About. Tooltip "Digital Fingers Support: connected to <technician>".
- **Pause** blocks the technician: the session window shows "Paused by the customer", the server ends the Mesh
  tunnels and refuses Connect until the customer resumes. **End** ends the session in the console too. Audited as
  `remote.customer_pause`, `remote.customer_resume`, `remote.customer_end`, on the device and ticket timelines.
- The strip only disappears on devices that can show the panel: the tenant's Mesh group drops the strip flag (64)
  and every other device keeps it as a device-level flag, so the customer always knows a session is live. A device
  whose panel can't start (no WebView2, old agent, crash) keeps or gets the strip back and the failure is logged
  (`remote.panel_failed`).
- Remote Desk → Settings → **Session Panel**: show the panel (default off), show it to the technician (off), silent
  agent on workstations (off) and servers (on), support phone and email. `GET/PUT /v1/org/session-panel`, audit
  `remote.panel_settings`. Turned on for Digital Fingers only; the Mesh consent of its other 14 devices is unchanged
  in effect (71).
- Session window checks in every 3 seconds (`POST /v1/devices/:id/session-ping`), which is how the panel knows the
  session is live; closing the window hides the panel.
- `DFSupport.exe` is not code-signed yet (separate purchase).

## 2026-11-10 · Platform 1.8.0

**Province doughnut and a province you can set**
- The dashboard's South Africa card shows a doughnut of devices per province (percentage of devices in South
  Africa, with a grey "Province unknown" slice) in place of the Top provinces bars. Slices link to the filtered list.
- A province set on a device (Device Overview → Province, or several at once from the device list) wins over the
  internet-address location in the doughnut, map, filters, daily stats and grouping; "Use internet address" clears
  it. The card says how many devices have a set province. `POST /v1/devices/province`, audit `device.province`.
- Device locations report: the South Africa level shows the same province doughnut (screen and PDF), a note with
  how many provinces were set on the device, and a Source column (Set / IP) in the devices table and CSV.
- Session window, Session menu: **Switch User** (Windows). Lists the computer's Windows sessions (at the screen,
  Remote Desktop, disconnected) and moves the remote view onto the one you pick without signing anyone out
  (MeshCentral `tsid`). **Go to sign-in screen** disconnects the console session as SYSTEM (WTSDisconnectSession),
  so Windows shows its sign-in screen and the view reconnects to it; admins only, server warning. Audited as
  `remote.switch_user` / `remote.signin_screen` via `POST /v1/devices/:id/switch-user`.
- Internet provider: Device Overview and Device Details show who owns the device's public IP (MaxMind
  GeoLite2-ASN, refreshed with the City database; ip-api as fallback), e.g. "Vodacom (AS29975)". Looked up with
  the location when the IP changes.

## 2026-11-10 · Platform 1.7.1

**Hostname and "Reboot required" in the device Overview**
- Device Specifications shows the real Windows computer name (Hostname) under Device Name, which stays the RMM label.
  Owners and admins can **Change** it on online Windows PCs: the agent runs `Rename-Computer` without restarting
  (`POST /v1/devices/:id/hostname`, audit `device.hostname`), and the tag shows the new name waiting for a restart.
  Domain-joined PCs need domain rights to rename, so the job fails there and the tag clears on agent 1.6.2.
- When the computer is waiting for a restart, an orange **Reboot required** tag sits next to the hostname. Clicking
  it explains why (updates, Windows components, domain join or a new computer name waiting to apply), who is logged
  on, and offers *Ask user to restart* or *Restart now* (5-minute warning when someone is logged on; servers say so
  first). Owners and admins only; the restart runs through the same command as the Updates restart.
- New `POST /v1/devices/:id/restart`; audit `device.restart` / `device.restart.ask`, shown on the device timeline.
- Devices store `restart_reasons` and `pending_hostname` from agent 1.6.2. Older agents still show the tag when the
  update scan reports a pending restart.

## 2026-11-09 · Platform 1.7.0

**Invoicing Phase 1: quotes, invoices, credit notes and payments**
- Company and tax settings: registered and trading name, addresses, logo, colours, bank details (stored encrypted)
  and defaults. VAT registration is a dated record ("VAT registered from …"), so the VAT status on any date is known
  and a switch can be scheduled. Every VAT difference on a document follows the status on its issue date.
- Numbering per document type (prefix, padding, optional year and yearly reset), with gapless numbers given only
  when a document is issued. Tax rates (15% with its effective dates, zero-rated, exempt, no VAT). Items with price,
  unit and tax type.
- Customers have VAT status, VAT number, billing contact, email, CC, address, payment terms and template. Invoicing
  has its own customer list and can add customers, so Invoicing-only tenants need no other app. Desk and Remote
  customer pages get an Invoices tab when Invoicing is on.
- Quotes, invoices and credit notes: editor with headings and subtotals, live preview and a Modern / Classic /
  Minimal switch matching the design mockups. Issuing runs the SARS checks (blocks and warnings to confirm) and
  freezes the document: the issuer and customer details are copied onto it and it can no longer change. Not VAT
  registered issuers get "INVOICE", no VAT column, no VAT number, and "Total / Not registered for VAT / Balance due".
- Lifecycle: void (only if never sent or viewed), credit in full and re-issue, partial credit notes, quote accept,
  decline and convert to invoice. A fully credited unpaid invoice shows as Credited.
- PDF: printed by headless Chrome on the server, without network or scripts. The original PDF is stored when the
  document is issued and never changes; "Copy PDF" makes a fresh copy with the PAID / PARTIALLY PAID / VOID stamp.
- Private online links: `/pay/<token>` for invoices and credit notes, `/q/<token>` for quotes, `/link-expired` when
  a link has expired or was replaced. The page shows the document, amount due, EFT details with copy buttons and
  payments; quotes can be accepted or declined there. Views by signed-in staff are not counted.
- Email: sends the document with a button to the link, EFT details and (optionally) the PDF, from the tenant's
  trading name with replies going to their billing email.
- Payments: record EFT, cash, card or other payments, split across invoices or paid oldest first; any amount left
  over is kept as credit for the customer.
- Free tier (INVOICING-FREE): 100 invoices and 300 emails a month, warning at 80% and blocked at 100% (drafts and
  payments keep working); Free emails and pages carry "Sent with Digital Fingers Invoicing". Pro and MSP have no
  limits. Invoicing-only tenants see only Invoicing in the console (no device or desk links, no Downloads).
- Organisations without Invoicing now get a real 403 "Not included" page on every `/billing` page.
- Money is rounded half away from zero (spec v1.3 onwards).

## 2026-10-31 · Platform 1.6.0

**Invoicing app, groundwork (Invoicing Phase 0)**
- New app, Invoicing ("Quotes, invoices and getting paid"), at `/billing`, using the reserved billing icon and
  colours. It shows in the app launcher under Business only for organisations whose license includes the new
  `invoicing` feature. Everyone else gets the "Not included" page on every `/billing` page and a 403 from every
  `/v1/billing` API call.
- New feature keys in the package model: Invoicing, Invoicing Pro, MSP billing, Accounting sync and WhatsApp
  sending. They are not in any package yet; for now Invoicing is turned on per tenant from Control.
- Packages and licenses have two new limits, invoices a month and emails a month (blank means unlimited). They are
  set on the package and can be overridden on a tenant's license.
- Invoicing settings at `/billing/settings` list the sections still to come (company and tax, numbering, tax rates,
  templates, sending, payment methods and connections).
- Behind the scenes: money is handled in whole cents with VAT worked out per line, rounding half up. The SARS rules
  (VAT number check, Tax Invoice or Invoice title, the R 5 000 full tax invoice threshold, the 15% rate with its
  effective dates, and the checks before an invoice is issued) live in one module, with tests.

## 2026-10-31 · Platform 1.5.0

**Script library (roadmap Phase 2, part 1)**
- New Remote Desk settings page, Scripts and commands → Script library. Each script has a name, description, shell
  (PowerShell or CMD for Windows, Bash for Linux), up to five parameters, a risk level (Safe or Needs approval) and
  the alert types it helps with.
- 15 built-in starter scripts: clear print spooler, flush DNS, restart a service (needs approval), clear temporary
  files, check disk (scan only), restart Explorer, sync time, refresh group policy, installed software, disk space,
  network diagnostics, pending restart check and top processes for Windows; disk usage and top processes for Linux.
  Built-ins cannot be changed; Duplicate makes an editable copy.
- Everyone in the organisation can see the library; owners and admins add, change and remove scripts. Changes are
  in the audit log. Tenant migrations copy an organisation's own scripts.
- Running a script from a ticket comes in the next part.

## 2026-10-31 · Platform 1.4.1

**Ticket history moved into the timeline store (roadmap Phase 1, step 1b)**
- A ticket's history is now written once, to the same store as the customer and device timeline, with its full
  detail. The ticket page, the SLA breach check, the remote session tracking, customer response and resolution
  times, and tenant migrations all read it from there.
- The old `ticket_events` table is retired: it refuses new rows and is kept read-only as an archive. All of its
  rows were copied across first.
- Merging no longer copies the merged ticket's history onto the kept ticket; the kept ticket shows it in place
  (marked "from #…"), up to the moment of the merge. Copies made by earlier merges were removed.
- Remote sessions and commands started from a ticket stay on the ticket's own timeline but are not shown twice on
  the customer and device timeline.
- A ticket locked by a tenant migration gets no new timeline entries, as before.

## 2026-10-31 · Platform 1.4.0

**Customer and device timeline (roadmap Phase 1)**
- New Timeline tab on customers in both apps (it replaces the Service Desk "History" tab; old `?tab=history` links
  open it) and a Timeline tool on each device's diagnostics page.
- One list of what happened, newest first and grouped by day: ticket changes and time, remote and support
  sessions, commands and scripts (with their result), alerts raised, patches installed or failed, agent installs
  and updates, device renames and moves, customer and contact changes. Each entry links to its ticket, device or
  customer.
- Filters: search, device, technician, date range and event type; more entries load on scroll. Events from an app
  the tenant does not have (Remote Desk or Service Desk) are hidden.
- Events are stored once in a new append-only table as they happen; past audit entries, ticket events and finished
  jobs were copied in (1,253 events). Patch approvals are left out because there are hundreds of them.
- Tenant migrations copy a customer's timeline (and that of moved devices) to the new tenant, and a rollback
  removes the copies again.
- Checked with 10,000 extra events on one customer: every timeline query took under 15 ms.

## 2026-10-31 · Platform 1.3.0

**Longer commands and PowerShell scripts**
- One command line can now be up to 8,000 characters (was 400), from Run command, tickets and API tokens. cmd.exe
  cannot take much more than that on one line.
- API tokens can send a `script` instead of a `command`: multi-line PowerShell of up to 64 KB that runs as SYSTEM
  for up to 5 minutes (commands stay at 20 seconds). The agent saves it in its locked folder, runs it with
  `-File` and deletes it afterwards. Needs agent 1.6.1 on Windows; other devices get a clear refusal, and a script
  that reaches an older agent is finished as failed instead of being run as a command.
- Jobs have a `kind` (`command` or `script`); the audit log records the kind, the first 200 characters and the length.

## 2026-10-31 · Platform 1.2.1

**API tokens help**
- The "Using a token" card now lists the job statuses (`queued`, `running`, `finished`; the exit code says whether
  the command worked) and how to call PowerShell from a command. Found in the first live test, where a script waited
  for a `done` status that never comes.

## 2026-10-31 · Platform 1.2.0

**API tokens (Organisation settings → Security and compliance → API tokens)**
- Owners and admins with MFA can create tokens that let their own scripts run commands on chosen devices through
  `https://api.digitalfingers.co.za/v1/token/…` (list the token's devices, run a command, read the result).
- Each token is limited to the devices picked when it was made, must expire (7, 30, 90 days or 1 year), and can be
  limited to IP addresses. It is shown once; only its SHA-256 is stored.
- Tokens stop working when revoked, expired, or when their creator is no longer an owner or admin. 60 requests a
  minute per token. Creating, revoking, refused calls and every command (with the token's name) are audited.
- Replaces the "API keys (Soon)" item under Integrations and developer.

## 2026-10-30 · Platform 1.1.0

**Remote session survives a restart**
- When the device goes offline during a session (a reboot from the Power menu, a script or Windows Update), the
  session window stays open and shows "Waiting for <device>…". It checks every 10 seconds and reopens the desktop
  as soon as the remote agent is back, for up to 20 minutes. The reconnect is not counted as a new remote session
  (audited as `remote.resume`). After Shutdown from the Power menu the window ends as before.

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

**1.9.0 (Windows), 12 Nov, pilot only (POS-3316E-Setup), not published**
- Includes 1.8.0. Session Panel files. The agent never opens a path the customer names: the tray reads the
  customer's file and passes it to the agent in 32 KB chunks over the pipe (`fileSend`, `fileChunk`, `fileCancel`),
  and the agent streams it to the server. Files for the customer are downloaded into
  `C:\ProgramData\DigitalFingers\session-files` (SYSTEM and Administrators only), checked against their SHA-256,
  scanned with `MpCmdRun -Scan -ScanType 3 -File` and handed to the tray in chunks when the customer saves them
  (`fileRead`, `fileAccept`, `fileDecline`, `fileError`). Copies are deleted when the customer answers or the session
  ends; an upload stops if the tray closes or stalls for 90 seconds.
- Support app 1.2.0: a **Files** section in the panel with Send a file…, drag and drop, progress and Cancel, Save and
  Decline (programs and scripts ask again), Open folder, and a red number for files waiting to be saved (also on the
  collapsed tab and the tray icon, tooltip "N files to accept").

**1.8.0 (Windows), 12 Nov, pilot only (POS-3316E-Setup), not published**
- Includes 1.7.2. While a session is live on a tenant that shows the panel, keeps one long-poll open to
  `/v1/agent/support/chat` and passes the conversation to the tray with its state; the tray's messages, typing and
  read marks go back through the pipe (`chat`), only for the session that tray can see.
- Support app 1.1.0: a **Chat** section in the panel (open by default, can be folded): messages with the
  technician's name and time, links that open in the browser, "… is typing", "Seen" under the last message the
  technician read, Enter to send and Shift+Enter for a new line, 2,000 characters (count shown near the limit).
  Unread technician messages show as a red number on the Chat heading, on the collapsed tab and on the tray icon
  (tooltip "N new messages").

**1.7.2 (Windows), 12 Nov, pilot only (POS-3316E-Setup), not published**
- Includes 1.7.1. Sends a live session to the tray in the session it was opened on, or in the console session when
  the session doesn't say, so the panel shows on kiosk sign-ins too.
- Support app 1.0.8 (fixes found on POS-3316E-Setup; 1.0.7 tested there, 1.0.8 only changes the footer text):
  - The tray could not reach the agent ("Access is denied"): it now opens the pipe with read and write-data rights
    only, which the pipe allows signed-in users (1.0.4).
  - Kiosk shells with no taskbar (HNA's SATerminal): the panel still shows, just without a tray icon (1.0.3).
  - The panel stayed a blank white box because WebView2 left its windows hidden inside it; the panel now shows and
    sizes them each time it is placed (1.0.7). It also renders without the GPU (1.0.5).
  - `tray.log` and `panel.log` in `%LOCALAPPDATA%\DigitalFingers\Support` (256 KB, one old copy), including what the
    panel window shows a few seconds after opening.
  - The footer shows only the status; the technician's name is in the panel above it (1.0.8).
- Tested: the panel shows on the machine and in the remote view (with *Show the Session Panel to the technician*
  on), and Pause, Resume and End from the panel work.

**1.7.1 (Windows), 12 Nov, pilot only (POS-3316E-Setup via `AGENT_PILOT_DEVICES`), not published**
- Includes 1.6.2. Installs and updates `DFSupport.exe` (Session Panel and tray app, version 1.0.0) in
  `C:\Program Files\Digital Fingers\Support` from `/v1/agent/support/windows` (sha256 from the heartbeat; never
  replaced during a session) and starts its tray in every signed-in session as that user.
- Local named pipe `\\.\pipe\DigitalFingersSupport` for the tray: only our exe from Program Files, in its own
  session, holding the key the agent gave it. While a session is live the agent polls the server every 3 seconds.
- Reports whether the panel can run (`silent`, `not-installed`, `no-webview2`, `failed`, `ready`) in the heartbeat.
- When the tenant uses the Session Panel and WebView2 is missing, installs the Microsoft WebView2 runtime (Evergreen
  bootstrapper, Microsoft signature checked first) outside sessions, at most every 6 hours.
- Uninstall removes the Support app. The agent and `DFSupport.exe` carry the Digital Fingers icon and version details.
- 1.7.0 (same day, pilot only) had no WebView2 install.
- Support app 1.0.1: the tray waits for the taskbar after sign-in, and exits (so the agent starts a new one) if its
  icon can't be added. 1.0.0 started too early after a sign-in on POS-3316E-Setup and idled with no icon or panel.

**1.6.2 (Windows and Linux), staged 10 Nov, not published**
- Every heartbeat reports pending-restart reasons from the registry (Windows Update `RebootRequired`, CBS
  `RebootPending`, Netlogon `JoinDomain`) and a new computer name waiting for a restart (`ComputerName` differs from
  `ActiveComputerName`). `PendingFileRenameOperations` is ignored because installers leave it set for weeks.
  Linux reports `/var/run/reboot-required`.

**1.6.1 (Windows), published 31 Oct**
- Tested on FED-WIN-001: `powershell` by name, a 7,000-character command and a multi-line script all ran as SYSTEM;
  the agent's enrolment token was not visible to the script and the script file was deleted afterwards.
- Commands from Run command, scripts and API tokens can call `powershell` and `wmic` by name; the command's PATH
  now includes the Windows PowerShell and WMI folders. Before, only the full path to `powershell.exe` worked.
- Runs PowerShell script jobs (up to 64 KB, 5-minute limit) from a file in `C:\ProgramData\DigitalFingers\jobs`,
  which only SYSTEM and Administrators can open. The agent's own variables are not passed to commands or scripts.

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
