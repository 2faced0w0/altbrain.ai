import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/auth-e2e",
  outputDir: ".local/test-results-auth",
  globalTeardown: "./tests/auth-e2e/teardown.ts",
  workers: 1,
  timeout: 90000,
  use: {
    baseURL: "http://127.0.0.1:5175",
    channel: process.env.PW_CHANNEL || undefined,
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "python scripts/e2e_auth_api.py",
      url: "http://127.0.0.1:8012/api/health",
      reuseExistingServer: false,
      timeout: 60000,
    },
    {
      command:
        "node node_modules/vite/bin/vite.js apps/web --config apps/web/vite.config.ts --host 127.0.0.1 --port 5175 --strictPort",
      url: "http://127.0.0.1:5175",
      reuseExistingServer: false,
      env: { WORKTRACKER_API: "http://127.0.0.1:8012" },
    },
  ],
});
