// AT-04 の確認ページのビルド設定。apps/desktop の Vite で動かす。製品のビルドには登録しない。
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');

export default {
  root: here,
  base: './',
  resolve: { alias: { '@app/tracking/src': resolve(root, 'packages/tracking/src') } },
  worker: { format: 'es' },
  build: {
    outDir: resolve(root, '.cache/arm-tracking/at04-dist'),
    emptyOutDir: true,
    target: 'es2022',
    assetsInlineLimit: 0,
  },
  logLevel: 'warn',
};
