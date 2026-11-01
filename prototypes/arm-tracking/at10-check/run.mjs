// COのAT-10操作確認。専用Viteとheadless Edgeだけを開き、制作中の窓・カメラを使わない。
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '../../..'),
  desktop = resolve(root, 'apps/desktop');
const desktopRequire = createRequire(resolve(desktop, 'package.json'));
const { createServer } = await import(pathToFileURL(desktopRequire.resolve('vite')).href);
const { chromium } = desktopRequire('playwright');
const evidence = resolve(root, 'docs/arm-tracking/evidence/AT-10');
await mkdir(evidence, { recursive: true });
const lockPath = resolve(root, '.cache/locks/main.lock');
await mkdir(resolve(root, '.cache/locks'), { recursive: true });
const token = randomUUID(),
  handle = await open(lockPath, 'wx');
await handle.writeFile(
  JSON.stringify({ owner: 'CO', card: 'AT-10 UI check', startedAt: new Date().toISOString(), token }),
);
await handle.close();
let server, browser;
try {
  server = await createServer({
    root: desktop,
    configFile: resolve(desktop, 'vite.config.ts'),
    server: { port: 1437, host: '127.0.0.1', strictPort: true },
    clearScreen: false,
  });
  await server.listen();
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext(),
    page = await context.newPage();
  await context.route('**/*', (route) =>
    new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort(),
  );
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:1437/');
  await page.waitForFunction(() => !!window.__studio);
  const fixture = JSON.parse(await readFile(resolve(root, 'fixtures/arm-tracking/project.json'), 'utf8'));
  const png = [...(await readFile(resolve(root, 'fixtures/arm-tracking/assets/arm-tech.png')))];
  await page.evaluate(
    async ({ fixture, png }) => {
      const app = window.__studio;
      await app.startup;
      app.services.store.load(fixture);
      await app.services.assets.put('arm-tech', new Uint8Array(png));
      app.services.editor.set({ mode: 'modeling' });
      app.canvas.setActiveTool('modeling.arms');
      app.canvas.requestFit();
    },
    { fixture, png },
  );
  await page.getByRole('heading', { name: '腕・手の設定' }).waitFor();
  const checks = [];
  for (const [width, height] of [
    [1440, 1000],
    [800, 600],
  ]) {
    await page.setViewportSize({ width, height });
    await page.waitForFunction(() => {
      const canvas = document.querySelector('.canvas-overlay');
      return canvas && Math.abs(canvas.width - canvas.clientWidth * devicePixelRatio) < 2;
    });
    await page.evaluate(() => window.__studio.canvas.requestFit());
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.getByRole('button', { name: '顔の前でピース', exact: true }).click();
    await page.waitForFunction(() => window.__studio.services.editor.get().editorParamValues.HandPeaceL === 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const overflow = await page
      .locator('.arm-setup')
      .evaluate((el) =>
        [...el.querySelectorAll('input,select,button')]
          .filter(
            (e) =>
              e.getBoundingClientRect().width &&
              (e.getBoundingClientRect().left < el.getBoundingClientRect().left - 1 ||
                e.getBoundingClientRect().right > el.getBoundingClientRect().right + 1),
          )
          .map((e) => e.outerHTML.slice(0, 120)),
      );
    assert.deepEqual(overflow, [], `設定欄の横はみ出し ${width}`);
    await page.locator('.arm-setup').screenshot({ path: resolve(evidence, `settings-${width}x${height}.png`) });
    await page.screenshot({ path: resolve(evidence, `screen-${width}x${height}.png`), fullPage: true });
    checks.push({ width, height, overflow });
  }
  const before = await page.evaluate(() => JSON.stringify(window.__studio.services.store.get()));
  await page.getByRole('button', { name: '手振りを再生', exact: true }).click();
  const waveStart = await page.evaluate(() => window.__studio.services.editor.get().editorParamValues.ArmShoulderL);
  await page.waitForFunction(
    (old) => Math.abs(window.__studio.services.editor.get().editorParamValues.ArmShoulderL - old) > 0.1,
    waveStart,
  );
  await page.getByRole('button', { name: '手振りを停止', exact: true }).click();
  await page.getByRole('button', { name: '顔の前でピース', exact: true }).click();
  const beforePose = await page.evaluate(() => window.__studio.services.editor.get().editorParamValues.ArmShoulderL);
  await page.getByRole('button', { name: '手首をドラッグして確認', exact: true }).click();
  const drag = await page.evaluate(() => {
    const app = window.__studio,
      view = app.canvas.getState().view;
    const rig = app.services.store.get().model.armRigs.find((r) => r.side === 'L'),
      values = app.services.editor.get().editorParamValues;
    const shoulder = (values[rig.parameters.shoulder] * Math.PI) / 180,
      forearm = shoulder + (rig.bendSign * values[rig.parameters.elbow] * Math.PI) / 180;
    const wrist = {
      x: rig.joints.shoulder.x + rig.lengths.upper * Math.sin(shoulder) + rig.lengths.lower * Math.sin(forearm),
      y: rig.joints.shoulder.y + rig.lengths.upper * Math.cos(shoulder) + rig.lengths.lower * Math.cos(forearm),
    };
    const rect =
      document.querySelector('.canvas-host canvas')?.getBoundingClientRect() ??
      document.querySelector('canvas').getBoundingClientRect();
    return {
      x: rect.left + wrist.x * view.scale + view.offset.x,
      y: rect.top + wrist.y * view.scale + view.offset.y,
      endX: rect.left + 420 * view.scale + view.offset.x,
      endY: rect.top + 210 * view.scale + view.offset.y,
    };
  });
  await page.mouse.move(drag.x, drag.y);
  assert.equal(await page.evaluate((p) => document.elementFromPoint(p.x, p.y)?.className, drag), 'canvas-overlay');
  await page.mouse.down();
  await page.mouse.move(drag.endX, drag.endY, { steps: 6 });
  await page.mouse.up();
  assert.notEqual(
    await page.evaluate(() => window.__studio.services.editor.get().editorParamValues.ArmShoulderL),
    beforePose,
    '実際のキャンバスのドラッグがIK姿勢を変える',
  );
  assert.equal(
    await page.evaluate(() => JSON.stringify(window.__studio.services.store.get())),
    before,
    'プレビューは保存データを変えない',
  );
  await page.getByRole('button', { name: '関節設定を解除（素材・キーを残す）', exact: true }).click();
  assert.equal(await page.evaluate(() => window.__studio.services.store.get().model.armRigs.length), 1);
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  assert.equal(await page.evaluate(() => window.__studio.services.store.get().model.armRigs.length), 2);
  assert.deepEqual(errors, []);
  await writeFile(
    resolve(evidence, 'ui-check.json'),
    JSON.stringify(
      {
        passed: true,
        browser: 'isolated headless Edge',
        checks,
        operations: ['代表姿勢', '手振りの再生と停止', 'IKドラッグ', '保存データ不変', '解除とUndo'],
        pageErrors: errors,
        scriptSha256: createHash('sha256')
          .update(await readFile(import.meta.filename))
          .digest('hex'),
      },
      null,
      2,
    ) + '\n',
  );
  console.log('AT-10: 2画面サイズ、操作・保存保護・解除/Undoが成功');
} finally {
  await browser?.close();
  await server?.close();
  if ((await readFile(lockPath, 'utf8').catch(() => '')).includes(token)) await unlink(lockPath);
}
