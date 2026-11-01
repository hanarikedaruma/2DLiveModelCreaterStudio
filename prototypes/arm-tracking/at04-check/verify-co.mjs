// CO独立確認。製品のsourceを同じ検証ページから呼ぶ。専用WebView2・仮カメラのみ。
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const { chromium } = createRequire(resolve(root, 'apps/desktop/package.json'))('playwright');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = resolve(root, 'docs/arm-tracking/evidence/AT-04', `co-${stamp}`);
const lock = resolve(root, '.cache/locks/main.lock');
await mkdir(resolve(root, '.cache/locks'), { recursive: true });
await mkdir(out, { recursive: true });
const token = randomUUID(),
  handle = await open(lock, 'wx');
await handle.writeFile(
  JSON.stringify({ owner: 'CO', card: 'AT-04 independent check', startedAt: new Date().toISOString(), token }),
);
await handle.close();
const report = {
  stamp,
  sourceVersion: JSON.parse(await readFile(resolve(root, 'docs/arm-tracking/evidence/AT-04/manifest.json'), 'utf8'))
    .version,
  runs: [],
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  execFileSync(
    process.execPath,
    [
      resolve(root, 'apps/desktop/node_modules/vite/bin/vite.js'),
      'build',
      '--config',
      resolve(import.meta.dirname, 'vite.config.mjs'),
    ],
    { cwd: root, stdio: 'inherit' },
  );
  for (const forceCpu of [false, true]) {
    let host, browser;
    const run = { forceCpu, steps: [], pageErrors: [] };
    const netlog = resolve(root, '.cache/arm-tracking/netlogs', `at04-co-${stamp}-${forceCpu}.json`);
    await mkdir(resolve(root, '.cache/arm-tracking/netlogs'), { recursive: true });
    try {
      host = spawn(
        resolve(root, '.cache/arm-tracking/host-target/release/at01-host.exe'),
        [
          '--dist',
          resolve(root, '.cache/arm-tracking/at04-dist'),
          '--out',
          out,
          '--data',
          resolve(root, `.cache/arm-tracking/at04-co-${forceCpu}-data`),
          '--csp',
          'html',
        ],
        {
          stdio: 'ignore',
          env: {
            ...process.env,
            WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: [
              '--remote-debugging-port=9343',
              '--use-fake-device-for-media-stream=fps=30',
              `--log-net-log=${netlog}`,
              '--net-log-capture-mode=Default',
              '--proxy-server=http://127.0.0.1:9',
              '"--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"',
            ].join(' '),
          },
        },
      );
      for (let i = 0; i < 60; i++) {
        try {
          browser = await chromium.connectOverCDP('http://127.0.0.1:9343');
          break;
        } catch {
          await sleep(500);
        }
      }
      assert.ok(browser, '専用WebView2に接続できる');
      const page = browser.contexts()[0].pages()[0];
      page.on('pageerror', (e) => run.pageErrors.push(e.message));
      await page.waitForFunction(() => !!window.__at04);
      if (forceCpu) {
        // Worker内のWebGL初期化だけを失敗させる。CPU推定そのものは製品のフォールバックを使う。
        await page.evaluate(() => {
          const original = URL.createObjectURL;
          URL.createObjectURL = function (blob) {
            if (blob instanceof Blob && blob.type === 'text/javascript') {
              const code = `const get = OffscreenCanvas.prototype.getContext; let failOnce = true;
                OffscreenCanvas.prototype.getContext = function(type, ...args) {
                  if (failOnce && /^webgl/.test(type)) { failOnce = false; throw new Error('AT-04 CO injected first GPU failure'); }
                  return get.call(this, type, ...args);
                };`;
              return original.call(URL, new Blob([code, blob], { type: blob.type }));
            }
            return original.call(URL, blob);
          };
        });
      }
      const start = await page.evaluate(() => window.__at04.start({ enabled: true, mode: 'normal', hands: true }));
      run.start = start;
      assert.equal(start.status.pose.state, 'ready');
      assert.equal(start.status.hands.state, 'ready');
      if (forceCpu) {
        assert.equal(start.status.pose.delegate, 'CPU');
      }
      // 初回GPUコンパイルを計測区間に混ぜない。250msの鮮度条件は製品側のまま。
      await page.waitForFunction(
        () => {
          const counts = window.__at04.counts();
          return counts.faces > 0 && counts.pose > 0 && counts.hands > 0;
        },
        null,
        { timeout: 30000 },
      );
      const normal = await page.evaluate(() => window.__at04.measure(3000));
      run.steps.push({ name: 'normal', ...normal, workers: page.workers().length });
      console.log(JSON.stringify({ forceCpu, normal }));
      assert.ok(normal.perSecond.faces > 0 && normal.perSecond.pose > 0 && normal.perSecond.hands > 0);
      await page.evaluate(() => window.__at04.configure({ enabled: true, mode: 'light', hands: true }));
      const light = await page.evaluate(() => window.__at04.measure(3000));
      assert.ok(light.perSecond.hands <= light.perSecond.pose + 1);
      run.steps.push({ name: 'light', ...light });
      for (let i = 0; i < 2; i++) {
        await page.evaluate(() => window.__at04.configure({ enabled: false, mode: 'normal', hands: true }));
        await page.waitForFunction(() => window.__at04.status().pose.state === 'off');
        await sleep(800);
        const off = await page.evaluate(() => window.__at04.measure(1000));
        assert.ok(off.perSecond.faces > 0);
        assert.equal(off.perSecond.pose, 0);
        assert.equal(off.perSecond.hands, 0);
        assert.equal(page.workers().length, 0);
        run.steps.push({ name: `off-${i}`, ...off, workers: page.workers().length });
        await page.evaluate(() => window.__at04.configure({ enabled: true, mode: 'normal', hands: true }));
        assert.equal(page.workers().length, 1);
      }
      await page.evaluate(() => window.__at04.stop());
      await sleep(800);
      assert.equal(page.workers().length, 0);
      assert.deepEqual(run.pageErrors, []);
    } finally {
      await browser?.close().catch(() => {});
      if (host && host.exitCode === null) {
        const exited = new Promise((r) => host.once('exit', r));
        host.kill();
        await Promise.race([exited, sleep(5000)]);
      }
      await sleep(1000);
      const raw = await readFile(netlog, 'utf8').catch(() => '');
      const urls = [...raw.matchAll(/"url":"([^"]+)"/g)].map((m) => m[1]);
      run.networkHosts = [
        ...new Set(
          urls.flatMap((u) => {
            try {
              return [new URL(u).host];
            } catch {
              return [];
            }
          }),
        ),
      ];
      run.mediaPipeExternalRequests = urls.filter(
        (u) => /mediapipe|googleapis|gstatic/.test(u) && !u.startsWith('http://at01.localhost'),
      );
      report.runs.push(run);
      await writeFile(resolve(out, 'run.json'), JSON.stringify(report, null, 2));
    }
    assert.deepEqual(run.mediaPipeExternalRequests, [], 'MediaPipeの外部送信がない');
    console.log(`AT-04 CO ${forceCpu ? 'CPU fallback' : 'default GPU'} passed`);
  }
  report.scriptSha256 = createHash('sha256')
    .update(await readFile(new URL(import.meta.url)))
    .digest('hex');
  report.passed = true;
  await writeFile(resolve(out, 'run.json'), JSON.stringify(report, null, 2));
  console.log(out);
} finally {
  if ((await readFile(lock, 'utf8').catch(() => '')).includes(token)) await unlink(lock);
}
