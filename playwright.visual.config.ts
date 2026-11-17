import { defineConfig } from "@playwright/test";

// Visual baselines for design work. Never part of `npm run test:e2e`.
// Usage: VISUAL_LABEL=before npm run test:visual
export default defineConfig({
  testDir: "tests/visual",
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  use: {
    baseURL: "http://127.0.0.1:5174",
    channel: process.env.PW_CHANNEL || undefined,
    timezoneId: "America/Los_Angeles",
    locale: "en-US",
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  },
  webServer: [
    {
      command: "python scripts/e2e_api.py",
      url: "http://127.0.0.1:8011/api/health",
      reuseExistingServer: false,
      timeout: 60000,
    },
    {
      command:
        "node node_modules/vite/bin/vite.js apps/web --config apps/web/vite.config.ts --host 127.0.0.1 --port 5174 --strictPort",
      url: "http://127.0.0.1:5174",
      env: { WORKTRACKER_API: "http://127.0.0.1:8011" },
      reuseExistingServer: false,
      timeout: 60000,
    },
  ],
});
