// 通しのテスト（カード23）: PSD を作る → VITE_E2E=1 でデバッグビルド → テストを動かす。
// `pnpm e2e`（ビルドを飛ばすときは `pnpm e2e -- --no-build`）
import { execSync } from 'node:child_process';

const run = (command, env = {}) => execSync(command, { stdio: 'inherit', env: { ...process.env, ...env } });

run('pnpm --filter @app/fixtures generate:psd');
if (!process.argv.includes('--no-build')) run('pnpm tauri build --debug --no-bundle', { VITE_E2E: '1' });
run('pnpm exec vitest run --config e2e/vitest.e2e.config.ts');
