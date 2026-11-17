import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/ai-e2e",
  outputDir: ".local/test-results-ai",
  workers: 1,
  timeout: 40000,
  use: {
    baseURL: "http://127.0.0.1:5176",
    channel: process.env.PW_CHANNEL || undefined,
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "python scripts/e2e_ai_api.py",
      url: "http://127.0.0.1:8013/api/health",
      reuseExistingServer: false,
      timeout: 60000,
    },
    {
      command:
        "node node_modules/vite/bin/vite.js apps/web --config apps/web/vite.config.ts --host 127.0.0.1 --port 5176 --strictPort",
      url: "http://127.0.0.1:5176",
      reuseExistingServer: false,
      env: { WORKTRACKER_API: "http://127.0.0.1:8013" },
    },
  ],
});
