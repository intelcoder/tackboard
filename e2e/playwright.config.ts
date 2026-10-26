import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  workers: 4,
  retries: 0,
  forbidOnly: true,
  timeout: 45000,
  projects: [{ name: "chromium", use: { browserName: "chromium", viewport: { width: 1280, height: 800 } } }],
});
