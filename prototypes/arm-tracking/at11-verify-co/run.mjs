// CO独立UI確認。専用Viteとheadless Edge、仮サービス。制作中の窓や実カメラは使わない。
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '../../..'),
  desktop = resolve(root, 'apps/desktop');
const req = createRequire(resolve(desktop, 'package.json'));
const { createServer } = await import(pathToFileURL(req.resolve('vite')).href);
const { chromium } = req('playwright');
const evidence = resolve(root, 'docs/arm-tracking/evidence/AT-11/co-ui');
await mkdir(evidence, { recursive: true });
const lock = resolve(root, '.cache/locks/main.lock');
await mkdir(resolve(root, '.cache/locks'), { recursive: true });
const token = randomUUID(),
  handle = await open(lock, 'wx');
await handle.writeFile(
  JSON.stringify({ owner: 'CO', card: 'AT-11 UI independent check', startedAt: new Date().toISOString(), token }),
);
await handle.close();
let server, browser;
const report = { checks: [], errors: [] };
try {
  server = await createServer({
    root: desktop,
    configFile: resolve(desktop, 'vite.config.ts'),
    server: { port: 1438, host: '127.0.0.1', strictPort: true },
    clearScreen: false,
  });
  await server.listen();
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();
  await page.route('**/*', (route) =>
    new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort(),
  );
  page.on('pageerror', (e) => report.errors.push(e.message));
  await page.goto('http://127.0.0.1:1438/');
  await page.waitForFunction(() => !!window.__studio);
  const fixture = JSON.parse(await readFile(resolve(root, 'fixtures/arm-tracking/project.json'), 'utf8'));
  await page.evaluate(async (fixture) => {
    const app = window.__studio;
    await app.startup;
    const { createDemoArmService, register } = await import('/src/modes/studio/arms/index.ts');
    app.services.arms = createDemoArmService({
      failOnce: 'bend',
      captureMs: 25,
      mirror: () => app.environment.get().mirror,
    });
    register();
    app.services.store.load(fixture);
    app.services.editor.set({ mode: 'studio' });
  }, fixture);
  const section = page.locator('.arms-section');
  await section.getByRole('heading', { name: '腕・手', exact: true }).waitFor();
  for (const [width, height] of [
    [1440, 1000],
    [800, 600],
  ]) {
    await page.setViewportSize({ width, height });
    await section.getByRole('checkbox', { name: '左腕（あなたの右手）', exact: true }).check();
    await section.getByRole('checkbox', { name: '右腕（あなたの左手）', exact: true }).uncheck();
    await section.getByRole('combobox', { name: '左腕の手形', exact: true }).selectOption('peace');
    assert.equal(await page.evaluate(() => window.__studio.services.arms.settings().sides.L.handMode), 'peace');
    await section.getByRole('combobox', { name: '右腕の手形', exact: true }).selectOption('fist');
    assert.equal(await page.evaluate(() => window.__studio.services.arms.settings().sides.R.enabled), false);
    await section.locator('summary').click();
    await section.getByLabel('左腕の点', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const overflow = await section.evaluate((el) =>
      [...el.querySelectorAll('input,select,button')]
        .filter((e) => {
          const b = e.getBoundingClientRect(),
            p = el.getBoundingClientRect();
          return b.width && (b.left < p.left - 1 || b.right > p.right + 1);
        })
        .map((e) => e.outerHTML.slice(0, 100)),
    );
    assert.deepEqual(overflow, []);
    await section.screenshot({ path: resolve(evidence, `settings-${width}x${height}.png`) });
    await section.locator('summary').click();
    await section.getByRole('button', { name: '腕の校正', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '腕の校正', exact: true });
    await dialog.waitFor();
    await dialog.locator('[data-part="rightShoulder"]').waitFor();
    const onX = Number(await dialog.locator('[data-part="rightShoulder"]').getAttribute('data-x'));
    await page.evaluate(() => window.__studio.environment.set({ mirror: false }));
    await dialog.getByText(/ミラーOFF：/).waitFor();
    const offX = Number(await dialog.locator('[data-part="rightShoulder"]').getAttribute('data-x'));
    assert.ok(Math.abs(onX + offX - 320) < 0.2, 'ミラーは320幅の枠で1回だけ反転');
    await page.evaluate(() => window.__studio.environment.set({ mirror: true }));
    await dialog.screenshot({ path: resolve(evidence, `calibration-${width}x${height}.png`) });
    await dialog.getByRole('button', { name: 'キャンセル', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => window.__studio.services.arms.calibration()), null);
    await page.screenshot({ path: resolve(evidence, `screen-${width}x${height}.png`), fullPage: true });
    report.checks.push({ width, height, overflow, onX, offX, cancelPreservesCalibration: true });
  }
  await section.getByRole('button', { name: '腕の校正', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '腕の校正', exact: true });
  await dialog.getByRole('button', { name: 'もう一度', exact: true }).waitFor({ timeout: 15000 });
  assert.match(await dialog.innerText(), /右肘/);
  await dialog.getByRole('button', { name: 'もう一度', exact: true }).click();
  await dialog.getByText(/腕の校正を保存した/).waitFor({ timeout: 15000 });
  assert.ok(await page.evaluate(() => window.__studio.services.arms.calibration()));
  await dialog.screenshot({ path: resolve(evidence, 'calibration-complete.png') });
  await dialog.getByRole('button', { name: '閉じる', exact: true }).click();
  await section.getByRole('button', { name: '腕の校正', exact: true }).click();
  await dialog.getByRole('button', { name: 'キャンセル', exact: true }).click();
  assert.ok(await page.evaluate(() => window.__studio.services.arms.calibration()), '再校正を中止しても前の校正が残る');
  assert.deepEqual(report.errors, []);
  await page.evaluate(() => window.__studio.services.arms.dispose());
  report.passed = true;
  report.scriptSha256 = createHash('sha256')
    .update(await readFile(new URL(import.meta.url)))
    .digest('hex');
  console.log('AT-11 CO UI passed');
} finally {
  await writeFile(resolve(evidence, 'run.json'), JSON.stringify(report, null, 2));
  await browser?.close();
  await server?.close();
  if ((await readFile(lock, 'utf8').catch(() => '')).includes(token)) await unlink(lock);
}
