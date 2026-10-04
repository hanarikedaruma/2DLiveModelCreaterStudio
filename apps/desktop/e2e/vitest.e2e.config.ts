import { defineConfig } from 'vitest/config';

// 通しのテストだけを動かす（ふだんの pnpm test には入れない）
export default defineConfig({
  test: {
    include: ['e2e/**/*.e2e.ts'],
    environment: 'node',
    testTimeout: 180_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
