// AT-01 の計測を流す。main.lock を取り、試作専用の WebView2 の窓を開き、CDP（Playwright）で操作する。
// 制作アプリ・ユーザーのブラウザーには接続しない。自分が起動した窓だけを閉じ、自分のロックだけを解放する。
//
//   node prototypes/arm-tracking/inference/run.mjs --label fake --fake --suite smoke
//   node prototypes/arm-tracking/inference/run.mjs --label camera --suite perf
//   node prototypes/arm-tracking/inference/run.mjs --label camera --suite guided
//
// --fake          WebView2 の仮のカメラ（人物の写らない模様）。実カメラの結果とは扱わない
// --fake-file F   仮のカメラに F（.mjpeg / .y4m）を流す
// --suite         smoke（動作と異常系）・perf（同条件の比較）・cycles（開始と停止の繰り返し）・guided（案内つき収録）・open（窓を開くだけ）
// --csp           html（製品と同じ。既定）・all・none
// --camera-label  カメラの名前の一部（例: eMeet）。省略時は既定のカメラ
// --no-build      ビルドを省く
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const dist = resolve(root, '.cache/arm-tracking/inference-dist');
const dataDir = resolve(root, '.cache/arm-tracking/webview2-data');
const hostExe = resolve(root, '.cache/arm-tracking/host-target/release/at01-host.exe');
// 案内つき収録の全体はリポジトリの外に置く（リポジトリには analyze-cli.ts で切り出した短い点列だけを入れる）
const recordings = resolve(root, '.cache/arm-tracking/recordings');
const lockPath = resolve(root, '.cache/locks/main.lock');
const { chromium } = createRequire(resolve(root, 'apps/desktop/package.json'))('playwright');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
};
const suite = option('--suite', 'smoke');
const fake = flag('--fake') || option('--fake-file') !== undefined;
const csp = option('--csp', 'html');
const label = option('--label', flag('--fake') ? 'fake' : 'camera');
const cameraLabel = option('--camera-label', null);
const port = Number(option('--port', '9341'));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = resolve(root, 'docs/arm-tracking/evidence/AT-01', `${label}-${suite}-${stamp}`);
// NetLog の本体は大きく、PC の情報も含むのでリポジトリの外に置く。証跡には要約（network.json）だけを残す
const netlogPath = resolve(root, '.cache/arm-tracking/netlogs', `${label}-${stamp}.json`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...m) => console.log(new Date().toISOString().slice(11, 19), ...m);

// --workers 2 で全ての条件を Pose・手の別々の Worker にする（条件ごとの指定が優先）
const BASE = {
  deviceId: null,
  width: 640,
  height: 480,
  fps: 30,
  load: 120,
  ...(option('--workers') ? { workers: Number(option('--workers')) } : {}),
  ...(flag('--blob-worker') ? { blobWorker: true } : {}),
};
const FACE = { face: true, pose: false, hands: false };
const NORMAL = { face: true, pose: true, hands: true, handHz: 30 };
const SUITES = {
  smoke: [
    { name: 'normal', ...NORMAL, measure: [5000, 3000] },
    { name: 'gpu-fail', ...NORMAL, simulate: 'gpu-fail', measure: [5000, 3000] },
    { name: 'gesture-fail', ...NORMAL, simulate: 'gesture-fail', measure: [5000, 3000] },
    { name: 'worker-fail', ...NORMAL, simulate: 'worker-fail', measure: [5000, 3000] },
    { name: 'transfer-fail', ...NORMAL, simulate: 'transfer-fail', measure: [5000, 3000] },
    { name: 'cpu', ...NORMAL, delegate: 'CPU', fallback: false, measure: [5000, 3000] },
  ],
  // 実カメラで、Pose と手を別々の Worker で並行に動かす案・手だけ CPU の案を比べる
  workers: [
    { name: 'C-normal', ...NORMAL },
    { name: 'M-2workers', ...NORMAL, workers: 2 },
    { name: 'N-2workers-handcpu', ...NORMAL, workers: 2, handDelegate: 'CPU' },
    { name: 'O-2workers-lite', ...NORMAL, workers: 2, handHz: 15 },
    { name: 'P-2workers-cpu', ...NORMAL, workers: 2, delegate: 'CPU', fallback: false },
    { name: 'Q-2workers-noface', ...NORMAL, workers: 2, face: false },
    { name: 'R-2workers-noload', ...NORMAL, workers: 2, load: 0 },
  ],
  // 同じ条件を交互に繰り返し、順番・時間の影響（GPU の状態・演者の動き）を見る
  repeat: [1, 2, 3].flatMap((round) => [
    { name: `C-normal-${round}`, ...NORMAL },
    { name: `M-2workers-${round}`, ...NORMAL, workers: 2 },
  ]),
  csp: [{ name: 'normal', ...NORMAL, measure: [3000, 3000] }],
  // Worker を blob の URL で包んだとき、CSP を HTML だけに付けても Worker に効くか
  'csp-blob': [{ name: 'normal', ...NORMAL, blobWorker: true, measure: [3000, 3000] }],
  perf: [
    { name: 'A-face', ...FACE },
    { name: 'B-face-pose', face: true, pose: true, hands: false },
    { name: 'C-normal', ...NORMAL },
    { name: 'D-lite-hands15', ...NORMAL, handHz: 15 },
    { name: 'E-pose-full', ...NORMAL, poseModel: 'full' },
    { name: 'F-worker-cpu', ...NORMAL, delegate: 'CPU', fallback: false },
    { name: 'G-imagebitmap', ...NORMAL, transfer: 'imagebitmap' },
    { name: 'H-normal-noload', ...NORMAL, load: 0 },
    { name: 'L-normal-nosplit', ...NORMAL, splitPost: false },
    { name: 'I-720p-face', ...FACE, width: 1280, height: 720 },
    { name: 'J-720p-normal', ...NORMAL, width: 1280, height: 720 },
    { name: 'K-720p-lite', ...NORMAL, width: 1280, height: 720, handHz: 15 },
  ],
};

async function sha256(path) {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

async function acquireLock() {
  await mkdir(dirname(lockPath), { recursive: true });
  const token = randomUUID();
  let handle;
  try {
    handle = await open(lockPath, 'wx'); // 使用中なら失敗する。他人のロックは触らない
  } catch {
    const holder = await readFile(lockPath, 'utf8').catch(() => '?');
    throw new Error(`main.lock は使用中: ${holder}`);
  }
  await handle.writeFile(
    JSON.stringify({ owner: 'CL', card: `AT-01 inference ${suite}`, startedAt: new Date().toISOString(), token }),
  );
  await handle.close();
  return async () => {
    const current = await readFile(lockPath, 'utf8').catch(() => '');
    if (current.includes(token)) await unlink(lockPath);
  };
}

// この窓のプロセス（専用のデータフォルダを使う WebView2）のメモリ
function webviewMemory() {
  const script = `Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" | Where-Object { $_.CommandLine -like '*arm-tracking*webview2-data*' } | ForEach-Object { $p = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue; if ($p) { '{0} {1} {2}' -f $_.ProcessId, $p.WorkingSet64, $p.PrivateMemorySize64 } }`;
  const text = execFileSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8' });
  const rows = text
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.split(' ').map(Number));
  return {
    processes: rows.length,
    workingSetMB: rows.reduce((sum, r) => sum + r[1], 0) / 2 ** 20,
    privateMB: rows.reduce((sum, r) => sum + r[2], 0) / 2 ** 20,
  };
}

async function manifest() {
  const files = {};
  for (const dir of [dist, join(dist, 'assets')]) {
    for (const name of await readdir(dir, { withFileTypes: true })) {
      if (name.isFile() && !name.name.endsWith('.map'))
        files[relative(dist, join(dir, name.name)).replace(/\\/g, '/')] = await sha256(join(dir, name.name));
    }
  }
  let commit = null;
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    // git が無くても続ける
  }
  return { commit, host: await sha256(hostExe), dist: files };
}

// NetLog から、要求された URL の相手先と、ネットワークの失敗の数をまとめる（途中で終わったファイルも読む）
async function summarizeNetlog() {
  await sleep(2000);
  const text = await readFile(netlogPath, 'utf8');
  const hosts = {};
  for (const match of text.matchAll(/"url":"([^"]+)"/g)) {
    let host;
    try {
      host = new URL(match[1]).host;
    } catch {
      continue;
    }
    hosts[host] = (hosts[host] ?? 0) + 1;
  }
  const netErrors = {};
  for (const match of text.matchAll(/"net_error":(-\d+)/g)) netErrors[match[1]] = (netErrors[match[1]] ?? 0) + 1;
  const local = new Set(['at01.localhost', '127.0.0.1:9', 'localhost']);
  const summary = {
    bytes: text.length,
    hosts,
    external: Object.keys(hosts).filter((host) => !local.has(host)),
    netErrors, // -130 ERR_PROXY_CONNECTION_FAILED、-105 ERR_NAME_NOT_RESOLVED、-102 ERR_CONNECTION_REFUSED
  };
  await writeFile(join(outDir, 'network.json'), JSON.stringify(summary, null, 1));
  log('NetLog', JSON.stringify(summary));
}

async function main() {
  const release = await acquireLock();
  let host;
  let browser;
  try {
    if (!flag('--no-build')) {
      log('ビルド');
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
    }
    await mkdir(outDir, { recursive: true });
    const browserArgs = [`--remote-debugging-port=${port}`];
    // 仮のカメラは既定で 20fps なので 30fps にする
    if (fake) browserArgs.push('--use-fake-device-for-media-stream=fps=30');
    // network：PC の外へ出ない設定（存在しないプロキシと、全ての名前解決の失敗）で起動し、Chromium の NetLog を残す
    if (suite === 'network') await mkdir(dirname(netlogPath), { recursive: true });
    if (suite === 'network')
      browserArgs.push(
        `--log-net-log=${netlogPath}`,
        '--net-log-capture-mode=Default',
        '--proxy-server=http://127.0.0.1:9',
        '"--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"',
      );
    if (option('--fake-file')) browserArgs.push(`--use-file-for-fake-video-capture=${resolve(option('--fake-file'))}`);
    log('窓を開く', browserArgs.join(' '));
    const saveTo = suite === 'guided' || suite === 'open' ? recordings : outDir;
    await mkdir(saveTo, { recursive: true });
    host = spawn(hostExe, ['--dist', dist, '--out', saveTo, '--data', dataDir, '--csp', csp], {
      env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: browserArgs.join(' ') },
      stdio: 'inherit',
    });
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
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning')
        errors.push(`${message.type()}: ${message.text()}`);
    });
    await page.waitForFunction(() => window.__at01 !== undefined, null, { timeout: 30_000 });
    if (cameraLabel) {
      const camera = await page.evaluate((label) => window.__at01.findCamera(label), cameraLabel);
      if (!camera) throw new Error(`カメラ「${cameraLabel}」が見つからない`);
      BASE.deviceId = camera.deviceId;
      log('カメラ', camera.label);
    }
    const environment = await page.evaluate(() => window.__at01.environment());
    const results = [];
    const record = { suite, label, fake, csp, browserArgs, environment, manifest: await manifest(), results, errors };
    const flush = () => writeFile(join(outDir, 'run.json'), JSON.stringify(record, null, 1));

    if (suite === 'open' || suite === 'guided') {
      await page.evaluate((config) => window.__at01.start(config), { ...BASE, ...NORMAL });
      if (suite === 'guided') {
        log('案内つき収録を始める（窓の案内に従う）');
        const timing = { prepMs: Number(option('--prep', '3000')), recordMs: Number(option('--record', '6000')) };
        // 仮のカメラで --screens のときだけ、準備中と収録中の画面を保存する（案内の見え方の確認）
        const shots =
          fake && flag('--screens')
            ? [timing.prepMs / 2, timing.prepMs + timing.recordMs / 2].map((ms, i) =>
                sleep(ms + 300).then(() => page.screenshot({ path: join(outDir, `guided-${i + 1}.png`) })),
              )
            : [];
        results.push(await page.evaluate((t) => window.__at01.guided(t), timing));
        await Promise.all(shots);
        results.push({ name: 'status', ...(await page.evaluate(() => window.__at01.status())) });
      } else {
        log('窓を閉じると終わる');
        await new Promise((r) => host.once('exit', r));
      }
    } else if (suite === 'network') {
      const netGuard = option('--net-guard', 'on') !== 'off';
      await page.evaluate((config) => window.__at01.start(config), { ...BASE, ...NORMAL, netGuard });
      results.push({ name: 'netcheck', netGuard, ...(await page.evaluate(() => window.__at01.netcheck())) });
      if (flag('--netcheck-only')) {
        // 推定器を閉じない（MediaPipe の送信の試みを起こさない）まま窓を閉じる
        await sleep(2000);
      } else {
        // 顔の推定器の60秒ごとの送信と、停止で推定器を閉じたときの送信を含める
        await sleep(Number(option('--hold', '65000')));
        await page.evaluate(() => window.__at01.stop());
        await sleep(3000);
      }
      results.push({ name: 'net', netGuard, net: (await page.evaluate(() => window.__at01.status())).net });
      await flush();
    } else if (suite === 'cycles') {
      results.push({ name: 'memory-before', ...webviewMemory() });
      for (let i = 0; i < 10; i++) {
        await page.evaluate((config) => window.__at01.start(config), { ...BASE, ...NORMAL });
        await sleep(3000);
        await page.evaluate(() => window.__at01.stop());
        await sleep(1500);
        results.push({ name: `memory-after-${i + 1}`, ...webviewMemory() });
        log(`開始と停止 ${i + 1}/10`, JSON.stringify(results.at(-1)));
      }
      await flush();
    } else {
      for (const item of SUITES[suite]) {
        const { name, measure = [15_000, 4_000], ...config } = item;
        log('計測', name);
        if (!fake) {
          const text = `計測中 ${SUITES[suite].indexOf(item) + 1}/${SUITES[suite].length}: 両手をカメラに映し、ときどき手を振ってください`;
          await page.evaluate((t) => window.__at01.say(t), text);
        }
        try {
          const started = await page.evaluate((c) => window.__at01.start(c), { ...BASE, ...config });
          const measured = await page.evaluate(([d, w]) => window.__at01.measure(d, w), measure);
          const probe =
            name === 'normal' || name === 'C-normal' ? await page.evaluate(() => window.__at01.probe()) : null;
          // 実カメラの映像は保存しない。画面の保存は仮のカメラで --screens を付けたときだけ（1枚約1.2MB）
          if (fake && flag('--screens')) await page.screenshot({ path: join(outDir, `${name}.png`) });
          results.push({ name, config: { ...BASE, ...config }, started, ...measured, probe, memory: webviewMemory() });
        } catch (error) {
          results.push({ name, config: { ...BASE, ...config }, error: String(error) });
        }
        await page.evaluate(() => window.__at01.stop());
        await sleep(1500);
        await flush();
      }
      // 停止で推定器を閉じたときの送信の試み（MediaPipe は close で溜めた記録を送ろうとする）も含める
      await sleep(2000);
      results.push({ name: 'net-after-stop', net: (await page.evaluate(() => window.__at01.status())).net });
    }
    await flush();
    log('保存', relative(root, outDir));
  } finally {
    await browser?.close().catch(() => {});
    if (host && host.exitCode === null) {
      const exited = new Promise((r) => host.once('exit', r));
      host.kill();
      await Promise.race([exited, sleep(5000)]);
    }
    if (suite === 'network') await summarizeNetlog().catch((error) => console.error('NetLog を読めない', error));
    // 証跡はリポジトリの整形規則に合わせる
    try {
      execFileSync(process.execPath, [resolve(root, 'node_modules/prettier/bin/prettier.cjs'), '--write', outDir], {
        cwd: root,
        stdio: 'ignore',
      });
    } catch (error) {
      console.error('証跡を整形できない', error.message);
    }
    await release();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
