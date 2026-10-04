import { defineConfig } from 'vitest/config';

// ふつうのテスト（*.test.ts。node）と、ピクセルのテスト（*.browser.test.ts。Vitest のブラウザモードで、
// 入っている Microsoft Edge をヘッドレスで使う。Playwright のブラウザはダウンロードしない）。
// GPU が無い環境（CI）でも動くように SwiftShader への切り替えを許す。
// RENDER_TEST_GPU=swiftshader で、GPU を使わないソフトウェアの描画に固定して試せる
const gpuArgs =
  process.env.RENDER_TEST_GPU === 'swiftshader'
    ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    : ['--enable-unsafe-swiftshader'];

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.browser.test.ts'],
          environment: 'node',
        },
      },
      {
        // テストの途中で依存の事前バンドルが走ると Vite がページを読み直すので、先に入れておく
        optimizeDeps: { include: ['@app/contracts > @app/schema > zod'] },
        test: {
          name: 'browser',
          include: ['src/**/*.browser.test.ts'],
          testTimeout: 30_000,
          browser: {
            enabled: true,
            provider: 'playwright',
            headless: true,
            screenshotFailures: false,
            instances: [{ browser: 'chromium', launch: { channel: 'msedge', args: gpuArgs } }],
          },
        },
      },
    ],
  },
});
