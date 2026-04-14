import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests-e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: `file://${new URL('./', import.meta.url).pathname}`,
    launchOptions: {
      args: ['--autoplay-policy=no-user-gesture-required']
    }
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } }
  ]
});
