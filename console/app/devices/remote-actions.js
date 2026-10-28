"use client";

import { useEffect, useRef, useState } from "react";
import { endRemoteSessions, powerDevice, restartRemoteAgent, updateAgent } from "../actions";
import { openRemoteSession } from "./remote-window";
import { DIAGNOSTIC_TOOLS } from "./diagnostic-tools";
import { refreshSessions, useDeviceSessions } from "./session-status";

const POWER = [
  ["shutdown", "Shutdown"],
  ["restart", "Restart"],
  ["logoff", "Log off"],
  ["hibernate", "Hibernate"],
  ["sleep", "Sleep"],
  ["lock", "Lock"],
];

export function RemoteActions({ deviceId, hostname, label = "", users, connectOnly = false, agent = null, ticketId = null }) {
  const [menu, setMenu] = useState(null);
  const [spot, setSpot] = useState(null);
  const [user, setUser] = useState(users[0] || "");
  const [pending, setPending] = useState(null);
  const [note, setNote] = useState("");
  const [fly, setFly] = useState(null);
  const [ending, setEnding] = useState(false);
  const [stuck, setStuck] = useState(false);
  const root = useRef(null);
  const sessions = useDeviceSessions(deviceId);
  const open = sessions?.total || 0;

  useEffect(() => {
    function close(event) {
      if (!root.current?.contains(event.target)) setMenu(null);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  function toggle(name, event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom;
    const openUp = below < 560 && rect.top > below;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - (name === "users" ? 210 : 320)));
    setSpot(openUp
      ? { bottom: window.innerHeight - rect.top + 6, left, maxHeight: Math.max(180, rect.top - 16) }
      : { top: rect.bottom + 6, left, maxHeight: Math.max(180, window.innerHeight - rect.bottom - 16) });
    setMenu((current) => (current === name ? null : name));
  }

  function chooseBranch(name, event) {
    const parent = event.currentTarget.closest(".remote-menu").getBoundingClientRect();
    const top = Math.max(8, parent.top);
    setFly({
      top,
      right: window.innerWidth - parent.left + 4,
      maxHeight: Math.max(180, window.innerHeight - top - 8),
      maxWidth: Math.max(180, parent.left - 12),
    });
    setMenu(name);
  }

  function openTool(id) {
    setMenu(null);
    window.location.href = `/devices/${deviceId}/diagnostics?tool=${encodeURIComponent(id)}`;
  }

  function connect(chosen) {
    const person = typeof chosen === "string" ? chosen : (user || users[0] || "");
    const opened = openRemoteSession({ deviceId, hostname, label, user: person, ticketId });
    if (!opened) setNote("Allow pop-ups for this site to open the remote session.");
  }

  async function sendPower() {
    const action = pending?.action;
    const label = pending?.label;
    setPending(null);
    setMenu(null);
    if (!action) return;
    setNote("Sending…");
    const result = await powerDevice(String(deviceId), action);
    setNote(result.ok ? `${label} sent. It runs on the next check-in.` : result.error);
  }

  async function sendAgentUpdate() {
    setMenu(null);
    setNote("Sending…");
    const result = await updateAgent(String(deviceId));
    if (!result.ok) setNote(result.error);
    else if (result.status === "current") setNote(`The agent is already on ${result.version}.`);
    else setNote(`Agent ${result.version} sent. It installs on the next check-in when the PC is idle.`);
  }

  async function endSessions() {
    setMenu(null);
    setEnding(true);
    setNote("Ending sessions…");
    const result = await endRemoteSessions(String(deviceId));
    setEnding(false);
    setStuck(Boolean(result.ok && result.remaining));
    if (!result.ok) setNote(result.error);
    else if (result.remaining) {
      setNote(`The agent on ${hostname} still reports ${plural(result.remaining, "open session")}. Its connection may already be closed; restarting the agent clears it.`);
    } else setNote(result.ended ? `Ended ${plural(result.ended, "session")}.` : "No sessions were open.");
    refreshSessions();
  }

  async function restartAgent() {
    setMenu(null);
    setStuck(false);
    setEnding(true);
    setNote("Restarting the agent… this can take up to a minute.");
    const result = await restartRemoteAgent(String(deviceId));
    setEnding(false);
    if (!result.ok) setNote(result.error);
    else if (!result.back) setNote(`Restart sent to ${hostname}. The agent hasn't reconnected yet; check again in a minute.`);
    else if (result.remaining) setNote(`The agent restarted but still reports ${plural(result.remaining, "session")}. Someone may really be connected.`);
    else setNote(`The agent on ${hostname} restarted. No sessions are open.`);
    refreshSessions();
  }

  return (
    <div className="remote-actions" ref={root}>
      {open ? (
        <button
          type="button"
          className="end-session"
          title={`Open on ${hostname}: ${describe(sessions)}`}
          aria-expanded={menu === "end"}
          disabled={ending}
          onClick={(event) => toggle("end", event)}
        >
          <span className="live-dot" aria-hidden="true" />
          End session{open > 1 ? `s (${open})` : ""}
        </button>
      ) : null}
      {connectOnly ? null : (
        <button type="button" className="tool-btn" aria-label="Tools" aria-expanded={menu === "tools" || menu === "power" || menu === "toolmenu"} onClick={(event) => toggle("tools", event)}>
          <Wrench />
        </button>
      )}
      <div className="connect-split">
        <button type="button" className="connect-main" onClick={connect}>Connect</button>
        <button type="button" className="connect-more" aria-label="Choose a user" aria-expanded={menu === "users"} onClick={(event) => toggle("users", event)}>
          <Chevron />
        </button>
      </div>
      {menu === "users" && spot ? (
        <ul className="remote-menu" style={{ top: spot.top, bottom: spot.bottom, left: spot.left, maxHeight: spot.maxHeight }}>
          {users.length === 0 ? <li className="menu-note">No one is logged in</li> : users.map((name) => (
            <li key={name}>
              <button type="button" onClick={() => { setUser(name); setMenu(null); connect(name); }}>{name}</button>
            </li>
          ))}
        </ul>
      ) : null}
      {(menu === "tools" || menu === "power" || menu === "toolmenu") && spot ? (
        <ul className="remote-menu" style={{ top: spot.top, bottom: spot.bottom, left: spot.left, maxHeight: spot.maxHeight }}>
          <li>
            <button type="button" className={menu === "power" ? "menu-branch open" : "menu-branch"} aria-expanded={menu === "power"} onClick={(event) => chooseBranch("power", event)}>
              Power Options
              <Caret />
            </button>
          </li>
          <li>
            <button type="button" className={menu === "toolmenu" ? "menu-branch open" : "menu-branch"} aria-expanded={menu === "toolmenu"} onClick={(event) => chooseBranch("toolmenu", event)}>
              Tools
              <Caret />
            </button>
          </li>
          {agent ? (
            <li>
              <button type="button" disabled={!agent.outdated} onClick={() => setMenu("agent")}>
                {agent.outdated ? `Update agent to ${agent.latest}` : "Agent is up to date"}
              </button>
            </li>
          ) : null}
          <li>
            <button type="button" disabled={ending} onClick={() => setMenu("restartAgent")}>Restart remote agent</button>
          </li>
          <li>
            <button type="button" className="menu-danger" disabled={ending} onClick={() => setMenu("end")}>
              End All Sessions{open ? ` (${open})` : ""}
            </button>
          </li>
        </ul>
      ) : null}
      {menu === "restartAgent" && spot ? (
        <ul className="remote-menu" style={{ top: spot.top, bottom: spot.bottom, left: spot.left, maxHeight: spot.maxHeight }}>
          <li className="power-confirm">
            <p>
              Restart the remote agent on {hostname}? Every remote session on it (desktop, terminal, files) is closed and
              the device is offline for up to a minute. The PC and the logged-in user are not affected.
            </p>
            <button type="button" onClick={() => setMenu(null)}>Cancel</button>
            <button type="button" onClick={restartAgent}>Restart agent</button>
          </li>
        </ul>
      ) : null}
      {menu === "end" && spot ? (
        <ul className="remote-menu" style={{ top: spot.top, bottom: spot.bottom, left: spot.left, maxHeight: spot.maxHeight }}>
          <li className="power-confirm">
            <p>
              {open
                ? `End ${plural(open, "session")} on ${hostname}? Anyone connected (${describe(sessions)}) is disconnected.`
                : `End every remote session on ${hostname}? None are showing as open right now.`}
            </p>
            <button type="button" onClick={() => setMenu(null)}>Cancel</button>
            <button type="button" onClick={endSessions}>End sessions</button>
          </li>
        </ul>
      ) : null}
      {menu === "agent" && spot && agent ? (
        <ul className="remote-menu" style={{ top: spot.top, bottom: spot.bottom, left: spot.left, maxHeight: spot.maxHeight }}>
          <li className="power-confirm">
            <p>
              Update the agent on {hostname} from {agent.version || "1.4.0 or older"} to {agent.latest}? The agent restarts
              briefly. Remote desktop stays connected.
            </p>
            <button type="button" onClick={() => setMenu(null)}>Cancel</button>
            <button type="button" onClick={sendAgentUpdate}>Update</button>
          </li>
        </ul>
      ) : null}
      {menu === "power" && fly ? (
        <ul className="remote-submenu" style={{ top: fly.top, right: fly.right, maxHeight: fly.maxHeight, maxWidth: fly.maxWidth }}>
          {pending ? (
            <li className="power-confirm">
              <p>{pending.label} {hostname}?</p>
              <button type="button" onClick={() => setPending(null)}>Cancel</button>
              <button type="button" onClick={sendPower}>{pending.label}</button>
            </li>
          ) : POWER.map(([action, label]) => (
            <li key={action}><button type="button" onClick={() => setPending({ action, label })}>{label}</button></li>
          ))}
        </ul>
      ) : null}
      {menu === "toolmenu" && fly ? (
        <ul className="remote-submenu" style={{ top: fly.top, right: fly.right, maxHeight: fly.maxHeight, maxWidth: fly.maxWidth }}>
                {DIAGNOSTIC_TOOLS.map((item) => (
                  <li key={item.id}><button type="button" onClick={() => openTool(item.id)}>{item.label}</button></li>
                ))}
        </ul>
      ) : null}
      {note ? (
        <span className="power-note">
          {note}
          {stuck ? (
            <button type="button" className="note-action" disabled={ending} onClick={(event) => toggle("restartAgent", event)}>
              Restart agent
            </button>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function describe(sessions) {
  if (!sessions) return "";
  return [
    [sessions.desktop, "desktop"],
    [sessions.terminal, "terminal"],
    [sessions.files, "files"],
    [sessions.other, "other"],
  ].filter(([count]) => count).map(([count, word]) => `${count} ${word}`).join(", ");
}

function Wrench() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

function Chevron() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M6 9l6 6 6-6" />
    </svg>
  );
}

function Caret() {
  return <span className="menu-caret" aria-hidden="true" />;
}
