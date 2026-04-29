import { defineConfig, devices } from '@playwright/test';

const baseURL = `file://${new URL('./', import.meta.url).pathname}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  reporter: 'list',
  use: { baseURL },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Chromium-only flag — bypasses the autoplay gesture requirement so
        // tests that synthesize audio don't have to fight the browser policy.
        launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] }
      },
      testIgnore: '**/mobile.spec.js'
    },
    {
      name: 'webkit-mobile',
      // Mobile UI is exercised under WebKit (iOS Safari engine) since that's
      // the actual runtime; iPhone 17 Pro device params are set in the spec.
      use: { defaultBrowserType: 'webkit' },
      testMatch: '**/mobile.spec.js'
    }
  ]
});
