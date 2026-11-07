import { defineConfig } from "playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  // Each spec gets its own isolated Electron process — no shared state between tests.
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
});
