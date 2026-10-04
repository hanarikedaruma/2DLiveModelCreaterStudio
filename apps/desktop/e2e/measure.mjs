// 計測（カード25）: VITE_E2E=1 でデバッグビルド → 計測を動かす。
// `pnpm measure`（両方）・`pnpm measure -- studio`・`pnpm measure -- stress`。ビルドを飛ばすときは --no-build を足す。
// 秒数や GPU は環境変数 MEASURE_SECONDS・MEASURE_GPU（low / high）・MEASURE_LABEL・MEASURE_OBS で変える（e2e/studio.measure.ts を参照）
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const run = (command, env = {}) => execSync(command, { stdio: 'inherit', env: { ...process.env, ...env } });
const args = process.argv.slice(2).filter((a) => a !== '--no-build' && a !== '--');

if (!existsSync('../../fixtures/stress/stress-4000x6000-100.psd') && (args.length === 0 || args.includes('stress'))) {
  run('pnpm --filter @app/fixtures generate:stress');
}
if (!process.argv.includes('--no-build')) run('pnpm tauri build --debug --no-bundle', { VITE_E2E: '1' });
run(`pnpm exec vitest run --config e2e/vitest.measure.config.ts ${args.join(' ')}`);
