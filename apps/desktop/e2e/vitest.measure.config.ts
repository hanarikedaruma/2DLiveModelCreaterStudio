import { defineConfig } from 'vitest/config';

// 計測とストレステスト（カード25）。ふだんの pnpm test・pnpm e2e には入れない
export default defineConfig({
  test: {
    include: ['e2e/**/*.measure.ts'],
    environment: 'node',
    testTimeout: 7_500_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
