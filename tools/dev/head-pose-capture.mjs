// I-039 の見え方の記録（開発中の確認用）。開発サーバー（pnpm dev。既定は http://127.0.0.1:1430/）を Edge で開き、
// fixtures の基準モデルを読み込んでかんたんセットアップを掛け、顔の向きごとのキャンバスの画像を保存する。
// 使い方: node tools/dev/head-pose-capture.mjs <出力フォルダ> [faceTurn の方式 ...]
//   例: node tools/dev/head-pose-capture.mjs docs/evidence/i039-head-pose head-pose head-surface
// 環境変数 DEV_URL で開発サーバーの URL を変えられる。基準モデルのファイルは変えない（メモリ上だけで変える）
// MODEL で fixtures のモデルを選ぶ（既定 reference-model。sample-model も使える）。
// POSES=grid で左右・上下を −30・−15・0・15・30 の組み合わせ（25）にする（既定は9つ。STEP3 のカード56）
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(join(ROOT, 'apps', 'desktop', 'package.json'));
const { chromium } = require('playwright');

const OUT = resolve(ROOT, process.argv[2] ?? 'docs/evidence/i039-head-pose');
const METHODS = process.argv.slice(3).length > 0 ? process.argv.slice(3) : ['head-pose'];
const DEV_URL = process.env.DEV_URL ?? 'http://127.0.0.1:1430/';
const MODEL = process.env.MODEL ?? 'reference-model';
const STEPS = [-30, -15, 0, 15, 30];
const POSES =
  process.env.POSES === 'grid'
    ? STEPS.flatMap((y) => STEPS.map((x) => [x, y]))
    : [
        [-30, 0],
        [-15, 0],
        [0, 0],
        [15, 0],
        [30, 0],
        [0, 30],
        [0, -30],
        [30, 30],
        [-30, -30],
      ];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 2000, height: 1500 } });
await page.goto(DEV_URL);
await page.waitForFunction(() => window.__studio !== undefined, null, { timeout: 30_000 });

const shots = {};
for (const method of METHODS) {
  // 基準モデルを読み込み、その方式でかんたんセットアップを掛ける
  const result = await page.evaluate(
    async ({ root, method, model }) => {
      const fs = (path) => `/@fs/${root.replace(/\\/g, '/')}/${path}`;
      const schema = await import(fs('packages/schema/src/index.ts'));
      const core = await import(fs('packages/core/src/index.ts'));
      const project = schema.loadProjectJson(await (await fetch(fs(`fixtures/${model}/project.json`))).text());
      const s = window.__studio;
      for (const a of project.assets) {
        const bytes = new Uint8Array(await (await fetch(fs(`fixtures/${model}/${a.path}`))).arrayBuffer());
        await s.services.assets.put(a.id, bytes);
      }
      const plan = core.createAutoSetup({ faceTurn: method }).plan(project);
      s.services.store.load(plan.command.apply(project));
      s.services.editor.set({ mode: 'modeling', selectedPartIds: [], activeParameterIds: [], editorParamValues: {} });
      return { warnings: plan.warnings };
    },
    { root: ROOT, method, model: MODEL },
  );
  console.log(MODEL, method, JSON.stringify(result));
  await page.getByRole('button', { name: '全体を表示' }).click();
  await page.waitForTimeout(500);
  shots[method] = [];
  for (const [x, y] of POSES) {
    await page.evaluate(
      ({ x, y }) => window.__studio.services.editor.set({ editorParamValues: { FaceAngleX: x, FaceAngleY: y } }),
      { x, y },
    );
    await page.waitForTimeout(400);
    const file = join(OUT, `${MODEL}_${method}_x${x}_y${y}.png`);
    const canvas = page.locator('[data-testid=canvas-main]');
    const box = await canvas.boundingBox();
    // 頭のまわり（キャンバスの上の 55%・中央の 70%）
    await page.screenshot({
      path: file,
      clip: { x: box.x + box.width * 0.15, y: box.y, width: box.width * 0.7, height: box.height * 0.55 },
    });
    shots[method].push({ x, y, file });
  }
}

// 方式ごとに、ポーズを横に並べた一覧の画像
for (const method of METHODS) {
  const cells = shots[method]
    .map(({ x, y, file }) => {
      const data = `data:image/png;base64,${Buffer.from(require('node:fs').readFileSync(file)).toString('base64')}`;
      return `<figure><img src="${data}"><figcaption>X ${x} / Y ${y}</figcaption></figure>`;
    })
    .join('');
  await page.setContent(
    `<style>body{margin:0;background:#f2f3f5;font:20px sans-serif}div{display:flex;flex-wrap:wrap}figure{margin:6px;text-align:center}img{width:420px}</style><h3 style="margin:8px">${MODEL} / ${method}</h3><div>${cells}</div>`,
  );
  await page.setViewportSize({ width: 2200, height: 1400 });
  await page.screenshot({ path: join(OUT, `${MODEL}_${method}_poses.png`), fullPage: true });
  await page.goto(DEV_URL);
  await page.waitForFunction(() => window.__studio !== undefined, null, { timeout: 30_000 });
}
// 記録にはファイル名だけを残す（PC のフォルダの場所を入れない）
const names = Object.fromEntries(
  Object.entries(shots).map(([m, list]) => [m, list.map((s) => ({ ...s, file: basename(s.file) }))]),
);
writeFileSync(join(OUT, `${MODEL}_poses.json`), JSON.stringify(names, null, 2) + '\n');
await browser.close();
console.log('saved', OUT);
