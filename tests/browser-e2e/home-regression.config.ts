import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../..');
const webRoot = repoRoot;
const nextCli = path.join(webRoot, 'node_modules', 'next', 'dist', 'bin', 'next');
const apiRoot = process.env.LAWSENSE_API_ROOT ?? path.resolve(repoRoot, '..', '..', 'apps', 'api');
const apiPython = process.env.LAWSENSE_PYTHON
  ?? path.join(apiRoot, '.venv', 'Scripts', 'python.exe');
const inheritedEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(([, value]) => typeof value === 'string'),
) as Record<string, string>;
const webPort = process.env.LAWSENSE_E2E_WEB_PORT ?? '3012';
const webUrl = `http://127.0.0.1:${webPort}`;

export default defineConfig({
  testDir: './specs',
  testMatch: 'home-intake-regression.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: webUrl,
    viewport: { width: 1365, height: 900 },
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: `"${apiPython}" isolated_api.py`,
      cwd: __dirname,
      env: {
        ...inheritedEnvironment,
        LAWSENSE_API_ROOT: apiRoot,
      },
      url: 'http://127.0.0.1:8001/health',
      reuseExistingServer: false,
      timeout: 30_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: `"${process.execPath}" "${nextCli}" dev --hostname 127.0.0.1 --port ${webPort}`,
      cwd: webRoot,
      env: {
        ...inheritedEnvironment,
        NEXT_PUBLIC_API_URL: 'http://127.0.0.1:8001',
        LAWSENSE_E2E_NEXT_DIST_DIR: '.next-e2e-home',
      },
      url: webUrl,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
