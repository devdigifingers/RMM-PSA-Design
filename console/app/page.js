import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { login } from "./actions";
import { Wordmark } from "./mark";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";

export default async function LoginPage({ searchParams }) {
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (token) {
    const session = await fetch(`${apiUrl}/v1/account`, {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (session.ok) {
      const account = await session.json();
      redirect(account.user?.isPlatformAdmin ? "/control" : "/devices");
    }
  }
  const params = await searchParams;
  const invalid = params?.error === "invalid";

  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="login-brand">
          <div className="brand-plate">
            <Wordmark tagline />
          </div>
        </div>
        <p className="lede">Remote Monitoring and Management</p>
        <form action={login}>
          <label>
            Email
            <input name="email" type="email" autoComplete="username" required />
          </label>
          <label>
            Password
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
          <button type="submit">Log on</button>
        </form>
        {invalid ? <p className="error">That email or password is not valid.</p> : null}
      </section>
    </main>
  );
}
