const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";

export async function GET(request) {
  const code = (new URL(request.url).searchParams.get("code") || "").replace(/\D/g, "").slice(0, 6);
  if (code.length !== 6) return Response.redirect(new URL("/join", request.url), 303);
  const response = await fetch(`${apiUrl}/v1/support/join/${code}/download`, {
    headers: { "x-forwarded-for": request.headers.get("x-forwarded-for") || "" },
    cache: "no-store",
  });
  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => ({}));
    return new Response(body.error || "The support app is not available.", {
      status: response.status === 200 ? 502 : response.status,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  const headers = new Headers({
    "content-type": "application/octet-stream",
    "content-disposition": 'attachment; filename="DigitalFingersQuickSupport.exe"',
    "cache-control": "no-store",
  });
  const length = response.headers.get("content-length");
  if (length) headers.set("content-length", length);
  return new Response(response.body, { headers });
}
