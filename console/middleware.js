import { NextResponse } from "next/server";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";

const NOT_INCLUDED = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Not included · Digital Fingers RMM</title><link rel="icon" href="/favicon.ico">
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0B0B2E;font-family:Inter,system-ui,sans-serif;color:#0F172A;padding:24px;box-sizing:border-box}
main{max-width:460px;background:#fff;border-radius:20px;padding:36px 32px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.35)}
img{height:46px;margin-bottom:18px}h1{font-size:22px;margin:0 0 10px}p{color:#475569;line-height:1.5;margin:0 0 22px}
a{display:inline-block;padding:11px 20px;border-radius:999px;background:#0B0B2E;color:#fff;font-weight:600;text-decoration:none}
</style></head><body><main><img src="/icon.svg" alt="Digital Fingers"><h1>Not included in your package</h1>
<p>Invoicing is not on your organisation's package, or the license is not active. Ask your administrator about adding it.</p>

<a href="/">Go to the console</a></main></body></html>`;

// Pages render the same "Not included" content, but only here can the response carry a real 403.
export async function middleware(request) {
  const token = request.cookies.get("df_session")?.value;
  if (!token || request.nextUrl.pathname.startsWith("/billing/api/")) return NextResponse.next();
  try {
    const response = await fetch(`${apiUrl}/v1/billing/status`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
    if (response.status === 403) {
      const body = await response.json().catch(() => ({}));
      if (body.code === "feature_not_entitled" || body.code === "license_inactive") {
        return new NextResponse(NOT_INCLUDED, { status: 403, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
      }
    }
  } catch {}
  return NextResponse.next();
}

export const config = { matcher: ["/billing", "/billing/:path*"] };
