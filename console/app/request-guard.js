export function fromConsole(request, { navigation = false } = {}) {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin" || (navigation && site === "none");
  const origin = request.headers.get("origin");
  if (!origin) return navigation;
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}

export function refused() {
  return Response.json({ error: "This request is not allowed." }, { status: 403 });
}
