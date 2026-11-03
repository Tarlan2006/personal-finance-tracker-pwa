import { defineConfig } from '@playwright/test';

// WebKit checks the engine; neither Windows WebKit nor mobile Chromium is physical iOS Safari.
const iphone = (name: string, w: number, h: number, scheme: 'dark' | 'light', browserName:'chromium'|'webkit'='chromium') => ({
  name,
  use: { browserName, launchOptions:browserName==='chromium'&&process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}, viewport: { width: w, height: h }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: scheme,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' } as any,
});
export default defineConfig({
  testDir: 'tests-e2e', timeout: 60_000, workers: 1, fullyParallel: false, reporter: [['list']],
  use: { locale: 'ru-RU', baseURL: 'http://localhost:8799', trace: 'off' },
  projects: [iphone('iPhone15Pro-dark', 393, 852, 'dark'), iphone('iPhone17Pro-light', 402, 874, 'light'),iphone('webkit-iPhone-dark',393,852,'dark','webkit'),iphone('webkit-iPhone-light',402,874,'light','webkit')],
  webServer: { command: 'npx tsx scripts/dev-server.ts', url: 'http://localhost:8799/api/health', reuseExistingServer: false, timeout: 60_000,
    env: { PORT: '8799', SEED_ACCOUNT: 'owner:e2e-test-password-1', SEED_ACCOUNTS:'zz-crash:e2e-crash-password-1,zz-crash-other:e2e-crash-password-1,zz-safari:e2e-safari-password-1,zz-history:e2e-history-password-1' } },
});
