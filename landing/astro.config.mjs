// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";

// Static output: every page is HTML on disk at build time, so there is no server
// at runtime and no request-time env for a secret to leak into. Cloudflare serves
// the ./dist directory as static assets (see wrangler.jsonc).
export default defineConfig({
  site: "https://dishylink.com",
  output: "static",
  integrations: [sitemap()],
  vite: { plugins: [tailwindcss()] },
});
