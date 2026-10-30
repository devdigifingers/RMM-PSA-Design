import { Wordmark } from "../../mark";
import { InviteForm } from "./invite-form";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";

export const metadata = { title: "Accept your invite" };

const STATE_TEXT = {
  expired: "This invite has expired. Ask your admin to send a new one.",
  used: "This invite was already used. Sign in with your email and password.",
};

export default async function InvitePage({ params }) {
  const { token } = await params;
  const safe = /^[A-Za-z0-9_-]{40,60}$/.test(String(token || "")) ? token : "";
  let invite = null;
  if (safe) {
    const response = await fetch(`${apiUrl}/v1/invites/${safe}`, { cache: "no-store" });
    if (response.ok) invite = await response.json();
  }

  return (
    <main className="join">
      <div className="join-card">
        <div className="join-brand"><Wordmark surface="auto" /></div>
        {!invite ? (
          <>
            <h1>Invite not found</h1>
            <p className="join-org">This invite link is not valid. Check that you copied the whole link, or ask your admin for a new one.</p>
          </>
        ) : invite.state !== "open" ? (
          <>
            <h1>{invite.orgName}</h1>
            <p className="join-org">{STATE_TEXT[invite.state]}</p>
            <p><a href="/">Go to sign in</a></p>
          </>
        ) : (
          <>
            <h1>Join {invite.orgName}</h1>
            <p className="join-org">Set a password for {invite.email} to finish setting up your login.</p>
            <InviteForm token={safe} name={invite.name} />
          </>
        )}
      </div>
    </main>
  );
}
