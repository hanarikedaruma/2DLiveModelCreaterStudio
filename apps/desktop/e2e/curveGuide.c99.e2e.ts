// カード99 / CO: 実画面で流れ線を描き、編集・重力・履歴・保存を確認する。
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Vec2 } from '@app/schema';
import { hairProject } from '../src/modes/modeling/curveGuide/testing';
import { launchApp, waitForStartup, ROOT, slash, type RunningApp, type StudioHook } from './app';

const EDGE = process.env.C99_BROWSER === 'edge';
const EVIDENCE = join(ROOT, '.cache', 'verification', 'card99-2026-10-08', EDGE ? 'edge' : 'native');
let app: RunningApp | null = null;
let browser: Browser | null = null;
let page: Page;
let environment: ReturnType<StudioHook['environment']['get']> | null = null;
let collapsed: string | null = null;
const errors: string[] = [];

beforeAll(async () => {
  mkdirSync(EVIDENCE, { recursive: true });
  if (EDGE) {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    page = await browser.newPage();
    await page.goto(process.env.C99_DEV_URL ?? 'http://127.0.0.1:1435/');
    await page.waitForFunction(() => '__studio' in window);
  } else {
    app = await launchApp(9351);
    page = app.page;
  }
  page.on('pageerror', (error) => errors.push(error.message));
  await waitForStartup(page);
  environment = await page.evaluate(() => window.__studio.environment.get());
  collapsed = await page.evaluate(() => localStorage.getItem('live2d-studio.collapsedPanels'));
  await page.evaluate(() => window.__studio.services.autoSaver.stop());
});
afterAll(async () => {
  if (page)
    await page
      .evaluate(
        async ({ previous, panels }) => {
          if (previous) {
            window.__studio.environment.set(previous);
            await window.__studio.environment.flush();
          }
          if (panels === null) localStorage.removeItem('live2d-studio.collapsedPanels');
          else localStorage.setItem('live2d-studio.collapsedPanels', panels);
          window.__studio.services.autoSaver.stop();
        },
        { previous: environment, panels: collapsed },
      )
      .catch(() => {});
  await app?.close();
  await browser?.close();
});

async function screenPoint(p: Vec2) {
  const box = (await page.getByTestId('canvas-overlay').boundingBox())!;
  const scale = (Math.min(box.width, box.height) * 0.9) / 1000;
  return {
    x: box.x + (box.width - 1000 * scale) / 2 + p.x * scale,
    y: box.y + (box.height - 1000 * scale) / 2 + p.y * scale,
  };
}
async function drag(from: Vec2, to: Vec2) {
  const a = await screenPoint(from),
    b = await screenPoint(to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.mouse.up();
}
async function handles() {
  return page.evaluate(() => {
    const s = window.__studio.services,
      model = s.store.get().model;
    const out = s.pipeline.deform(model, s.evaluator.evaluate(model, s.editor.get().editorParamValues));
    return Object.values(out.curveGuides ?? {})[0]!.handles;
  });
}

describe('カード99: 一本の流れ線で髪を曲げる', () => {
  for (const size of [
    { width: 1440, height: 1000 },
    { width: 800, height: 600 },
  ]) {
    it(`${size.width}×${size.height}: 描画・編集・Undo・重力・キー記録・再読込`, async () => {
      await page.setViewportSize(size);
      await page.evaluate(async (project) => {
        const s = window.__studio.services;
        s.autoSaver.stop();
        const texture = document.createElement('canvas');
        texture.width = 20;
        texture.height = 200;
        const ctx = texture.getContext('2d')!;
        ctx.fillStyle = '#c2a16d';
        ctx.fillRect(0, 0, 20, 200);
        ctx.fillStyle = '#806440';
        ctx.fillRect(3, 0, 2, 200);
        ctx.fillRect(15, 0, 2, 200);
        const blob = await new Promise<Blob>((resolve) => texture.toBlob((value) => resolve(value!)));
        const buffer = await blob.arrayBuffer(),
          png = new Uint8Array(buffer);
        project.assets[0]!.hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)))
          .map((v) => v.toString(16).padStart(2, '0'))
          .join('');
        await s.assets.put('a', png);
        s.store.load(project);
        s.editor.set({ mode: 'modeling', selectedPartIds: ['hair'], activeParameterIds: [], editorParamValues: {} });
      }, hairProject());
      const panel = page.locator('[data-panel-id="curveGuide"]');
      const toggle = panel.locator('.panel-title button');
      if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
      await page.getByRole('button', { name: '全体を表示', exact: true }).click();
      await panel.getByRole('button', { name: '流れ線を描く', exact: true }).click();
      await drag({ x: 300, y: 200 }, { x: 300, y: 400 });
      await page.waitForFunction(() => window.__studio.services.store.get().model.curveGuides?.length === 1);
      const created = await page.evaluate(() => window.__studio.services.store.get());
      await drag((await handles())[1]!, { x: 325, y: 300 });
      expect((await handles())[1]!.x).toBeCloseTo(325, 1);
      await page.getByTestId('canvas-overlay').focus();
      await page.keyboard.press('Control+z');
      expect(await page.evaluate(() => window.__studio.services.store.get())).toEqual(created);
      await page.keyboard.press('Control+Shift+z');
      expect((await handles())[1]!.x).toBeCloseTo(325, 1);
      // 直毛へ戻して、重力の連続する補正を確認する。
      await page.keyboard.press('Control+z');
      await panel.getByLabel('重力に沿わせる', { exact: true }).check();
      await page.evaluate(() =>
        window.__studio.services.editor.set({
          activeParameterIds: ['FaceAngleZ'],
          editorParamValues: { FaceAngleZ: 30 },
        }),
      );
      const stats = await page.evaluate(() => {
        const s = window.__studio.services,
          model = s.store.get().model;
        const times: number[] = [];
        let tipAngle = 0;
        for (let angle = -30; angle <= 30; angle++) {
          const start = performance.now();
          const out = s.pipeline.deform(model, s.evaluator.evaluate(model, { FaceAngleZ: angle }));
          times.push(performance.now() - start);
          const curve = Object.values(out.curveGuides!)[0]!.curve,
            a = curve.at(-2)!,
            b = curve.at(-1)!;
          tipAngle = Math.max(tipAngle, Math.abs((Math.atan2(b.x - a.x, b.y - a.y) * 180) / Math.PI));
        }
        return { maxTipAngle: tipAngle, medianMs: times.sort((a, b) => a - b)[30], maxMs: Math.max(...times) };
      });
      expect(stats.maxTipAngle).toBeLessThan(5);
      writeFileSync(join(EVIDENCE, `evaluation-${size.width}.json`), JSON.stringify(stats, null, 2));
      await panel.getByRole('button', { name: '現在のキーに形を記録', exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(EVIDENCE, `gravity-${size.width}.png`) });
      const beforeBake = await page.evaluate(() => window.__studio.services.store.get());
      await panel.getByRole('button', { name: '現在のキーに形を記録', exact: true }).click();
      await page.waitForFunction(() => window.__studio.services.store.get().model.curveGuides?.[0]?.enabled === false);
      const baked = await page.evaluate(() => window.__studio.services.store.get());
      expect(baked.model.bindings.some((b) => b.target.type === 'mesh' && b.channel === 'vertices')).toBe(true);
      await page.getByTestId('canvas-overlay').focus();
      await page.keyboard.press('Control+z');
      expect(await page.evaluate(() => window.__studio.services.store.get())).toEqual(beforeBake);
      if (!EDGE) {
        const dir = slash(join(EVIDENCE, `project-${size.width}`));
        await page.evaluate((d) => window.__studio.project.saveAs(d), dir);
        await page.evaluate((d) => window.__studio.project.open(d), dir);
        await page.evaluate(() => window.__studio.services.autoSaver.stop());
      } else
        await page.evaluate(
          (project) => window.__studio.services.store.load(JSON.parse(JSON.stringify(project))),
          beforeBake,
        );
      expect(await page.evaluate(() => window.__studio.services.store.get().model.curveGuides)).toEqual(
        beforeBake.model.curveGuides,
      );
      expect(errors).toEqual([]);
    });
  }
});
