import { headers } from "next/headers";
import { Wordmark } from "../mark";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";

export const metadata = { title: "Join a support session" };

export default async function JoinPage({ searchParams }) {
  const params = await searchParams;
  const code = typeof params.code === "string" ? params.code.replace(/\D/g, "").slice(0, 6) : "";
  let session = null;
  let error = "";
  if (code) {
    const incoming = await headers();
    const response = await fetch(`${apiUrl}/v1/support/join/${code}`, {
      headers: { "x-forwarded-for": incoming.get("x-forwarded-for") || "" },
      cache: "no-store",
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) session = body;
    else error = body.error || "That code is not valid.";
  }

  return (
    <main className="join">
      <div className="join-card">
        <div className="join-brand"><div className="brand-plate"><Wordmark /></div></div>
        {session ? (
          <>
            <h1>{session.technician ? `${session.technician} is ready to help` : "Your technician is ready to help"}</h1>
            <p className="join-org">{session.org}{session.topic ? ` · ${session.topic}` : ""}</p>
            <ol className="join-steps">
              <li>
                <b>1</b>
                <div>
                  <strong>Download the support app</strong>
                  <a className="join-download" href={`/join/download?code=${code}`}>Download DigitalFingersQuickSupport.exe</a>
                </div>
              </li>
              <li>
                <b>2</b>
                <div>
                  <strong>Run it</strong>
                  <span>Open the file from your Downloads. If Windows asks, click More info and then Run anyway. No admin rights are needed.</span>
                </div>
              </li>
              <li>
                <b>3</b>
                <div>
                  <strong>Click Allow</strong>
                  <span>When your technician connects, Windows asks if you want to let them in. You can end the session at any time.</span>
                </div>
              </li>
            </ol>
            <p className="join-note">The app only works for this session. It closes and removes itself when the session ends. Windows only for now.</p>
          </>
        ) : (
          <>
            <h1>Join a support session</h1>
            <p className="join-org">Enter the 6-digit code your technician gave you.</p>
            <form className="join-form" action="/join" method="get">
              <input
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{3}\s?\d{3}"
                maxLength={7}
                placeholder="123 456"
                defaultValue={code}
                aria-label="Support code"
                required
                autoFocus
              />
              <button type="submit">Continue</button>
            </form>
            {error ? <p className="join-error">{error}</p> : null}
          </>
        )}
      </div>
    </main>
  );
}
