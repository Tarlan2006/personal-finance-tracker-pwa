import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['worker/test/**/*.test.ts'], testTimeout: 20000, pool: 'forks' } });
