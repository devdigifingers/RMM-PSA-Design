import { Logo } from "./mark";

export const metadata = { title: "Not included · Digital Fingers RMM" };

export default function Forbidden() {
  return (
    <main className="login-shell">
      <section className="login-card status-card">
        <div className="login-brand">
          <Logo className="status-logo" height={46} />
        </div>
        <h1>Not included in your package</h1>
        <p className="lede">This part of the console is not on your organisation&apos;s package, or the license is not active. Ask your administrator about adding it.</p>
        <p className="status-actions"><a className="status-home" href="/">Go to the console</a></p>
      </section>
    </main>
  );
}
