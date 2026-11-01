// COの独立確認専用。製品のビルド・実機計測には使わない。
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '@app/tracking/src': fileURLToPath(new URL('../../../packages/tracking/src', import.meta.url)) },
  },
  test: { include: ['prototypes/arm-tracking/inference/src/*.at01.test.ts'], environment: 'node' },
});
