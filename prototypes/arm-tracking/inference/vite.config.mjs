// AT-01 の試作のビルド設定。apps/desktop の Vite で動かす（このフォルダに依存を入れない）。
// node apps/desktop/node_modules/vite/bin/vite.js build --config prototypes/arm-tracking/inference/vite.config.mjs
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');

export default {
  root: here,
  base: './',
  // モデルはリポジトリに入れず .cache から配る（README の取得手順）
  publicDir: resolve(root, '.cache/arm-tracking/models'),
  resolve: {
    alias: {
      // 顔は製品と同じ関数で推定する（このフォルダは pnpm のワークスペースの外なので別名で指す）
      '@app/tracking/src': resolve(root, 'packages/tracking/src'),
      '@mediapipe/tasks-vision': resolve(
        root,
        'packages/tracking/node_modules/@mediapipe/tasks-vision/vision_bundle.mjs',
      ),
    },
  },
  worker: { format: 'es' },
  build: {
    outDir: resolve(root, '.cache/arm-tracking/inference-dist'),
    emptyOutDir: true,
    target: 'es2022',
    assetsInlineLimit: 0,
    sourcemap: true,
  },
  logLevel: 'warn',
};
