"use client";

import { useEffect, useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";

export function TerminalPanel({ deviceId, osName, users }) {
  const windows = /windows/i.test(osName || "");
  const names = (Array.isArray(users) ? users : []).map((user) => String(user || "").trim()).filter(Boolean);
  const [shell, setShell] = useState("cmd");
  const [runAs, setRunAs] = useState("system");
  const screen = useRef(null);

  useEffect(() => {
    const host = screen.current;
    if (!host) return undefined;
    let stopped = false;
    let ticket = "";
    let term;
    let reader;
    const controller = new AbortController();

    async function open() {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      if (stopped || !host) return;
      const background = shell === "powershell" ? "#012456" : "#000000";
      term = new Terminal({
        cursorBlink: true,
        fontFamily: "Consolas, \"Courier New\", monospace",
        fontSize: 14,
        theme: { background, foreground: "#f2f2f2", cursor: "#f2f2f2", selectionBackground: "#ffffff33" },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(host);
      fit.fit();
      term.focus();
      // xterm sends Ctrl+V to the shell as ^V; returning false lets the browser fire its paste event,
      // which xterm turns into input. Ctrl+C copies only when text is selected, else it interrupts.
      term.attachCustomKeyEventHandler((event) => {
        if (event.type !== "keydown" || !(event.ctrlKey || event.metaKey) || event.altKey) return true;
        const key = event.key.toLowerCase();
        if (key === "v") return false;
        if (key === "c" && (event.shiftKey || term.hasSelection())) {
          if (term.hasSelection()) navigator.clipboard?.writeText(term.getSelection()).catch(() => {});
          term.clearSelection();
          event.preventDefault();
          return false;
        }
        return true;
      });
      host.oncontextmenu = (event) => {
        event.preventDefault();
        if (term.hasSelection()) {
          navigator.clipboard?.writeText(term.getSelection()).catch(() => {});
          term.clearSelection();
          return;
        }
        navigator.clipboard?.readText().then((text) => { if (text) term.paste(text); }).catch(() => {});
      };
      const opened = await fetch(`/devices/${deviceId}/terminal`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ shell, runAs, cols: term.cols || 100, rows: term.rows || 30 }),
        signal: controller.signal,
      });
      const body = await opened.json().catch(() => ({}));
      if (stopped) return;
      if (!opened.ok || !body.ticket) {
        term.write(`${body.error || "The shell did not start."}\r\n`);
        return;
      }
      ticket = body.ticket;
      const output = await fetch(`/devices/${deviceId}/terminal/${ticket}`, { signal: controller.signal });
      if (!output.ok || !output.body) {
        const failed = await output.json().catch(() => ({}));
        term.write(`${failed.error || "The shell did not start."}\r\n`);
        return;
      }
      let queued = "";
      let sending = false;
      const sendQueued = () => {
        if (sending || !queued || stopped) return;
        sending = true;
        const payload = queued;
        queued = "";
        fetch(`/devices/${deviceId}/terminal/${ticket}/input`, { method: "POST", body: payload })
          .finally(() => {
            sending = false;
            if (queued) sendQueued();
          });
      };
      const typed = term.onData((data) => {
        queued += data;
        sendQueued();
      });
      const resized = term.onResize(({ cols, rows }) => {
        fetch(`/devices/${deviceId}/terminal/${ticket}/size`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cols, rows }),
        }).catch(() => {});
      });
      const observer = new ResizeObserver(() => fit.fit());
      observer.observe(host);
      reader = output.body.getReader();
      const decoder = new TextDecoder();
      while (!stopped) {
        const step = await reader.read();
        if (step.done) break;
        term.write(decoder.decode(step.value, { stream: true }));
      }
      typed.dispose();
      resized.dispose();
      observer.disconnect();
    }

    open().catch(() => {
      if (!stopped && term) term.write("The shell did not start.\r\n");
    });

    return () => {
      stopped = true;
      controller.abort();
      reader?.cancel().catch(() => {});
      term?.dispose();
      if (ticket) fetch(`/devices/${deviceId}/terminal/${ticket}`, { method: "DELETE" }).catch(() => {});
    };
  }, [deviceId, shell, runAs]);

  return (
    <div className="terminal">
      <div className="term-tabs" role="tablist" aria-label="Shell">
        <button type="button" role="tab" aria-selected={shell === "cmd"} className={shell === "cmd" ? "is-active" : ""} onClick={() => setShell("cmd")}>Command Prompt</button>
        {windows ? (
          <button type="button" role="tab" aria-selected={shell === "powershell"} className={shell === "powershell" ? "is-active" : ""} onClick={() => setShell("powershell")}>PowerShell</button>
        ) : null}
      </div>
      <label className="term-run">
        Run As
        <select aria-label="Run As" value={runAs} onChange={(event) => setRunAs(event.target.value)}>
          <option value="system">{windows ? "SYSTEM" : "root"}</option>
          {names.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      </label>
      <div className={shell === "powershell" ? "term-screen is-powershell" : "term-screen"} ref={screen} />
    </div>
  );
}
