"use client";

import { useState } from "react";
import { useAllSessions } from "./session-status";

export function SessionFilter() {
  const [on, setOn] = useState(false);
  const sessions = useAllSessions();
  const live = Object.keys(sessions).filter((id) => sessions[id]?.total > 0 && /^\d+$/.test(id));
  const keep = live.map((id) => `:not([data-device="${id}"])`).join("");
  return (
    <>
      <button
        type="button"
        className={`filter-chip${on ? " on" : ""}`}
        aria-pressed={on}
        onClick={() => setOn(!on)}
        title={on ? "Show all devices" : "Show only devices with an open remote session"}
      >
        <span className={`live-dot${live.length ? "" : " idle"}`} aria-hidden="true" />
        In session ({live.length})
      </button>
      {on ? (
        <style>{`.systems tbody tr[data-device]${keep} { display: none; }${live.length ? "" : " .systems .no-live { display: table-row; }"}`}</style>
      ) : null}
    </>
  );
}
