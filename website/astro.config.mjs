import { defineConfig } from "astro/config";

// DF_BASE=/preview builds the password-protected preview that Caddy serves under /preview/ on the apex.
const base = process.env.DF_BASE || "/";

export default defineConfig({
  site: "https://digitalfingers.co.za",
  base,
  trailingSlash: "always",
  build: { format: "directory", inlineStylesheets: "auto" },
  compressHTML: true,
  devToolbar: { enabled: false },
});
