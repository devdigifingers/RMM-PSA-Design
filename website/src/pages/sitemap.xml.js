import { SITE_URL, PAGES } from "../site.js";

export function GET() {
  const urls = PAGES.map((path) => `  <url><loc>${SITE_URL}${path}</loc></url>`).join("\n");
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  return new Response(body, { headers: { "content-type": "application/xml; charset=utf-8" } });
}
