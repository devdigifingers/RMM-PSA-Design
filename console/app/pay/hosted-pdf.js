const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";
const TOKEN = /^[A-Za-z0-9_-]{20,40}$/;

export async function hostedPdf(request, pathKind, token) {
  if (!TOKEN.test(token)) return new Response("Not found.", { status: 404 });
  const upstream = await fetch(`${apiUrl}/v1/public/billing/${pathKind}/${token}/pdf`, {
    headers: { "x-forwarded-for": request.headers.get("x-forwarded-for") || "", "user-agent": request.headers.get("user-agent") || "" },
    cache: "no-store",
  });
  if (!upstream.ok) return Response.redirect(new URL(`/link-expired?k=${pathKind}&t=${token}`, request.url), 303);
  const disposition = upstream.headers.get("content-disposition") || "attachment";
  const inline = new URL(request.url).searchParams.get("inline") === "1";
  return new Response(upstream.body, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": inline ? disposition.replace(/^attachment/, "inline") : disposition,
      "cache-control": "private, no-store",
      "referrer-policy": "no-referrer",
    },
  });
}

export async function hostedDecision(request, token) {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return Response.json({ error: "This request is not allowed." }, { status: 403 });
  if (!TOKEN.test(token)) return Response.json({ error: "Not found." }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const decision = body.decision === "accept" ? "accept" : body.decision === "decline" ? "decline" : null;
  if (!decision) return Response.json({ error: "Choose accept or decline." }, { status: 400 });
  const upstream = await fetch(`${apiUrl}/v1/public/billing/q/${token}/${decision}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": request.headers.get("x-forwarded-for") || "", "user-agent": request.headers.get("user-agent") || "" },
    body: JSON.stringify({ name: String(body.name || "").slice(0, 120) }),
    cache: "no-store",
  });
  const data = await upstream.json().catch(() => ({}));
  return Response.json(data, { status: upstream.status });
}
