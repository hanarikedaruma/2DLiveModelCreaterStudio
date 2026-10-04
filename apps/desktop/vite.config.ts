import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Tauri の開発サーバーは固定ポートで待つ
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  // src-tauri（Rust のビルド結果を含む）は見張らない。ビルド中の実行ファイルを見張ると EBUSY で落ちる
  server: { port: 1420, strictPort: true, watch: { ignored: ['**/src-tauri/**'] } },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: { target: 'es2022', sourcemap: true },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
  },
});
