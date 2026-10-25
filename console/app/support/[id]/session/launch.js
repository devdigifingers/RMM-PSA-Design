"use client";

import { useEffect, useState } from "react";
import { startSupportRemote } from "../../../actions";

export function SupportLaunch({ supportId, host }) {
  const [error, setError] = useState("");

  useEffect(() => {
    let gone = false;
    startSupportRemote(supportId).then((result) => {
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
        host: result.hostname || host,
        label: "Remote support",
        supportId: String(supportId),
        console: window.location.origin,
      }));
      window.location.replace(`${origin}/df-session#${payload}`);
    });
    return () => {
      gone = true;
    };
  }, [supportId, host]);

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
