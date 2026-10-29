import {defineConfig, devices} from '@playwright/test';
export default defineConfig({
  testDir: './e2e', fullyParallel: true,
  use: {baseURL: 'http://127.0.0.1:4178', trace: 'retain-on-failure'},
  projects: [{name: 'desktop', use: {...devices['Desktop Chrome']}}, {name: 'mobile', use: {...devices['Pixel 7']}}],
  webServer: {command: 'npm run dev -- --host 127.0.0.1 --port 4178 --strictPort', url: 'http://127.0.0.1:4178', reuseExistingServer: !process.env.CI},
});
