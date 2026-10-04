import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// 比べ合わせの見本（reference.webgl.ts）をブラウザで作る設定。@app/render のピクセルのテストと同じく、
// 入っている Microsoft Edge をヘッドレスで使う（Playwright のブラウザはダウンロードしない）。
//   pnpm --filter @app/desktop exec vitest run --config src/output/spout/compare/vitest.webgl.config.ts
// ふつうのテスト（jsdom）には入らない（ファイル名が *.test.ts でない）
const gpuArgs =
  process.env.RENDER_TEST_GPU === 'swiftshader'
    ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    : ['--enable-unsafe-swiftshader'];
// launch は @vitest/browser/providers/playwright が足す項目（apps/desktop からはその型が見えないので、変数にしてから渡す）
const edge = { browser: 'chromium' as const, launch: { channel: 'msedge', args: gpuArgs } };

export default defineConfig({
  root: fileURLToPath(new URL('../../../../', import.meta.url)), // apps/desktop
  optimizeDeps: { include: ['@app/contracts > @app/schema > zod'] },
  test: {
    include: ['src/output/spout/compare/reference.webgl.ts'],
    testTimeout: 120_000,
    browser: {
      enabled: true,
      provider: 'playwright',
      headless: true,
      screenshotFailures: false,
      instances: [edge],
    },
  },
});
