// End-to-end tests: the built extension (dist/chrome) in a real Chromium, over local fixture sites.
// `npm run build` first, then `npm run test:e2e`. Locally the browser is shown, so the run can be
// watched (E2E_SLOWMO=300 slows each step down); CI runs the same under xvfb-run.
// E2E_HEADLESS=1 hides it, in Chromium's new headless mode, which still runs extensions.
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '*.spec.ts',
  outputDir: 'test-results',
  // One browser at a time: each test launches its own, and a headed run is meant to be watched
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['list'], ['github'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  projects: [
    {
      name: 'chromium',
      use: {
        // The persistent context with the extension loaded is made by tests/e2e/kemlock.ts, which
        // keeps a trace of each test and attaches it when the test fails
        headless: process.env.E2E_HEADLESS === '1',
        launchOptions: { slowMo: Number(process.env.E2E_SLOWMO ?? 0) },
      },
    },
  ],
})
