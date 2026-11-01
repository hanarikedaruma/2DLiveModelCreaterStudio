// AT-13 CO：専用identifierとWebView2プロファイルのアプリで通し試験。本番アプリは置き換えない。
import { spawn, execFileSync } from 'node:child_process';
import { copyFile, mkdir, open, readFile, unlink, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
const root = resolve(import.meta.dirname, '../../..'),
  desktop = resolve(root, 'apps/desktop');
const lock = resolve(root, '.cache/locks/main.lock'),
  token = randomUUID();
await mkdir(resolve(root, '.cache/locks'), { recursive: true });
const handle = await open(lock, 'wx');
await handle.writeFile(
  JSON.stringify({ owner: 'CO', card: 'AT-12/13 native regression', startedAt: new Date().toISOString(), token }),
);
await handle.close();
const env = {
  ...process.env,
  PATH: `${resolve(root, '.cache/bin')};${join(process.env.USERPROFILE, '.cargo/bin')};${process.env.PATH}`,
  COREPACK_HOME: resolve(root, '.cache/corepack'),
  CARGO_NET_OFFLINE: 'true',
};
const cli = resolve(desktop, 'node_modules/@tauri-apps/cli/tauri.js');
const config = {
  identifier: 'jp.co.globalsystems.live2dstudio.arm-verification-20261101',
  build: { beforeBuildCommand: null },
};
const profile = resolve(root, '.cache/arm-tracking/at13-webview-profile');
const evidence = resolve(root, 'docs/arm-tracking/evidence/AT-13');
const executable = resolve(root, '.cache/arm-tracking/at13-app/live2d-studio.exe');
const reuse = process.argv.includes('--reuse');
const filterAt = process.argv.indexOf('--test-name');
const filter = filterAt < 0 ? [] : ['-t', process.argv[filterAt + 1]];
await mkdir(evidence, { recursive: true });
async function run(args, cwd = desktop, extra = {}) {
  console.log(`${new Date().toISOString()} node ${args.map((a) => (a.length > 150 ? '[config]' : a)).join(' ')}`);
  await new Promise((ok, fail) => {
    const child = spawn(process.execPath, args, {
      cwd,
      env: { ...env, ...extra },
      stdio: 'inherit',
      windowsHide: true,
    });
    child.on('error', fail);
    child.on('exit', (code) => (code === 0 ? ok() : fail(new Error(`Command failed: ${code}`))));
  });
}
let isolated = false;
try {
  if (!reuse) {
    // 実行中のデバッグ版は上書きしない。インストール済みの通常アプリには接続しない。
    const running = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-Command', '(Get-Process live2d-studio -ErrorAction SilentlyContinue).Path'],
      { encoding: 'utf8', windowsHide: true },
    )
      .trim()
      .toLowerCase();
    if (running.includes(resolve(desktop, 'src-tauri/target/debug/live2d-studio.exe').toLowerCase()))
      throw new Error('Debug app is running; leave it open and use a separate build directory');
    await run([resolve(desktop, 'node_modules/vite/bin/vite.js'), 'build'], desktop, { VITE_E2E: '1' });
    isolated = true;
    await run([cli, 'build', '--debug', '--no-bundle', '--config', JSON.stringify(config)], desktop, { VITE_E2E: '1' });
    await mkdir(resolve(root, '.cache/arm-tracking/at13-app'), { recursive: true });
    await copyFile(resolve(desktop, 'src-tauri/target/debug/live2d-studio.exe'), executable);
    await writeFile(
      resolve(evidence, 'build.json'),
      JSON.stringify(
        {
          commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
          identifier: config.identifier,
          profile,
          executable,
          sha256: createHash('sha256')
            .update(await readFile(executable))
            .digest('hex'),
          serviceSha256: createHash('sha256')
            .update(await readFile(resolve(desktop, 'src/services/arms/service.ts')))
            .digest('hex'),
        },
        null,
        2,
      ),
    );
  }
  await run(
    [
      resolve(root, 'node_modules/vitest/vitest.mjs'),
      'run',
      'e2e/arm-tracking.at13.e2e.ts',
      '--config',
      'e2e/vitest.e2e.config.ts',
      ...filter,
    ],
    desktop,
    { WEBVIEW2_USER_DATA_FOLDER: profile, STUDIO_E2E_EXE: executable },
  );
} finally {
  try {
    // 検証専用の実行ファイルを通常ビルドの場所に残さない。
    if (isolated) {
      await run([resolve(desktop, 'node_modules/vite/bin/vite.js'), 'build'], desktop, { VITE_E2E: '' });
      await run(
        [cli, 'build', '--debug', '--no-bundle', '--config', JSON.stringify({ build: { beforeBuildCommand: null } })],
        desktop,
        { VITE_E2E: '' },
      );
    }
  } finally {
    if ((await readFile(lock, 'utf8').catch(() => '')).includes(token)) await unlink(lock);
  }
}
