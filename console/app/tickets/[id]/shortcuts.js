"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { assignTicketToMe } from "../../actions";
import { shortcutBlocked } from "../columns";

export function TicketShortcuts({ ticketId, me, assigned }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [, startTransition] = useTransition();

  useEffect(() => {
    function onKey(event) {
      if (shortcutBlocked(event)) return;
      const key = event.key.toLowerCase();
      if (key === "r" || key === "n") {
        const tab = document.querySelector(`.composer-tabs [role="tab"]:nth-child(${key === "r" ? 1 : 2})`);
        if (!tab) return;
        event.preventDefault();
        tab.click();
        requestAnimationFrame(() => document.querySelector(".composer textarea")?.focus());
      } else if (key === "a" && me && !assigned) {
        event.preventDefault();
        setNote("Assigning to you…");
        startTransition(async () => {
          const result = await assignTicketToMe(ticketId, me);
          setNote(result.ok ? "" : result.error);
          router.refresh();
        });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ticketId, me, assigned, router]);

  return note ? <p className="org-name" role="status">{note}</p> : null;
}
