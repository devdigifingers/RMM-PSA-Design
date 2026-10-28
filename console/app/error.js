"use client";

import { Logo } from "./mark";

export default function ErrorPage({ reset }) {
  return (
    <main className="login-shell">
      <section className="login-card status-card">
        <div className="login-brand">
          <Logo className="status-logo" height={46} />
        </div>
        <h1>Something went wrong</h1>
        <p className="lede">This page could not be loaded. Try again, or go back to the console.</p>
        <p className="status-actions">
          <button type="button" onClick={() => reset()}>Try again</button>
          <a className="status-home" href="/">Go to the console</a>
        </p>
      </section>
    </main>
  );
}
