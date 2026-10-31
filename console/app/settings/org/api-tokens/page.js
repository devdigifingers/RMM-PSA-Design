import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { ConsoleBar } from "../../../bar";
import { SettingsCrumb } from "../../../settings-home";
import { accountFromSession, navFlags } from "../../../account-data";
import { revokeApiToken } from "../../../actions";
import { TokenForm } from "./token-form";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";
const STATE_LABEL = { active: "Active", expired: "Expired", revoked: "Revoked" };

function when(value) {
  if (!value) return "Never";
  return new Date(value).toLocaleString("en-ZA", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Johannesburg" });
}

export default async function ApiTokensPage({ searchParams }) {
  const account = await accountFromSession();
  if (!account) redirect("/");
  if (account.user.isPlatformAdmin) redirect("/control");
  const params = await searchParams;
  const jar = await cookies();
  const response = await fetch(`${apiUrl}/v1/org/api-tokens`, {
    headers: {
      authorization: `Bearer ${jar.get("df_session")?.value}`,
      "x-forwarded-for": (await headers()).get("x-forwarded-for") || "",
    },
    cache: "no-store",
  });
  if (response.status === 401) redirect("/");
  const data = response.ok ? await response.json() : null;

  return (
    <div className="console">
      <ConsoleBar {...navFlags(account)} />
      <main className="main settings-page">
        <SettingsCrumb href="/settings/org/api-tokens" />
        <h1>API tokens</h1>
        <p className="org-name">
          Let your own scripts and tools run commands on chosen devices without signing in. Each token only works for the
          devices you pick, expires on the date you choose, and can be limited to your servers&apos; IP addresses.
        </p>
        {params?.saved === "revoked" ? <p className="saved" role="status">The token was revoked and stops working immediately.</p> : null}
        {params?.error ? <p className="error" role="alert">{params.error}</p> : null}
        {!data ? (
          <p className="error">Only an owner or admin can manage API tokens.</p>
        ) : (
          <>
            <section className="mfa-card">
              <h2>New token</h2>
              {data.canCreate ? (
                <TokenForm devices={data.devices} yourAddress={data.yourAddress} />
              ) : (
                <p className="org-name">
                  Turn on <a href="/settings/org/mfa">multi-factor authentication</a> for your account first. Tokens can run
                  commands on devices, so only owners and admins with MFA can create them.
                </p>
              )}
            </section>

            <section className="mfa-card">
              <h2>Tokens</h2>
              {data.tokens.length === 0 ? (
                <p className="org-name">No tokens yet.</p>
              ) : (
                <div className="tech-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Devices</th>
                        <th>Limits</th>
                        <th>Last used</th>
                        <th>Expires</th>
                        <th>Status</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {data.tokens.map((token) => (
                        <tr key={token.id}>
                          <td className="tech-name">
                            {token.name}
                            <span className="token-hint">{token.hint}</span>
                            {token.createdBy ? <span className="token-by">Created by {token.createdBy}, {when(token.createdAt)}</span> : null}
                          </td>
                          <td>{token.devices.map((device) => device.name).join(", ") || "None left"}</td>
                          <td>{token.allowedIps.length ? token.allowedIps.join(", ") : "Any address"}</td>
                          <td className="tech-nowrap">
                            {when(token.lastUsedAt)}
                            {token.lastUsedFrom ? <span className="token-by">from {token.lastUsedFrom}</span> : null}
                          </td>
                          <td className="tech-nowrap">{when(token.expiresAt)}</td>
                          <td className="tech-nowrap">
                            <span className={`tech-state ${token.state === "active" ? "on" : "off"}`}>{STATE_LABEL[token.state]}</span>
                          </td>
                          <td className="tech-nowrap">
                            {token.state === "active" ? (
                              <form action={revokeApiToken} className="tech-inline">
                                <input type="hidden" name="tokenId" value={token.id} />
                                <button type="submit" className="link-button">Revoke</button>
                              </form>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="mfa-card">
              <h2>Using a token</h2>
              <p className="org-name">Send the token in the Authorization header. Commands run on the device the same way as the Run command box, and their results can be read back. PowerShell example:</p>
              <pre className="token-example">{`$h = @{ Authorization = "Bearer dfk_your_token" }
$api = "https://api.digitalfingers.co.za/v1/token"

# Devices this token may use
Invoke-RestMethod "$api/devices" -Headers $h

# Run a command on device 6, then read the result
$job = Invoke-RestMethod "$api/devices/6/jobs" -Method Post -Headers $h -ContentType "application/json" -Body '{"command":"ipconfig /all"}'
Invoke-RestMethod "$api/jobs/$($job.id)" -Headers $h

# Run a multi-line PowerShell script (Windows, agent 1.6.1 or newer)
$body = @{ script = Get-Content .\\setup.ps1 -Raw } | ConvertTo-Json
$job = Invoke-RestMethod "$api/devices/6/jobs" -Method Post -Headers $h -ContentType "application/json" -Body $body`}</pre>
              <p className="org-name">
                A job&apos;s status goes from <code>queued</code> to <code>running</code> to <code>finished</code>; the exit code says
                whether it worked. A <code>command</code> is one line of up to 8,000 characters, runs in cmd.exe as SYSTEM and is
                stopped after 20 seconds; call PowerShell as <code>powershell -NoProfile -Command &quot;…&quot;</code> with single
                quotes inside. A <code>script</code> is PowerShell of up to 64 KB, may span many lines, runs as SYSTEM and is
                stopped after 5 minutes. Output is kept up to 8,000 characters.
              </p>
              <p className="org-name">
                At most 60 requests a minute per token. Every command is in the audit log with the token&apos;s name. A token stops
                working when it is revoked or expires, or when the person who created it is no longer an owner or admin.
              </p>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
