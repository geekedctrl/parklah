import {defineConfig,devices} from '@playwright/test';

const baseURL=process.env.PLAYWRIGHT_BASE_URL??'http://127.0.0.1:4173';

export default defineConfig({
  testDir:'./e2e',
  fullyParallel:false,
  reporter:'list',
  use:{baseURL,...devices['Desktop Chrome'],trace:'retain-on-failure'},
  webServer:{command:'npm run dev -- --host 127.0.0.1 --port 4173',url:baseURL,reuseExistingServer:!process.env.CI,timeout:60_000},
});
