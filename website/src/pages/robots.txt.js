import { SITE_URL, PREVIEW } from "../site.js";

export function GET() {
  const body = PREVIEW
    ? "User-agent: *\nDisallow: /\n"
    : `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`;
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
