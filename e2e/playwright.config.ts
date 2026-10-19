import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
const projectRoot = path.resolve(__dirname, '..');

const backendEnv = {
  ...process.env,
  DATABASE_URL: process.env.E2E_DATABASE_URL || '',
  LLM_PROVIDER: process.env.E2E_LLM_PROVIDER || 'ollama',
  LLM_MODEL: process.env.E2E_LLM_MODEL || process.env.LLM_MODEL || 'llama3.2:latest',
  LLM_BASE_URL: process.env.E2E_LLM_BASE_URL || process.env.LLM_BASE_URL || 'http://127.0.0.1:11434',
  AUTH_LOGIN_MAX_ATTEMPTS: process.env.E2E_AUTH_LOGIN_MAX_ATTEMPTS || '100',
  FRONTEND_ORIGINS: 'http://localhost:3000',
};

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  outputDir: 'test-results/artifacts',
  globalSetup: require.resolve('./global-setup'),
  globalTeardown: require.resolve('./global-teardown'),
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e-report.json' }]],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testIgnore: '**/mobile-excluded.spec.ts' },
  ],
  webServer: [
    {
      command: 'npm.cmd run dev',
      cwd: projectRoot,
      url: 'http://localhost:4000/health',
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 30000,
      env: backendEnv,
    },
    {
      command: 'npm.cmd run dev',
      cwd: path.join(projectRoot, 'frontend'),
      url: 'http://localhost:3000',
      reuseExistingServer: true,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 30000,
      env: { ...process.env, VITE_API_BASE_URL: 'http://localhost:4000' },
    },
  ],
});
