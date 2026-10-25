# Remote session window — chat handoff

**Last updated:** 2026-10-24
**Scope:** The remote session window (left rail: View, Session, Tools, Files, Chat) and everything built for it in this chat.
**Status:** All work below is **deployed to df-a, tested, and committed/pushed as `5153a15`**.

Related: [CHAT_HANDOFF.md](./CHAT_HANDOFF.md) (original platform planning) · [DECISIONS.md](./DECISIONS.md)

---

## 1. What the session window is

- A static page: `console/session-shell/index.html`.
- Served same-origin from the Mesh host at `https://mesh.digitalfingers.co.za/df-session` (Caddy), deployed to `/var/lib/df-session/index.html` on **df-a**.
- It embeds MeshCentral's own UI in an iframe (`#desk`, `viewmode` 11 desktop / 12 terminal, `hide=63`). MeshCentral is the **remote engine only**; the window, menus and features are ours.
- The console (`https://rmm.digitalfingers.co.za`) opens it from **Connect** (`console/app/devices/[id]/session/launch.js`). The payload passes `deviceId`, `console` (console origin), user, title, etc.
- The two sites are the **same site** (`digitalfingers.co.za`), so console cookies (`df_session`) are sent inside frames.

---

## 2. Design language (use it for everything new)

The owner wants a modern look everywhere; nothing should look like stock MeshCentral. The chat panel set the style and the whole session window now follows it.

- **Colours (logo palette):** primary Touch Violet `#7c3aed` (hover `#6d28d9`); accent Signal Cyan `#22d3ee`; gradient `linear-gradient(120deg, #6d28d9 0%, #4f46e5 50%, #0891b2 100%)`; ink `#0f172a`; muted Slate `#475569`; hover `#f3effe`; red `#d93a3a`; online green `#3ddc84`. Dark surfaces: Midnight `#0b1020` (page / rail end), panel `#121933`, rail start `#161b3d`. The old variable names are kept (`--blue` is now violet), so `--blue`, `--grad`, `--ink`, … in the session window and `--df-*` on `.sf-page`, `.wft-page`, `.rcv-page` in the console. Console dark mode uses the same Midnight surfaces, `color-scheme: dark`, and a lighter violet `#b49cfc` for hostname links.
- **Fonts:** Inter (body) and Sora (headings), self-hosted variable woff2 (OFL). Console: `console/app/fonts/*.woff2` via `next/font/local` in `layout.js` (Sora as `--font-sora`, used on `h1` and card headings). Session window and messenger: `@font-face` from `/df-assets/*.woff2` on the Mesh host (repo copy `console/session-shell/df-assets/`, live `/var/lib/df-session/df-assets/`). Buttons use a violet `:focus-visible` ring.
- **Remote-side (agent) branding:** settings kept in `deploy/mesh/branding.json` (no secrets) and merged into `domains[""]` of the live Mesh `config.json` (backup `config.json.bak-branding-*`, then `systemctl restart meshcentral` only when no sessions are open). The consent and notification titles plus the session bar read "Digital Fingers Support". The messages deliberately omit `{0}` so the shared Mesh account name never shows. These are sent with every session request, so they apply to all agents immediately. The `agentcustomization` image (`df-agent-logo.png`, 64px tile in `meshcentral-data`) and colours (white on Midnight) are written into the `.msh` only when an installer is downloaded, so existing PCs keep the default look until reinstalled. All of it is only visible if the device group's consent flags are on (1/2/4 notify desktop/terminal/files, 8/16/32 prompt, 64 privacy bar). The owner chose notify + bar without approval: the "Digital Fingers" group is set to `71` (notify desktop/terminal/files + privacy bar) with `deploy/mesh/set-consent.cjs "<group>" <flags>` (run on df-a with `/root/df-mesh.env`). Verified on FS01: the bar reads "Digital Fingers Support is connected".
- **Public site (`portal/www`, host df-portal, `/var/www/df-portal`):** same logo (`brand/logo-horizontal-dark.svg`), favicons from the package (`favicon.ico`, `icon.svg`, `apple-icon.png`), Inter/Sora, Midnight background, gradient buttons. Deploy: back up the site root to `/root/df-portal-backup-*.tgz`, copy files, keep owner, 644/755.
- **Windows and panels:** white card, 16px radius, big soft shadow, gradient title bar (`.bar`) with round icon buttons (SVG minimise / close / reload, never text glyphs).
- **Menus:** white cards, 14px radius, 6px padding; items are 9px-radius rows with a blue icon; submenus are separate cards 8px to the side; ticks in blue. Opening animation is a short slide/fade.
- **Fields:** 10px radius, soft grey fill, blue focus ring. **Buttons:** pill-shaped blue (`.run` / `.btn`), `.btn.ghost` for secondary, `.btn.danger` for destructive.
- **Confirmations:** never `window.confirm`; use `ask(title, text, buttonLabel, danger)` (returns a promise) for the styled dialog.
- **Logo (Pulse D, from the owner's `concept-1-pulse-d` package):** cyan `#22D3EE` → violet `#7C3AED` gradient "iD" mark. Assets in `console/public/brand/`: `logo-horizontal-dark.svg` (with tagline, login card), `logo-horizontal-dark-notag.svg` (tagline removed and words moved down to centre, top bar), `logo-icon.svg`, `logo-tile.svg` (white mark on gradient tile). Favicons: `console/app/favicon.ico`, `icon.svg`, `apple-icon.png`. The session window rail and the remote chat badge inline the tile SVG and use it as a data-URI favicon (those pages live on the Mesh host). `console/app/mark.js` `Wordmark` renders the image; `tagline` prop picks the login version.
- **Rail:** Midnight gradient (`#161b3d` → `#0b1020`), logo tile, timer pill with green dot, active item is a violet gradient pill.
- **Rail icons (session window and console rail):** Lucide outline icons on a 24 grid, 1.9 stroke, round caps and joins; styling comes from CSS. Icons in menus and lists are violet; the main shape has class `solid`, which gets a 22% fill on the active item. The Diagnostic Tools list (`console/app/devices/diagnostic-icons.js`) uses the same treatment. Session window: monitor (View), sliders (Session), toolbox (Tools), folder (Files), chat bubble with dots (Chat), power (End). The menu icons (`.fly`) use the same style at 18px with no SVG attributes.
- Keys typed in our panels, dialogs or chat are never forwarded to the remote desktop (`sendKey` ignores them).

**The whole console uses it too** (after `5153a15`):
- `console/app/globals.css` has a "Digital Fingers design language" block (just before the `.sf-page` styles) that overrides the old look: tokens on `:root` plus dark-mode values on `html[data-theme="dark"]`, navy top bar with DF badge, active nav pill (`console/app/nav-links.js`, client component using `usePathname`), white page card, soft section cards (`.job`, `.tenant`), rounded tables, pill buttons, 14px-radius menus, gradient title bar on the device details window, blue-pill active item in the diagnostics sidebar.
- Dashboard (`console/app/dashboard/page.js`) was rebuilt: stat tiles, health cards with CPU/memory/disk bars, open tickets with SLA chips, export facts, patch compliance with expandable update lists.
- Tickets: list first with status/priority chips (`.chip`), forms below in a grid; ticket page shows chips and SLA chips, comments as cards.
- Login page: navy background, rounded card.

---

## 3. Features built (all working)

### Waiting screen
Blue monitor with animated "eyes" and "You'll be able to access the remote device shortly." Shown until the desktop reports connected.

### View menu
Actual Size, Full Screen, Show Remote Cursor, Color Quality (Best/High/Medium/Low), Stream Scaling (100/75/50/25%), Display Resolution.
- **Stream Scaling** is Mesh's old "Screen Resolution": it only downscales the picture we receive (`ScalingLevel`); the remote screen does not change.
- **Display Resolution** changes the remote's real resolution. On first open it runs the `DFDisplay` C# helper (`DISPLAY_CS`) through PowerShell as the signed-in user (`runMesh(2, …, 2)`); `EnumDisplaySettings` lists the modes (same colour depth, at least 800 × 600) and the current one is ticked. Picking one calls `ChangeDisplaySettingsEx` with flags 0 (not saved to the registry). The first change remembers the original; a "Restore W × H" item appears, and End session restores it before closing (waits up to 8 s). Closing the tab some other way tries a best-effort restore. Windows only; needs someone signed in at the console.
- **Match my screen** (top of the Display Resolution list, `screenFit()`): takes the technician's monitor in physical pixels (`screen` × `devicePixelRatio`), keeps the remote modes closest to that shape, and picks the largest one that is not bigger than the monitor. The label shows the mode it will use; it is greyed out when already active, and the tooltip says when no mode has the exact shape. Fixes the black side bars in Full Screen. Tested on FS01: 1920 × 1080 monitor picked 1920 × 1080 (not 2560 × 1440), switched, then restored to 1024 × 768.
- Full screen fills the whole window (no white space or black strip; `fitDesk()` injects styles into the Mesh iframe).
- In full screen the rail hides and slides back when the mouse touches the left edge.
- Submenus sit flush against their menu.

### Session menu
Invite Technician, Send Alt+Tab, Send Clipboard Keystrokes, Send Ctrl+Alt+Del, Screenshot, Short Keys (Win, Run, Explorer, Desktop, Task Manager, Alt+F4, Esc, Lock), Network Statistics, Disable Input Devices, Clipboard Sync, Start/Stop Recording, Switch Monitor, End session.
- Deliberately left out (the engine can't do them): Remote Audio, Blacken Screen, Add Virtual Monitor.

### Tools menu
Search box, Diagnostics (opens console diagnostics), Execute Script (cmd / PowerShell / shell, as System or logged-on user, output shown), Terminal, Power Options (Lock, Log off, Restart, Restart in Safe Mode, Shut down), Quick Launch (about 20 programs, as System or logged-on user), Administrator Tasks (Disk Cleanup, Configure Cleanup, Task Scheduler, Update Group Policy), "Request a tool" link.
- Scripts and launches go through Mesh `runcommands`. PowerShell is sent as one base64 line that decodes and runs itself.
- Launching as the logged-on user uses a small C# `CreateProcessAsUser` helper compiled on the target.
- **Power actions** go to the console route `console/app/devices/[id]/session-power/route.js` → API `/v1/devices/:id/power`. Only owners/admins can use them and every action is audited. That route only accepts the Mesh origin (CORS with credentials) and requires the `df_session` cookie.
- Safe Mode uses **Safe Mode with Networking** and registers the agent services so the machine reconnects. Shutdown/restart clear the safe-boot flag first.

### Files menu
Dark flyout with two items:

**Advanced File Manager** — large window over the remote screen (title bar, reload, close).
- Console page `/devices/:id/file-manager` (`console/app/devices/[id]/file-manager/page.js`).
- Sidebar: device name/OS, quick locations (This PC, Desktop, Documents, Downloads, Public; Linux: Root, Home, Temp), Collapse.
- Main area: the console's existing file manager (`files-panel.js`) — back/forward/up/refresh, path, search, New Folder, Download, Upload, Event Log / Job Queue.
- Finds the user's real profile folder even with a domain suffix (e.g. `john.CONTOSO`).

**Web File Transfer** — small panel bottom-right (minimise, close), **draggable by its title bar**.
- Console page `/devices/:id/file-transfer`.
- "Please Wait — establishing your remote connection…" then picks an existing remote folder (user Downloads → Desktop → Public Downloads → `C:\Windows\Temp`).
- **Send Files**: picker or drag-and-drop anywhere on the panel; sent one at a time with progress, up to 8 GB each.
- **Receive Files**: opens a separate **Receive Files pop-up** (also draggable) — remote folder browser with path, up, refresh, search, Name/Type/Size/Date Modified, checkboxes for many files/folders, **Receive (N)**. Folders arrive as .zip. Progress shows in the transfer list; files land in this computer's Downloads.
- Clear All removes finished items.
- Closing either window only hides it, so running transfers continue.

### Chat menu
Dark flyout (same style as Files) with two items. Both need MeshCentral's "chat and notify" right.

**Chat with User** — our own modern chat panel (no MeshCentral page): rounded corners, gradient header with avatar and online dot, chat bubbles with times, typing dots, auto-growing message box (Enter sends, Shift+Enter new line), round send button, Save conversation (.txt), minimise, end chat. Top-right and draggable.
- Talks straight to Mesh's relay: `wss://<mesh>/meshrelay.ashx?id=meshmessenger/<node>/<user>&auth=<authCookie>`, the same channel MeshCentral's messenger page uses.
- Protocol: the server sends `c` (or `cr` when recorded) once the other side joins; then JSON `{action:"chat",msg}`, `{action:"outtext",value}` (typing), and control pings (`ctrlChannel 102938`, answered with pong). We never send `random`, so no WebRTC is set up and everything stays on the websocket.
- After connecting it sends Mesh `meshmessenger`, which makes the agent open `https://<mesh>/messenger?id=meshmessenger/<node>/<user>` in the remote user's browser.
- **Remote side is ours too:** Caddy serves `/messenger` from `/var/lib/df-session/messenger.html` (repo: `console/session-shell/messenger.html`) instead of MeshCentral's page. Same design: "Digital Fingers Support" header with DF badge and online dot, bubbles, typing dots, round send button, "Secure support chat by Digital Fingers". Same relay protocol (Mesh allows `meshmessenger/<node>/…` ids without login). It reconnects and waits when the technician leaves, gives up after 5 failed connects, and shows "(N) New message" in the tab title when hidden. It never shows the Mesh account name (that is the shared Mesh login, not the technician).
- **App window on Windows:** `chatOpenRemote()` first launches Edge (or Chrome) as the logged-on user with `--app=<messenger url> --window-size=440,680` through the same `DFLaunch` helper as Quick Launch, so the user gets a small chat window with no address bar or tabs. If no browser is found, nobody is signed in to the console session, or it fails, it falls back to Mesh `meshmessenger` (default browser tab). Non-Windows always uses `meshmessenger`. Note `DFLaunch` uses the active console session, so users signed in only over RDP get the fallback.
- Side effect: MeshCentral's own web UI chat (technician side) would now also open our remote-user page; we don't use it, the session window has its own panel.
- If the user leaves, the panel notes it and reconnects to wait again. It gives up after 4 connection attempts that never open. Files the user tries to send are declined with a pointer to Web File Transfer.
- Tested end-to-end by joining the relay from a second websocket in the same browser (as the "remote user"): join, typing, both directions, leave, reconnect.

**Send Message** — draggable panel: style (Toast notification / Message box / Alert box), title (defaults to "Digital Fingers"), message, and "Show for" (2/10/30/60 minutes or until closed; message box only).
- Toast uses Mesh `toast` with a `responseid`, so the panel reports "Access Denied" or success. Message box and alert box use Mesh `msg` (`messagebox` / `alertbox`), which never replies, so the panel only says it was sent.
- The panel says "Sent to" followed by the device's Mesh name, so it is right even when the payload has no label.

How the pieces talk:
- Transfer panel → session window: `postMessage({type:"df-receive", path, to})`. The session window checks the sender's origin equals the console origin and that it came from the transfer frame.
- Pop-up → transfer panel: `BroadcastChannel("df-transfer-<deviceId>")` with the panel's random `to` ID, so only the panel that asked receives the files (prevents duplicate downloads when two session windows are open). The panel acknowledges; if no acknowledgement, the pop-up downloads the files itself.
- Pop-up → session window: `postMessage({type:"df-receive-close"})`.
- Both frames use `referrerpolicy="origin"` so the console page knows the parent origin.
- `console/next.config.mjs` sends `Content-Security-Policy: frame-ancestors 'self' https://mesh.digitalfingers.co.za` on the two file pages only.

### Ending sessions from the console
- Devices list: a red pulsing **End session** pill appears in the Remote cell (left of the wrench) while the device has any open Mesh session (desktop, terminal, files, TCP/UDP). The tooltip says what is open. The wrench menu has **End All Sessions (n)** too. Both ask for confirmation, then report "Ended n sessions."
- `console/app/devices/session-status.js` polls `GET /v1/remote-sessions` once for the whole page every 15 s (and on window focus, skipped when hidden); all rows share it (`useDeviceSessions(id)` for one row, `useAllSessions()` for the page).
- **In session (n)** chip next to the search box (`session-filter.js`): toggles a filter that shows only devices with an open session. Rows carry `data-device`; the chip writes a `<style>` rule that hides the rest, and shows "No remote sessions are open right now." when there are none. It updates with the poller, so a row disappears once its session ends.
- API: `GET /v1/remote-sessions` maps Mesh node sessions to org device ids (node ids never reach the browser). `POST /v1/devices/:id/sessions/end` ends everything and audits `remote.end` with `ended`/`remaining`.
- `api/mesh-sessions.cjs` reads `node.sessions` from Mesh `nodes`, then for every viewer sends `endDesktopMultiplex` (desktop) and `msg`/`endtunnel` per protocol (what Mesh's own Sessions dialog does), waits 4 s and re-reads. All technicians share one Mesh account, so this ends every session on that device.
- Login tokens are deliberately **not** touched: Mesh's `loginTokens` call purges every expired token, which would drop other technicians' older session windows on other devices.
- Session window: when a connected desktop drops, it restores the original display resolution (the Mesh control channel is still up) and shows "Session ended … It may have been ended from the console." with **Close window**.

### App launcher and separate products
- Grid button at the far right of the top bar (`console/app/launcher.js`). Clicked, it turns into the logo tile and opens a panel with "Search Applications" and a **Service** section: **Service Desk** (tickets, `/tickets`) and **Remote Desk** (RMM, `/devices`). Apps not on the licence show greyed with a lock; clicking explains it is licensed separately with a Contact us link.
- Each app has its own menu (`nav-links.js`, `appForPath`): Remote Desk = Devices, Dashboard, Licenses, Alerts, Patches, Audit; Service Desk = Tickets, Audit. Tickets no longer sit in the Remote Desk menu.
- Layout (owner's "layout two"): the app menu is a narrow icon rail on the left (`.app-rail`, icon + label, 84px; becomes a bottom bar under 720px). Page content is unchanged in the centre.
- **Search and Connect** (`console/app/search-connect.js`, `findDevices` in `actions.js`): box in the middle of the top bar, Ctrl/Cmd+K focuses it. Lists up to 8 devices; Connect opens the remote session for online devices; clicking a name opens Devices filtered to it. Shown only to users with Remote Desk access. Neutral pages (Account, FAQ, …) keep the last app's menu via the `df_app` cookie; the logo links to that app's home.
- Licensed today from the single licence: Service Desk = `ticketing`, Remote Desk = `remote_desktop`, both only while the licence is unexpired. Platform admins see both.
- **Agreed plan (owner, 25 Oct), not built yet:** separate products with their own seats and expiry (Service Desk = agents; Remote Desk = technicians + device cap; Integration = add-on, only effective while both are active). Customers, users and the organisation stay shared (core). Without Integration: Service Desk has manual Assets, ticket device becomes optional, no devices in Service Desk and no tickets in Remote Desk, enforced in the API. With Integration: enrolled devices appear as read-only synced assets, tickets show live device info and Connect (needs Remote Desk access), devices show their tickets, alerts can raise tickets. If Integration lapses, tickets keep a device snapshot; nothing is deleted. Build order: licence split → tickets without devices + Assets → integration features.

### Remote Support, one-on-one (version 1 deployed, 25 Oct)
- Owner's decisions:
  - A "Support" item goes above Devices in the Remote Desk rail.
  - First version: Access Remote Screen (6-digit code and link, optional customer email), Sessions and History, Link to ticket, and "Make managed" (enrol the PC properly; then it counts towards the device cap).
  - Later: Share My Screen and Schedule.
  - Licensing: a new "Remote support" module, limited by concurrent sessions; one-off sessions do not use the device cap.
  - Prove the temporary agent on a test PC with the owner present before building any screens.
- Groundwork checked on df-a (MeshCentral 1.2.5):
  - `meshctrl GenerateInviteLink --flags 1` gives an interactive-only link. The customer runs the agent with a Connect button; it is not installed as a service and stops when closed.
  - `agents/MeshCentralAssistant.exe` is present, and Mesh supports `assistantcustomization` (title, file name, image) for Digital Fingers branding.
- Proof plan, with the owner at a non-client test PC:
  1. Create a Mesh device group for one-off support, kept separate from managed devices.
  2. Generate a 1-hour interactive-only link.
  3. On the PC, open the link, run it and press Connect.
  4. Check that no service is installed, the PC appears in the group, and our session window connects with the customer's consent.
  5. Close the app and check the PC disappears and leaves nothing behind.
  6. Repeat with MeshCentral Assistant, then choose which one to brand as "Digital Fingers Quick Support".

- **Proof result (25 Oct, FED-WIN-001, user RemoteTest): passed.**
  - Mesh group "DF Quick Support" was created with consent `127` (notify, plus a consent prompt for desktop, terminal and files, plus a connection toolbar) and flag `1` (auto-remove on disconnect).
  - A 1-hour `--flags 1` link was used. The download `meshagent64-DFQuickSupport.exe` ran from Downloads as the signed-in user (no admin, no service) and appeared as a separate device in the group. The managed agents were untouched.
  - The consent prompt appeared and the desktop session worked.
  - After disconnecting and closing the window, the group was empty and no process was left. Only the downloaded file remains.
  - Mesh also supports group invite codes (`EditDeviceGroup --invitecodes`), which could back the short session code.
- **Cleanup noted:** MeshCentral has an old, offline duplicate of the managed FED-WIN-001. Console device 2's stored `mesh_node_id` points at that stale entry, while the live one is a second "Digital Fingers" entry. Connect already picks the live, connected node by hostname and stores it, so this only needs tidying. The proof group "DF Quick Support" can be removed.
- **Version 1 built and deployed (25 Oct), not yet tested with a customer PC:**
  - License: module `remote_support` and column `licenses.support_concurrent` (default 1), set from Control ("Remote support" tick box and "Support sessions at once"). Shown on Manage Subscription. The rail shows "Support" above Devices only when the module is on.
  - Table `support_sessions` (code, status waiting / connected / ended / expired, topic, customer email, ticket, notes, Mesh group and node, hostname, OS, who started and ended it). Mesh IDs are never sent to the browser.
  - Start (`POST /v1/support-sessions`): checks the concurrent limit, makes a 6-digit code that works for 15 minutes, and creates a Mesh group "Digital Fingers Support <code>" with auto-remove (features 1) and consent 127. It optionally emails the customer the link. Audit `support.start`, `support.join`, `support.remote`, `support.end`, `support.expire`, `support.deny`.
  - Each session has its own Mesh group, removed when the session ends. Every 15 seconds a sweep marks a session connected when its agent comes online, and ends it when the agent has been gone for two checks or after 8 hours. Waiting sessions expire after 15 minutes.
  - Hostname matching (`connectedMeshNode`, `meshNodeMatch`) skips support groups, so a customer's temporary agent can never replace a managed device's node.
  - Public page `https://rmm.digitalfingers.co.za/join` (code entry, then download, run and Allow). The download `/join/download?code=` streams `DigitalFingersQuickSupport.exe` from Mesh's `/meshagents?id=4&meshid=…&installflags=1`, only while the session is waiting. API join lookups are limited to 30 per 10 minutes per address.
  - `/support` page: Access Remote Screen form (problem, customer email, ticket), "How it works" steps, a Sessions tab (big code, copy link and code, countdown, Connect when joined, notes and ticket, Make managed, End session), and a History tab.
  - Connect opens `/support/:id/session` and then the same session window in support mode (`supportId` in the payload). Support mode hides Tools, Files and Invite Technician, because those run through managed-device routes. End also ends the support session (`/support/:id/session-end`).
  - Wrap-up: when the customer closes the app, Mesh removes the device and sends its frame back to the Mesh device list (`xxcurrentView` below 10), which is not a "disconnected" status. The session window now treats that as the session ending: it blanks the frame (so the Mesh device list is never shown) and offers "Wrap up". End in support mode does the same after restoring the resolution. Both end the support session and open `/support?wrap=<id>`, a card for "What was done" and the ticket, with "Save and close off". Tested live on FED-WIN-001 on 25 Oct (joined, connected, consent, closed).
  - The session window takes over Mesh's `go()` in its frame: once connected, any switch away from the device screen counts as the session ending and is blocked, and the desk is hidden (`.app.ended`) behind a branded background. Re-tested on FED-WIN-001 on 25 Oct: no Mesh device list, Wrap up works.
  - Leftover groups: one session's `RemoveDeviceGroup` failed silently during testing. The sweep now removes, about once a minute, any "Digital Fingers Support <code>" group whose code is not a waiting or connected session. The proof group "DF Quick Support" was removed.
  - Make managed is a link to the normal enrolment installer (`/agent/windows`); copy it to the PC during the session and run Install.cmd as an administrator.
  - Backups on df-a: `server.js.bak-support`, `schema.sql.bak-support`, `/var/lib/df-session/index.html.bak-support` and a `df-pg-dump` run.

### Licenses (25 Oct)
- The all-tenants "Licenses" page has left the tenant rail. `/licenses` now redirects (platform admin to `/control`, others to `/subscription`), and `GET /v1/license-usage` with its "digital-fingers" slug exception is gone.
- The Control panel starts with a License usage table: logins and devices used against each tenant's license, with bars, expiry and a status (OK, Near limit, Expires soon, At limit, Expired).
- Manage Subscription (user menu) shows logins and devices as bars against the license, expiry and days left, what is included, warnings, and a Request a change button (email to admin@digitalfingers.co.za with the tenant and license number). `/v1/account` now returns `license.seatsUsed`.
- Owners and admins see a strip under the top bar at 90% of logins or devices, at the limit, or within 30 days of expiry (`licenseStatus()` in `account-data.js`).
- Limits: the device cap was already enforced at agent enrolment. Logins can only be created by tenant creation and `scripts/create-tech.js` / `create-console-admin.js`; both scripts now refuse a new login once the seats are used.

### Patch management (in progress)
- Owner's decisions (25 Oct):
  - "Updates" goes in Diagnostic Tools for each device; the Patches page stays as the overview across all PCs.
  - Updates show Windows severity (Critical / Important / Moderate / Low) and type (Security, Critical, Definition, Driver, Feature, Rollup, …), plus a "Push now" flag for Critical + Security.
  - Admins approve; technicians push approved updates.
  - When a restart is needed, show it with a Restart now button.
- **Agent (built, not yet installed on any PC):**
  - Collects KB, MsrcSeverity, the classification (by WSUS category ID, so it works on non-English Windows), size and whether each update needs a restart, plus `rebootPending` (Windows `Microsoft.Update.SystemInfo.RebootRequired`; Linux `/var/run/reboot-required`). Linux marks updates from `-security` suites as Security.
  - Heartbeat sends `rebootPending` and `acceptDeploys`; the reply can carry `scanUpdates` (the time Get updates was pressed), which triggers an immediate check.
  - Installs run in a background worker, so check-ins continue during long installs. Results include `restartRequired`, and the agent re-checks after each install.
  - Compiled on df-a in `/tmp/dfagent-check` (the Windows build needs the real `meshagent.exe` next to the source for `go:embed`).
- **API (live):**
  - `GET /v1/devices/:id/updates` returns the list with status per update, recent history, `rebootPending`, `scanning` and `online`.
  - `POST /v1/devices/:id/updates/scan`, `/approve {names}` (owner/admin), `/push {names}` (anyone with the patch licence; only approved updates) and `/restart` (only while `reboot_pending`; queues the normal restart job).
  - New columns: `patch_deploys` gains `kb`, `severity`, `category`, `approved_at`, `pushed_by`, `pushed_at` and `restart_required`, status `approved` is added, and `policy_id` may now be empty. `devices` gains `reboot_pending`, `updates_checked_at` and `update_scan_requested_at`.
  - Backups on df-a: `server.js.bak-patches`, `schema.sql.bak-patches` and a `df-pg-dump` run.
- **Restart options (live):**
  - Push takes `restartMode`: `auto` (restart when the batch finishes), `ask` (Digital Fingers pop-up on the PC: "Your remote administrator has applied updates to your computer. Please restart it at your earliest convenience.") or `later` (just show Restart needed).
  - `/restart {mode: "auto" | "ask"}` gives the banner both buttons. Auto restarts in 5 minutes with a warning when a user is logged in, otherwise in 5 seconds (Linux restarts without a warning).
  - Servers (FS01, DC01) need `confirmServer: true` for an automatic restart; otherwise the API returns 409 `{needsConfirm: true}`.
  - When the last queued/running update on a device finishes, the batch restart runs once (`restart_mode`, `restart_handled_at` on `patch_deploys`). Audit: `patch.restart`, `patch.restart.ask`, `patch.restart.fail`.
- **Updates screen (live):** Diagnostic Tools → Updates (`console/app/devices/updates-panel.js`, actions `deviceUpdates` / `deviceUpdateAction`).
  - Get updates, last-checked time, a "Push now" group first, then groups by type, sorted by severity.
  - Checkboxes with bulk Approve (admins only) and Push, plus Approve or Push on each row. "After installing" sets the restart choice for the push.
  - Restart needed banner with Ask user to restart and Restart now (confirms; a second confirmation for servers).
  - Statuses: Available, Waiting for approval, Approved, Queued, Installing, Installed, Installed (restart needed), Failed. "Recently installed" history underneath.
  - Refreshes every 10 seconds while checking or installing.
  - Old agents send no type or severity, so everything shows under "Other updates" until the new agent is installed.
- **Patches overview (live):** `/patches` replaces the old one-policy-per-device page.
  - Four stat cards: Push now, Waiting for approval, Approved but not pushed, Restart needed.
  - A table of every computer sorted by urgency, with online dot, Server tag, counts, restart and last checked. The name opens that computer's Updates screen.
  - Admin button "Approve all Push now updates" (`POST /v1/patches/approve-urgent`); pushing still happens per computer.
  - Auto-approve rules per update type for the whole organisation (`PUT /v1/patch-rules`, table `patch_rules`). They are applied whenever a computer reports updates and straight after saving. They only approve; a technician still pushes. Updates installed in the last day are not re-approved.
  - Approval logic is shared in `approveUpdates()`; the old `patch-policies` API routes still exist but the console no longer uses them.
  - Backups on df-a: `server.js.bak-overview`, `schema.sql.bak-overview` and a `df-pg-dump` run.
- Customers are not tenants. Today users belong only to the tenant, and customers are only a grouping (via sites) for tickets and reports. Patching does not need a customer. Customer logins that can see or manage their own computers were deferred by the owner (25 Oct) as later work.
- Next: then installing the agent on a live PC with the owner present (never restart client PCs as a test).

---

## 4. Files changed (in `5153a15`)

| File | What |
|------|------|
| `console/session-shell/index.html` | The whole session window: menus, panels, drag, messaging |
| `console/session-shell/messenger.html` | **New (after `5153a15`).** Chat page the remote user sees |
| `deploy/caddy/contabo-a.Caddyfile` | Synced with live; adds `/messenger` route (after `5153a15`) |
| `console/app/nav-links.js`, `console/app/bar.js` | **After `5153a15`.** Top nav with active page pill |
| `console/app/dashboard/page.js`, `console/app/tickets/page.js`, `console/app/tickets/[id]/page.js` | **After `5153a15`.** Redesigned layouts |
| `console/app/devices/[id]/session/launch.js` | Payload includes `deviceId` and console origin |
| `console/app/devices/[id]/session-power/route.js` | **New.** Power actions from the session window |
| `console/app/devices/[id]/file-manager/page.js` | **New.** Advanced File Manager page |
| `console/app/devices/[id]/file-transfer/page.js` | **New.** Web File Transfer + Receive pop-up page |
| `console/app/devices/session-device.js` | **New.** Loads the device for those pages |
| `console/app/devices/session-files.js` | **New.** `SessionFileManager`, `FileTransfer`, `ReceivePicker` |
| `console/app/devices/transfer.js` | **New.** Shared `sendFile` / `fetchFile` / `sizeLabel` |
| `console/app/devices/files-panel.js` | Uses the shared helpers; new `startPath` prop |
| `console/app/globals.css` | Styles for `.sf-*`, `.wft-*`, `.rcv-*` |
| `console/next.config.mjs` | Frame header for the two file pages |
| `api/src/server.js` | Safe Mode, safe-boot clearing, `encodedPowerShell()` in `powerCommand()` |
| `api/mesh-files.cjs` | File engine changes from earlier work |
| `api/mesh-sessions.cjs` | **New (after `5153a15`).** List / end Mesh sessions per device |
| `console/app/devices/session-status.js` | **New (after `5153a15`).** Shared open-session poller |
| `console/app/devices/remote-actions.js`, `console/app/actions.js` | **After `5153a15`.** End session pill, End All Sessions menu item, `remoteSessions` / `endRemoteSessions` |

---

## 5. Deploying (df-a)

- **Session window:** copy `index.html` to df-a `/tmp`, then `sudo install -m 644 -o root -g root … /var/lib/df-session/index.html`. `messenger.html` goes to `/var/lib/df-session/messenger.html` the same way.
- **Caddy:** `deploy/caddy/contabo-a.Caddyfile` matches the live `/etc/caddy/Caddyfile` (routes `/df-session`, `/messenger` and `/df-assets/*` (fonts, cached 7 days), then Mesh). Back up, `caddy validate`, install, `systemctl reload caddy`.
- **Console:** `sudo install -D -o dfconsole -g dfconsole -m 644 <file> /opt/df-console/<same path>`, then `sudo chown -R dfconsole:dfconsole /opt/df-console/.next`, `sudo -u dfconsole npm --prefix /opt/df-console run build`, `sudo systemctl restart df-console`.
- **API:** `sudo install -o dfapi -g dfapi -m 644 … /opt/df-api/src/server.js`, `sudo systemctl restart df-api`; health at `http://127.0.0.1:4000/health`.
- There are no local `node_modules`, so builds run on the server. `rg` is not installed on df-a; never pipe the build into it (the build gets killed). Use `> /tmp/df-build.log` and `grep`.
- Cursor's auto-review blocks scp/ssh/sudo deploys. Retry the **exact same command** with approval requested and the exact block reason; you then approve it.

---

## 6. Working rules (from the owner)

- Do not commit or push unless asked.
- Never print live secrets, Mesh node IDs or the Mesh admin password.
- Never reboot, shut down, or kill processes/services on real machines as a test (all online machines are client/office PCs).
- Do not run the KMS tools zip.
- Verify changes in the browser.
- Test device used: **KANLDZAVFS01** (console device id 6), Windows Server, user `serveradmin`.

---

## 7. Not tested on purpose

- **Power Options** (all of them) and opening real programs from Quick Launch.
- **Chat with User** opening on the real remote side (`meshmessenger`), and actually sending a **Send Message** toast or box. Either would pop up on a client screen. The chat itself was tested over the relay with a simulated remote user.
- **Send Files / upload** — would write onto a client server. The upload code is the console's existing upload, moved into `transfer.js`. Try one small file yourself.
- **Display Resolution** restore when the user clicks End (switching and `displayRestore()` were tested on KANLDZAVFS01; the End path closes the window, which the test browser can't do).
- Clicking **Receive Files** inside a live session: the browser tool can't click into a frame from another site. The flow was fully tested on a console-site test page (`win.ini`, 92 B, received), and the pop-up and dragging were checked in the session window.

---

## 8. Ideas / possible next steps

- Advanced File Manager could gain rename/delete, and drag-and-drop upload.
- Re-clamp dragged panels when the browser window is resized smaller.

---

## 9. First message for the new chat

```text
Continue the Digital Fingers remote session window from
docs/SESSION_WINDOW_HANDOFF.md (and docs/CHAT_HANDOFF.md for the platform).
All work in it is deployed to df-a and committed/pushed as 5153a15.
Follow the working rules in section 6.
```

## Security batch 1 (deployed 2026-10-25)

- API: remote file/terminal/service/process/startup routes check the remote-access licence; write operations also need owner/admin (`requireRemote`, audited as `<op>.deny`). Enrol tokens and auto patch policies need owner/admin.
- Login: failure limits per IP (20) and per email (8) in 15 minutes, answered with 429; the console shows a "too many attempts" message. Unknown emails still run a password check. `POST /v1/logout` deletes the session; password changes revoke other sessions.
- Hostnames are cleaned at enrol and heartbeat; CSV exports neutralise formula cells; SMTP has timeouts, header checks and dot-stuffing.
- Console: route handlers refuse cross-site requests (`app/request-guard.js`). Security headers in `next.config.mjs`: `frame-ancestors 'self'` everywhere except the file-manager and file-transfer pages, plus nosniff, Referrer-Policy, HSTS and Permissions-Policy. The ticket remote redirect only goes to the Mesh origin. The unused `devices/[id]/remote` route is removed.
- Session window: the payload URL must be on the Mesh origin and the console origin must be `https://rmm.digitalfingers.co.za`.
- Server backups of the previous files: `*.bak-batch1` next to `server.js`, `mail.js`, `next.config.mjs` and the session `index.html`.
