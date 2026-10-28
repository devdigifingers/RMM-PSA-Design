"use client";

/* eslint-disable @next/next/no-img-element */
export default function GlobalError({ reset }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", padding: "32px 16px", boxSizing: "border-box", background: "linear-gradient(160deg, #141b3a, #1f1d52 55%, #2e1f6e)", color: "#e8eef5", fontFamily: "system-ui, sans-serif", textAlign: "center" }}>
        <main>
          <img src="/brand/logo-horizontal-dark.svg?v=c1" alt="Digital Fingers" width={200} height={46} />
          <h1 style={{ margin: "24px 0 8px", fontSize: 22 }}>Something went wrong</h1>
          <p style={{ margin: "0 0 20px", color: "#c7cbe6" }}>The console could not be loaded.</p>
          <button type="button" onClick={() => reset()} style={{ padding: "10px 22px", border: 0, borderRadius: 999, background: "#7c3aed", color: "#fff", font: "inherit", fontWeight: 600, cursor: "pointer" }}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
