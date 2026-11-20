import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: 'http://127.0.0.1:7440',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm run start:e2e',
    url: 'http://127.0.0.1:7440/api/health',
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        'postgresql:///spatial_agent_studio_test?host=/var/run/postgresql',
      PORT: '7440',
      APP_ORIGIN: 'http://127.0.0.1:7440',
      COOKIE_SECURE: 'false',
      NODE_ENV: 'test',
      SESSION_TTL_HOURS: '8',
    },
  },
});
