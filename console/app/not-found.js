import { Logo } from "./mark";

export const metadata = { title: "Page not found · Digital Fingers RMM" };

export default function NotFound() {
  return (
    <main className="login-shell">
      <section className="login-card status-card">
        <div className="login-brand">
          <Logo className="status-logo" height={46} />
        </div>
        <h1>Page not found</h1>
        <p className="lede">That page does not exist or has moved.</p>
        <p className="status-actions"><a className="status-home" href="/">Go to the console</a></p>
      </section>
    </main>
  );
}
