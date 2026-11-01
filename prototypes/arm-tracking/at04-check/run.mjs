// AT-04 の実装者の確認（CL）。main.lock を取り、AT-01 の試作専用の WebView2 の窓（CSP は製品と同じく HTML だけ）で
// 製品の推定元を動かす。仮のカメラ（人物なし）と、PC の外へ出ない設定（存在しないプロキシ・名前解決の失敗）で起動し、
// NetLog を .cache に残す。制作アプリ・ユーザーのブラウザーには接続しない。
//   node prototypes/arm-tracking/at04-check/run.mjs
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const dist = resolve(root, '.cache/arm-tracking/at04-dist');
const hostExe = resolve(root, '.cache/arm-tracking/host-target/release/at01-host.exe');
const lockPath = resolve(root, '.cache/locks/main.lock');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = resolve(root, 'docs/arm-tracking/evidence/AT-04', `fake-${stamp}`);
const netlogPath = resolve(root, '.cache/arm-tracking/netlogs', `at04-${stamp}.json`);
const port = 9342;
const { chromium } = createRequire(resolve(root, 'apps/desktop/package.json'))('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...m) => console.log(new Date().toISOString().slice(11, 19), ...m);

async function acquireLock() {
  await mkdir(dirname(lockPath), { recursive: true });
  const token = randomUUID();
  let handle;
  try {
    handle = await open(lockPath, 'wx');
  } catch {
    throw new Error(`main.lock は使用中: ${await readFile(lockPath, 'utf8').catch(() => '?')}`);
  }
  await handle.writeFile(
    JSON.stringify({ owner: 'CL', card: 'AT-04 check', startedAt: new Date().toISOString(), token }),
  );
  await handle.close();
  return async () => {
    if ((await readFile(lockPath, 'utf8').catch(() => '')).includes(token)) await unlink(lockPath);
  };
}

function webviewMemory() {
  const script = `Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" | Where-Object { $_.CommandLine -like '*arm-tracking*at04-webview2-data*' } | ForEach-Object { $p = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue; if ($p) { $p.PrivateMemorySize64 } }`;
  const text = execFileSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8' });
  return text
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .reduce((sum, v) => sum + Number(v) / 2 ** 20, 0);
}

async function sources() {
  const files = {};
  const base = resolve(root, 'packages/tracking/src/source');
  for (const dir of [base, join(base, 'body')])
    for (const entry of await readdir(dir, { withFileTypes: true }))
      if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts'))
        files[relative(root, join(dir, entry.name)).replace(/\\/g, '/')] = createHash('sha256')
          .update(await readFile(join(dir, entry.name)))
          .digest('hex');
  return files;
}

async function summarizeNetlog() {
  const text = await readFile(netlogPath, 'utf8');
  const hosts = {};
  for (const match of text.matchAll(/"url":"([^"]+)"/g)) {
    try {
      const host = new URL(match[1]).host;
      hosts[host] = (hosts[host] ?? 0) + 1;
    } catch {
      // URL でない
    }
  }
  return { hosts, external: Object.keys(hosts).filter((h) => !['at01.localhost', 'localhost'].includes(h)) };
}

async function main() {
  const release = await acquireLock();
  let host;
  let browser;
  const record = { stamp, sources: await sources(), steps: [], errors: [] };
  try {
    execFileSync(
      process.execPath,
      [
        resolve(root, 'apps/desktop/node_modules/vite/bin/vite.js'),
        'build',
        '--config',
        resolve(here, 'vite.config.mjs'),
      ],
      { cwd: root, stdio: 'inherit' },
    );
    await mkdir(outDir, { recursive: true });
    await mkdir(dirname(netlogPath), { recursive: true });
    const args = [
      `--remote-debugging-port=${port}`,
      '--use-fake-device-for-media-stream=fps=30',
      `--log-net-log=${netlogPath}`,
      '--net-log-capture-mode=Default',
      '--proxy-server=http://127.0.0.1:9',
      '"--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"',
    ];
    record.browserArgs = args;
    host = spawn(
      hostExe,
      [
        '--dist',
        dist,
        '--out',
        outDir,
        '--data',
        resolve(root, '.cache/arm-tracking/at04-webview2-data'),
        '--csp',
        'html',
      ],
      { env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: args.join(' ') }, stdio: 'inherit' },
    );
    for (let i = 0; ; i++) {
      try {
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
        break;
      } catch (error) {
        if (i > 60) throw error;
        await sleep(500);
      }
    }
    const page = browser.contexts()[0].pages()[0];
    page.on('pageerror', (e) => record.errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') record.errors.push(m.text());
    });
    await page.waitForFunction(() => window.__at04 !== undefined, null, { timeout: 30_000 });
    const step = async (name, fn) => {
      log(name);
      const result = await fn();
      record.steps.push({ name, workers: page.workers().length, memoryMB: webviewMemory(), ...result });
      await writeFile(join(outDir, 'run.json'), JSON.stringify(record, null, 1));
    };
    await step('start-normal', async () => ({
      start: await page.evaluate(() => window.__at04.start({ enabled: true, mode: 'normal', hands: true })),
      measure: await page.evaluate(() => window.__at04.measure(5000)),
    }));
    await step('normal-steady', async () => ({ measure: await page.evaluate(() => window.__at04.measure(5000)) }));
    await step('light', async () => ({
      configure: await page.evaluate(() => window.__at04.configure({ enabled: true, mode: 'light', hands: true })),
      measure: await page.evaluate(() => window.__at04.measure(5000)),
    }));
    await step('arms-off', async () => {
      const configure = await page.evaluate(() =>
        window.__at04.configure({ enabled: false, mode: 'normal', hands: true }),
      );
      await sleep(1500);
      return { configure, measure: await page.evaluate(() => window.__at04.measure(3000)) };
    });
    for (let i = 1; i <= 5; i++)
      await step(`toggle-${i}`, async () => {
        await page.evaluate(() => window.__at04.configure({ enabled: true, mode: 'normal', hands: true }));
        await sleep(1000);
        await page.evaluate(() => window.__at04.configure({ enabled: false, mode: 'normal', hands: true }));
        await sleep(1000);
        return {};
      });
    for (let i = 1; i <= 5; i++)
      await step(`camera-restart-${i}`, async () => {
        await page.evaluate(() => window.__at04.stop());
        await sleep(700);
        const start = await page.evaluate(() => window.__at04.start({ enabled: true, mode: 'normal', hands: true }));
        await sleep(1000);
        return { start };
      });
    // 顔の推定器の60秒ごとの送信を含めるため、合わせて約70秒動かしてから止める
    await step('hold-and-stop', async () => {
      await sleep(30_000);
      await page.evaluate(() => window.__at04.stop());
      await sleep(3000);
      return {
        blocked: await page.evaluate(() => window.__at04.blocked()),
        counts: await page.evaluate(() => window.__at04.counts()),
      };
    });
  } finally {
    await browser?.close().catch(() => {});
    if (host && host.exitCode === null) {
      const exited = new Promise((r) => host.once('exit', r));
      host.kill();
      await Promise.race([exited, sleep(5000)]);
    }
    await sleep(2000);
    record.network = await summarizeNetlog().catch((e) => ({ error: String(e) }));
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, 'run.json'), JSON.stringify(record, null, 1));
    try {
      execFileSync(process.execPath, [resolve(root, 'node_modules/prettier/bin/prettier.cjs'), '--write', outDir], {
        cwd: root,
        stdio: 'ignore',
      });
    } catch {
      // 整形できなくても記録は残す
    }
    await release();
    log('保存', relative(root, outDir), JSON.stringify(record.network));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
