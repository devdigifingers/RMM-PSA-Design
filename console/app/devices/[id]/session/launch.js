"use client";

import { useEffect, useState } from "react";
import { startRemoteSession } from "../../../actions";

export function SessionLaunch({ deviceId, host, label, user, ticketId }) {
  const [error, setError] = useState("");

  useEffect(() => {
    let gone = false;
    startRemoteSession(deviceId, user, ticketId).then((result) => {
      if (gone) return;
      if (!result.ok || !result.url) {
        setError(result.error || "The remote session did not start.");
        return;
      }
      let origin = "";
      try {
        origin = new URL(result.url).origin;
      } catch {
        setError("The remote session did not start.");
        return;
      }
      const payload = encodeURIComponent(JSON.stringify({
        url: result.url,
        host,
        label,
        user,
        deviceId: String(deviceId),
        console: window.location.origin,
      }));
      window.location.replace(`${origin}/df-session#${payload}`);
    });
    return () => {
      gone = true;
    };
  }, [deviceId, host, label, user, ticketId]);

  return (
    <main className="remote-wait">
      {error ? (
        <>
          <p>The remote session did not start</p>
          <strong>{error}</strong>
        </>
      ) : (
        <>
          <p>Please wait</p>
          <strong>Starting Support Session</strong>
          <span className="remote-spinner" aria-hidden="true" />
        </>
      )}
    </main>
  );
}
