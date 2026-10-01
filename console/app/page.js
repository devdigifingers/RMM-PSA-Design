import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { login } from "./actions";

export default async function LoginPage({ searchParams }) {
  const jar = await cookies();
  if (jar.get("df_session")?.value) redirect("/devices");
  const params = await searchParams;
  const invalid = params?.error === "invalid";

  return (
    <main className="login-shell">
      <section className="login-card">
        <img className="wordmark" src="/brand/wordmark-silver.png" alt="Digital Fingers" />
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
