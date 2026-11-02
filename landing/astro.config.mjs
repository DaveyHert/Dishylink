// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";

// Static output: every page is HTML on disk at build time, so no secret can leak
// into a page. The only server code is the /api Worker (worker/index.ts).
export default defineConfig({
  site: "https://dishylink.com",
  output: "static",
  integrations: [sitemap({ filter: (page) => !page.includes("/admin") })],
  vite: { plugins: [tailwindcss()] },
});
