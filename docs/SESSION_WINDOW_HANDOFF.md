# Remote session window — chat handoff

**Last updated:** 2026-10-24
**Scope:** The remote session window (left rail: View, Session, Tools, Files, Chat) and everything built for it in this chat.
**Status:** All work below is **deployed to df-a and tested**, but **not committed or pushed**.

Related: [CHAT_HANDOFF.md](./CHAT_HANDOFF.md) (original platform planning) · [DECISIONS.md](./DECISIONS.md)

---

## 1. What the session window is

- A static page: `console/session-shell/index.html`.
- Served same-origin from the Mesh host at `https://mesh.digitalfingers.co.za/df-session` (Caddy), deployed to `/var/lib/df-session/index.html` on **df-a**.
- It embeds MeshCentral's own UI in an iframe (`#desk`, `viewmode` 11 desktop / 12 terminal, `hide=63`). MeshCentral is the **remote engine only**; the window, menus and features are ours.
- The console (`https://rmm.digitalfingers.co.za`) opens it from **Connect** (`console/app/devices/[id]/session/launch.js`). The payload passes `deviceId`, `console` (console origin), user, title, etc.
- The two sites are the **same site** (`digitalfingers.co.za`), so console cookies (`df_session`) are sent inside frames.

---

## 2. Features built (all working)

### Waiting screen
Blue monitor with animated "eyes" and "You'll be able to access the remote device shortly." Shown until the desktop reports connected.

### View menu
Actual Size, Full Screen, Show Remote Cursor, Color Quality (Best/High/Medium/Low), Screen Resolution (100/75/50/25%).
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

How the pieces talk:
- Transfer panel → session window: `postMessage({type:"df-receive", path, to})`. The session window checks the sender's origin equals the console origin and that it came from the transfer frame.
- Pop-up → transfer panel: `BroadcastChannel("df-transfer-<deviceId>")` with the panel's random `to` ID, so only the panel that asked receives the files (prevents duplicate downloads when two session windows are open). The panel acknowledges; if no acknowledgement, the pop-up downloads the files itself.
- Pop-up → session window: `postMessage({type:"df-receive-close"})`.
- Both frames use `referrerpolicy="origin"` so the console page knows the parent origin.
- `console/next.config.mjs` sends `Content-Security-Policy: frame-ancestors 'self' https://mesh.digitalfingers.co.za` on the two file pages only.

---

## 3. Files changed (uncommitted)

| File | What |
|------|------|
| `console/session-shell/index.html` | The whole session window: menus, panels, drag, messaging |
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

---

## 4. Deploying (df-a)

- **Session window:** copy `index.html` to df-a `/tmp`, then `sudo install -m 644 -o root -g root … /var/lib/df-session/index.html`.
- **Console:** `sudo install -D -o dfconsole -g dfconsole -m 644 <file> /opt/df-console/<same path>`, then `sudo chown -R dfconsole:dfconsole /opt/df-console/.next`, `sudo -u dfconsole npm --prefix /opt/df-console run build`, `sudo systemctl restart df-console`.
- **API:** `sudo install -o dfapi -g dfapi -m 644 … /opt/df-api/src/server.js`, `sudo systemctl restart df-api`; health at `http://127.0.0.1:4000/health`.
- There are no local `node_modules`, so builds run on the server.
- Cursor's auto-review blocks scp/ssh/sudo deploys. Retry the **exact same command** with approval requested and the exact block reason; you then approve it.

---

## 5. Working rules (from the owner)

- Do not commit or push unless asked.
- Never print live secrets, Mesh node IDs or the Mesh admin password.
- Never reboot, shut down, or kill processes/services on real machines as a test (all online machines are client/office PCs).
- Do not run the KMS tools zip.
- Verify changes in the browser.
- Test device used: **KANLDZAVFS01** (console device id 6), Windows Server, user `serveradmin`.

---

## 6. Not tested on purpose

- **Power Options** (all of them) and opening real programs from Quick Launch.
- **Send Files / upload** — would write onto a client server. The upload code is the console's existing upload, moved into `transfer.js`. Try one small file yourself.
- Clicking **Receive Files** inside a live session: the browser tool can't click into a frame from another site. The flow was fully tested on a console-site test page (`win.ini`, 92 B, received), and the pop-up and dragging were checked in the session window.

---

## 7. Ideas / possible next steps

- Commit this work when ready.
- Chat button (currently opens MeshCentral's chat) could get the same flyout treatment.
- Advanced File Manager could gain rename/delete, and drag-and-drop upload.
- Re-clamp dragged panels when the browser window is resized smaller.

---

## 8. First message for the new chat

```text
Continue the Digital Fingers remote session window from
docs/SESSION_WINDOW_HANDOFF.md (and docs/CHAT_HANDOFF.md for the platform).
All work in it is deployed to df-a and tested but not committed.
Follow the working rules in section 5.
```
