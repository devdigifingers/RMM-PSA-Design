"use client";

import { useState } from "react";
import { disableMfa, enableMfa, newRecoveryCodes, startMfaSetup } from "../../../actions";

export function MfaCard({ enabled, orgRequires, required }) {
  const [state, setState] = useState(enabled ? "on" : "off");
  const [setup, setSetup] = useState(null);
  const [codes, setCodes] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(task) {
    setBusy(true);
    setError("");
    try {
      await task();
    } finally {
      setBusy(false);
    }
  }

  function begin() {
    run(async () => {
      const result = await startMfaSetup();
      if (result.error) return setError(result.error);
      setSetup(result);
      setState("setup");
    });
  }

  function confirm(event) {
    event.preventDefault();
    const code = new FormData(event.currentTarget).get("code");
    run(async () => {
      const result = await enableMfa(code);
      if (result.error) return setError(result.error);
      setCodes(result.recoveryCodes);
      setSetup(null);
      setState("codes");
    });
  }

  function turnOff(event) {
    event.preventDefault();
    const code = new FormData(event.currentTarget).get("code");
    run(async () => {
      const result = await disableMfa(code);
      if (result.error) return setError(result.error);
      setState("off");
    });
  }

  function refreshCodes(event) {
    event.preventDefault();
    const code = new FormData(event.currentTarget).get("code");
    run(async () => {
      const result = await newRecoveryCodes(code);
      if (result.error) return setError(result.error);
      setCodes(result.recoveryCodes);
      setState("codes");
    });
  }

  function download() {
    const text = `Digital Fingers RMM recovery codes\nEach code works once.\n\n${codes.join("\n")}\n`;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    link.download = "digital-fingers-recovery-codes.txt";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <section className="mfa-card">
      {state === "off" ? (
        <>
          <h2>Authenticator app <span className="tech-state off">Off</span></h2>
          <p className="org-name">After your password, the console asks for a 6-digit code from an app such as Microsoft Authenticator or Google Authenticator. Someone who learns your password still cannot sign in.</p>
          <button type="button" onClick={begin} disabled={busy}>{busy ? "Starting…" : "Set up MFA"}</button>
        </>
      ) : null}

      {state === "setup" && setup ? (
        <>
          <h2>Scan the code</h2>
          <div className="mfa-setup">
            <img src={setup.qr} alt="QR code for your authenticator app" width={208} height={208} />
            <div>
              <ol>
                <li>Open your authenticator app and add an account.</li>
                <li>Scan this QR code. If you cannot scan, enter this key: <code className="mfa-key">{setup.secret.match(/.{1,4}/g).join(" ")}</code></li>
                <li>Type the 6-digit code the app shows.</li>
              </ol>
              <form onSubmit={confirm} className="mfa-inline">
                <input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123456" aria-label="6-digit code" required autoFocus />
                <button type="submit" disabled={busy}>{busy ? "Checking…" : "Turn on MFA"}</button>
              </form>
            </div>
          </div>
        </>
      ) : null}

      {state === "codes" && codes ? (
        <>
          <h2>Save your recovery codes</h2>
          <p className="org-name">If you lose your phone, sign in with one of these codes instead. Each code works once. They are shown only now.</p>
          <ul className="mfa-codes">
            {codes.map((code) => <li key={code}><code>{code}</code></li>)}
          </ul>
          <div className="mfa-actions">
            <button type="button" className="secondary" onClick={download}>Download</button>
            <button type="button" className="secondary" onClick={() => navigator.clipboard?.writeText(codes.join("\n"))}>Copy</button>
            {required ? <a className="deploy-download" href="/devices">Continue to the console</a> : (
              <button type="button" onClick={() => { setCodes(null); setState("on"); }}>I have saved them</button>
            )}
          </div>
        </>
      ) : null}

      {state === "on" ? (
        <>
          <h2>Authenticator app <span className="tech-state on">On</span></h2>
          <p className="org-name">Your login asks for a code from your authenticator app after the password.</p>
          <div className="mfa-manage">
            <form onSubmit={refreshCodes} className="mfa-inline">
              <input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={11} placeholder="Current code" aria-label="Current code for new recovery codes" required />
              <button type="submit" className="secondary" disabled={busy}>New recovery codes</button>
            </form>
            {orgRequires ? (
              <p className="org-name">Your organisation requires MFA, so it cannot be turned off.</p>
            ) : (
              <form onSubmit={turnOff} className="mfa-inline">
                <input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={11} placeholder="Current code" aria-label="Current code to turn off MFA" required />
                <button type="submit" className="danger" disabled={busy}>Turn off MFA</button>
              </form>
            )}
          </div>
        </>
      ) : null}

      {error ? <p className="error" role="alert">{error}</p> : null}
    </section>
  );
}
