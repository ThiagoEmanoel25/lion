import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173';
const managed = !process.env.E2E_BASE_URL; // sem E2E_BASE_URL, sobe API + web (build) localmente

export default defineConfig({
  testDir: './e2e',
  outputDir: 'e2e/results',
  reporter: [['list'], ['html', { outputFolder: 'e2e/report', open: 'never' }]],
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL,
    screenshot: 'on',          // print de cada teste, passando ou falhando
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: managed
    ? [
        { command: 'npm run dev:api', url: 'http://127.0.0.1:3333/health', reuseExistingServer: true, timeout: 120_000 },
        { command: 'npm run build -w @nexo/web && npm exec -w @nexo/web -- vite preview --port 5173 --host 127.0.0.1', url: baseURL, reuseExistingServer: true, timeout: 180_000 },
      ]
    : undefined,
});
