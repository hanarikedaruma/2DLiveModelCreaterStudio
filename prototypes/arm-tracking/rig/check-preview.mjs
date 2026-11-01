// 独立したheadlessブラウザで、この試作HTMLだけを確認する。制作アプリは起動しない。
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const evidence = resolve(root, 'docs/arm-tracking/evidence/AT-02');
const requireDesktop = createRequire(resolve(root, 'apps/desktop/package.json'));
const { chromium } = requireDesktop('playwright');
const prettier = createRequire(resolve(root, 'package.json'))('prettier');
const lockPath = resolve(root, '.cache/locks/main.lock');
await mkdir(dirname(lockPath), { recursive: true });
const token = randomUUID();
const lock = await open(lockPath, 'wx'); // 使用中なら失敗して終了する。他人のロックは触らない。
let browser;
try {
  await lock.writeFile(
    JSON.stringify({ owner: 'CO', card: 'AT-02 preview', startedAt: new Date().toISOString(), token }),
  );
  await lock.close();
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(pathToFileURL(resolve(evidence, 'preview.html')).href);
  await page.locator('#scene [data-hand="L"]').waitFor();
  const screenshots = [];
  for (const [width, height] of [
    [1440, 1000],
    [800, 600],
  ]) {
    await page.setViewportSize({ width, height });
    await page.selectOption('#preset', '8');
    assert.equal(await page.locator('#left-hand').inputValue(), 'peace');
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
      '横にはみ出す要素がない',
    );
    const name = `preview-${width}x${height}.png`;
    await page.screenshot({ path: resolve(evidence, name), fullPage: true });
    screenshots.push(name);
  }
  const peace = await page.locator('#scene [data-hand="L"]').innerHTML();
  await page.selectOption('#left-hand', 'fist');
  assert.notEqual(await page.locator('#scene [data-hand="L"]').innerHTML(), peace, '手形の切替');
  for (const [id, value] of [
    ['rotation', '12'],
    ['scale', '0.85'],
  ]) {
    await page.locator(`#${id}`).evaluate((input, next) => {
      input.value = next;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
  }
  assert.match(await page.locator('#status').textContent(), /100\.30 \/ 91\.80/, '親の等倍率で骨長も変わる');
  await page.click('#play');
  const before = await page.locator('#scene [data-hand="L"]').getAttribute('transform');
  await page.waitForFunction(
    (old) => document.querySelector('#scene [data-hand="L"]').getAttribute('transform') !== old,
    before,
  );
  await page.click('#play');
  assert.equal(await page.locator('#play').getAttribute('aria-pressed'), 'false');
  await page.selectOption('#preset', '0');
  await page.locator('#scene [data-hand="L"]').scrollIntoViewIfNeeded();
  const start = await page.locator('#scene [data-hand="L"]').evaluate((element) => {
    const p = new DOMPoint(0, 0).matrixTransform(element.getScreenCTM());
    return { x: p.x, y: p.y };
  });
  const initialAngles = await page.locator('#left-shoulder-value').textContent();
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 55, start.y - 85, { steps: 5 });
  await page.mouse.up();
  assert.notEqual(
    await page.locator('#left-shoulder-value').textContent(),
    initialAngles,
    '手首のドラッグで角度を解く',
  );
  assert.match(await page.locator('#status').textContent(), /目標との距離/);
  assert.deepEqual(errors, []);
  const result = {
    browser: 'isolated headless Edge',
    viewportSizes: [
      [1440, 1000],
      [800, 600],
    ],
    screenshots,
    checks: ['表示・横はみ出し', '手形切替', '親の回転・倍率', '手振りの再生・停止', '手首ドラッグ'],
    pageErrors: errors,
    previewSha256: createHash('sha256')
      .update(await readFile(resolve(evidence, 'preview.html')))
      .digest('hex'),
    checkScriptSha256: createHash('sha256')
      .update(await readFile(fileURLToPath(import.meta.url)))
      .digest('hex'),
  };
  const formatOptions = (await prettier.resolveConfig(resolve(evidence, 'preview-check.json'))) ?? {};
  await writeFile(
    resolve(evidence, 'preview-check.json'),
    await prettier.format(JSON.stringify(result), { ...formatOptions, parser: 'json' }),
  );
  console.log(JSON.stringify(result));
} finally {
  try {
    await browser?.close();
  } finally {
    await lock.close();
    const contents = JSON.parse(await readFile(lockPath, 'utf8'));
    if (contents.token === token) await unlink(lockPath);
  }
}
