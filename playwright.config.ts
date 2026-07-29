import { defineConfig, devices } from "@playwright/test";

const webBaseUrl = "http://127.0.0.1:3100";
const adminBaseUrl = "http://127.0.0.1:3101";
const apiBaseUrl = "http://127.0.0.1:4100/v1";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./reports/e2e/artifacts",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ["list"],
    ["html", { outputFolder: "./reports/e2e/html", open: "never" }],
    ["junit", { outputFile: "./reports/e2e/junit.xml" }],
  ],
  use: {
    baseURL: webBaseUrl,
    locale: "zh-CN",
    timezoneId: "America/Los_Angeles",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium-mobile",
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: [
    {
      name: "Web",
      command: "node apps/web/.next/standalone/apps/web/server.js",
      url: `${webBaseUrl}/health/ready`,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "ignore",
      stderr: "pipe",
      env: {
        NODE_ENV: "production",
        NEXT_TELEMETRY_DISABLED: "1",
        HOSTNAME: "127.0.0.1",
        PORT: "3100",
        API_BASE_URL: "http://127.0.0.1:4200/v1",
      },
    },
    {
      name: "Public API fixture",
      command: "node scripts/e2e-public-api-fixture.mjs",
      url: "http://127.0.0.1:4200/health/ready",
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "ignore",
      stderr: "pipe",
      env: {
        NODE_ENV: "test",
        HOSTNAME: "127.0.0.1",
        PORT: "4200",
      },
    },
    {
      name: "Admin",
      command: "node apps/admin/.next/standalone/apps/admin/server.js",
      url: `${adminBaseUrl}/health/ready`,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "ignore",
      stderr: "pipe",
      env: {
        NODE_ENV: "production",
        NEXT_TELEMETRY_DISABLED: "1",
        HOSTNAME: "127.0.0.1",
        PORT: "3101",
        API_BASE_URL: apiBaseUrl,
      },
    },
    {
      name: "API",
      command: "pnpm --filter @socal/api start",
      url: `${apiBaseUrl}/health/ready`,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "ignore",
      stderr: "pipe",
      env: {
        NODE_ENV: "test",
        APP_ENV: "test",
        APP_NAME: "socal-api-e2e",
        PORT: "4100",
        PUBLIC_WEB_URL: webBaseUrl,
        PUBLIC_ADMIN_URL: adminBaseUrl,
        DATABASE_URL: "postgresql://example.invalid/socal",
        REDIS_URL: "redis://127.0.0.1:6379/15",
        OPENSEARCH_NODE: "http://127.0.0.1:9200",
        SESSION_SECRET: "e2e-session-secret-with-at-least-32-bytes",
        OTP_SECRET: "e2e-otp-secret-with-at-least-32-bytes",
        MFA_SECRET: "e2e-mfa-secret-with-at-least-32-bytes",
        PASSWORD_PEPPER: "e2e-password-pepper-with-at-least-32-bytes",
        CSRF_SECRET: "e2e-csrf-secret-with-at-least-32-bytes",
        OTEL_SERVICE_NAME: "socal-api-e2e",
        OTEL_SERVICE_VERSION: "test",
      },
    },
  ],
});
