"use client";

import { useState } from "react";
import { InstallCommand } from "./install-command";

const GROUPS = [
  ["Desktop Apps", ["windows", "mac", "linux"]],
  ["Mobile / IOT", ["ios", "android", "pi"]],
  ["Browser Extensions", ["chrome"]],
];
const LABELS = {
  windows: "Windows",
  mac: "Mac",
  linux: "Linux",
  ios: "iOS",
  android: "Android",
  pi: "Raspberry Pi",
  chrome: "Chrome",
};

export function DownloadGrid({ accounts, blocked, quickSupport, orgName, commands, origin }) {
  const [customer, setCustomer] = useState("");
  const suffix = customer ? `?customer=${encodeURIComponent(customer)}` : "";
  const rows = [
    {
      key: "tech",
      title: "For Technician",
      sub: "Remote Support and Unattended Access",
      text: "Technicians work from this console in the browser. A desktop app for technicians is on the way.",
      tiles: {},
    },
    {
      key: "support",
      title: "For Customer",
      sub: "Remote Support",
      text: "For a one-off session. The customer opens the link, enters the 6-digit code you give them and runs the small app. Nothing stays installed.",
      tiles: quickSupport ? { windows: { href: "/join", note: "Session code" } } : {},
    },
    {
      key: "unattended",
      title: "For Customer",
      sub: "Unattended Access",
      text: `Installs the agent so you can reach the computer at any time. Each download holds a single-use enrollment key for ${orgName}.`,
      tiles: blocked
        ? {}
        : {
            windows: { href: `/agent/windows${suffix}`, note: "Run Install" },
            linux: { href: `/agent/linux${suffix}`, note: "sudo ./install.sh" },
            pi: { href: `/agent/linux${suffix}`, note: "64-bit OS" },
          },
      blocked,
      picker: !blocked && accounts.length > 0,
    },
  ];

  return (
    <div className="downloads">
      <div className="downloads-head" role="presentation">
        <span />
        {GROUPS.map(([group, tiles]) => (
          <span key={group} style={{ gridColumn: `span ${tiles.length}` }}>{group}</span>
        ))}
      </div>
      {rows.map((row) => (
        <section key={row.key} className="downloads-row" aria-label={`${row.title} (${row.sub})`}>
          <div className="downloads-who">
            <h2>{row.title}</h2>
            <p className="downloads-sub">{row.sub}</p>
            <p>{row.text}</p>
            {row.picker ? (
              <label className="downloads-picker">
                Enroll into account
                <select value={customer} onChange={(event) => setCustomer(event.target.value)}>
                  <option value="">No account yet</option>
                  {accounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
            ) : null}
            {row.blocked ? <p className="error">{row.blocked}</p> : null}
          </div>
          {GROUPS.flatMap(([, tiles]) => tiles).map((tile) => {
            const item = row.tiles[tile];
            const body = (
              <>
                <TileIcon name={tile} />
                <strong>{LABELS[tile]}</strong>
                <em>{item ? item.note : "Coming soon"}</em>
              </>
            );
            return item ? (
              <a key={tile} className="downloads-tile" href={item.href}>{body}</a>
            ) : (
              <span key={tile} className="downloads-tile is-soon" aria-disabled="true">{body}</span>
            );
          })}
        </section>
      ))}
      {blocked ? null : (
        <InstallCommand
          customer={customer}
          customerName={accounts.find((item) => String(item.id) === customer)?.name || ""}
          commands={commands}
          origin={origin}
        />
      )}
      <p className="downloads-foot">
        Linux works on Ubuntu, Debian, Fedora, CentOS Stream, Rocky Linux and AlmaLinux. Extract the download, open a terminal in the
        folder and run <code>sudo ./install.sh</code>. Windows: extract the zip, run <strong>Install</strong> and approve the administrator prompt.
        On a server without a desktop, use <strong>Create install command</strong> above instead.
      </p>
    </div>
  );
}

function TileIcon({ name }) {
  const paths = {
    windows: <path d="M4 6.5 11 5.4v6.2H4V6.5zm8 .9 8-1.2v6.4h-8V7.4zM4 13h7v6.3L4 18.2V13zm8 0h8v7.2l-8-1.1V13z" fill="currentColor" />,
    mac: <path d="M16.2 12.6c0-2 1.6-3 1.7-3.1-1-1.4-2.4-1.6-2.9-1.6-1.2-.1-2.4.7-3 .7s-1.6-.7-2.7-.7c-1.4 0-2.7.8-3.4 2.1-1.5 2.5-.4 6.3 1 8.4.7 1 1.5 2.1 2.6 2.1 1 0 1.4-.7 2.7-.7s1.6.7 2.7.7 1.8-1 2.5-2c.8-1.1 1.1-2.2 1.1-2.2s-2.2-.9-2.3-3.7zM14.6 6.8c.6-.7 1-1.7.9-2.7-1 .1-2.1.6-2.7 1.4-.6.7-1.1 1.7-.9 2.6 1 .1 2-.5 2.7-1.3z" fill="currentColor" />,
    linux: (
      <>
        <path d="M12 3.5c2.8 0 4.5 2.2 4.5 5.2 0 1.6-.4 2.8-1 3.6.8.5 1.5 1.4 1.5 2.7 0 2.6-2.2 5.5-5 5.5s-5-2.9-5-5.5c0-1.3.7-2.2 1.5-2.7-.6-.8-1-2-1-3.6 0-3 1.7-5.2 4.5-5.2z" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="10.2" cy="9" r="0.8" fill="currentColor" />
        <circle cx="13.8" cy="9" r="0.8" fill="currentColor" />
      </>
    ),
    ios: (
      <>
        <rect x="7" y="3" width="10" height="18" rx="2.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M10.5 5.5h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </>
    ),
    android: (
      <>
        <path d="M6.5 11a5.5 5.5 0 0 1 11 0v6.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V11z" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M6.5 11.5h11M8.5 6 7 3.8M15.5 6 17 3.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="9.8" cy="8.6" r="0.8" fill="currentColor" />
        <circle cx="14.2" cy="8.6" r="0.8" fill="currentColor" />
      </>
    ),
    pi: (
      <>
        <circle cx="12" cy="14" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="12" cy="14" r="1.6" fill="currentColor" />
        <path d="M8 6.5c1.5-1.8 2.8-2 4-.7 1.2-1.3 2.5-1.1 4 .7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </>
    ),
    chrome: (
      <>
        <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M12 8.8h8M9.2 13.6 5.2 6.7M14.8 13.6l-4 6.9" stroke="currentColor" strokeWidth="1.6" />
      </>
    ),
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}
