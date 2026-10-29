"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createInstallCommand, revokeInstallCommand } from "../actions";

const USES = [1, 5, 10, 25];

export function InstallCommand({ customer, customerName, commands, origin }) {
  const router = useRouter();
  const [uses, setUses] = useState("1");
  const [created, setCreated] = useState(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function create() {
    setError("");
    startTransition(async () => {
      const result = await createInstallCommand(customer, uses);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setCreated({ ...result, uses: Number(uses), customerName });
      router.refresh();
    });
  }

  function revoke(id) {
    setError("");
    startTransition(async () => {
      const result = await revokeInstallCommand(id);
      if (!result.ok) setError(result.error);
      router.refresh();
    });
  }

  const linux = created ? `curl -fsSL ${origin}/i/${created.code}/linux | sudo sh` : "";
  const windows = created ? `irm ${origin}/i/${created.code}/windows | iex` : "";

  return (
    <section className="downloads-cli" aria-label="Servers and command line">
      <div className="downloads-cli-head">
        <div>
          <h2>Servers and command line</h2>
          <p>
            For servers and computers you reach over SSH or a remote shell. Create a command and paste it on each computer.
            It enrolls into the account chosen above{customerName ? ` (${customerName})` : ""} and stops working after 24 hours or once it has been used the number of times you choose.
          </p>
        </div>
        <div className="downloads-cli-make">
          <label>
            Computers
            <select value={uses} onChange={(event) => setUses(event.target.value)}>
              {USES.map((value) => <option key={value} value={value}>{value === 1 ? "1 computer" : `Up to ${value}`}</option>)}
            </select>
          </label>
          <button type="button" onClick={create} disabled={pending}>{pending ? "Working…" : "Create install command"}</button>
        </div>
      </div>
      {error ? <p className="error">{error}</p> : null}
      {created ? (
        <div className="downloads-cli-result">
          <p className="downloads-cli-once">
            Copy the commands now. They are shown only once and work for {created.uses === 1 ? "one computer" : `up to ${created.uses} computers`} until {new Date(created.expiresAt).toLocaleString()}. Anyone with the command can enroll a computer, so share it like a password.
          </p>
          <CommandBox
            title="Linux (Ubuntu, Debian, Fedora, CentOS Stream, Rocky, Alma)"
            steps="Paste into a terminal or SSH session. sudo asks for the password."
            command={linux}
          />
          <CommandBox
            title="Windows and Windows Server"
            steps="Open PowerShell as administrator (right-click Start, Terminal (Admin)) and paste."
            command={windows}
          />
        </div>
      ) : null}
      {commands.length ? (
        <div className="downloads-cli-active">
          <h3>Active install commands</h3>
          <ul>
            {commands.map((item) => (
              <li key={item.id}>
                <span>
                  <strong>{item.useCount} of {item.maxUses}</strong> used · {item.customer || "No account"} · expires {new Date(item.expiresAt).toLocaleString()}
                  {item.createdBy ? ` · by ${item.createdBy}` : ""}
                </span>
                <button type="button" className="secondary" onClick={() => revoke(item.id)} disabled={pending}>Revoke</button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function CommandBox({ title, steps, command }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }
  return (
    <div className="downloads-cli-box">
      <strong>{title}</strong>
      <p>{steps}</p>
      <div className="downloads-cli-line">
        <code>{command}</code>
        <button type="button" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
      </div>
    </div>
  );
}
