"use client";

import { useEffect, useState } from "react";
import { startTimer, stopTimer } from "../../actions";

function clock(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return [hours, minutes, rest].map((part) => String(part).padStart(2, "0")).join(":");
}

export function TicketTimer({ ticketId, startedAt }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!startedAt) return undefined;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [startedAt]);

  if (!startedAt) {
    return (
      <form action={startTimer} className="timer-form">
        <input type="hidden" name="ticketId" value={ticketId} />
        <button type="submit" className="timer-start">Start timer</button>
      </form>
    );
  }

  const seconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  return (
    <form action={stopTimer} className="timer-form is-running">
      <input type="hidden" name="ticketId" value={ticketId} />
      <span className="timer-clock" suppressHydrationWarning>{clock(seconds)}</span>
      <input name="note" maxLength={500} placeholder="What was done (optional)" aria-label="Timer note" />
      <label className="cust-check">
        <input type="checkbox" name="billable" defaultChecked />
        Billable
      </label>
      <button type="submit">Stop and log</button>
    </form>
  );
}
