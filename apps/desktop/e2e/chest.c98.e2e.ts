// カード98: 実画面の胸揺れ・固定範囲・お試し・履歴・保存。C98_BROWSER=edgeなら開発サーバーを使う。
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateProject } from '@app/schema';
import { ROOT, launchApp, waitForStartup, type RunningApp, type StudioHook } from './app';

const EDGE = process.env.C98_BROWSER === 'edge';
const OUT = join(ROOT, '.cache/verification/card98-chest-2026-10-09', EDGE ? 'edge' : 'native');
let browser: Browser | null = null,
  app: RunningApp | null = null,
  page: Page;
let environment: ReturnType<StudioHook['environment']['get']> | null = null,
  collapsed: string | null = null;
const errors: string[] = [];
beforeAll(async () => {
  mkdirSync(OUT, { recursive: true });
  if (EDGE) {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    page = await browser.newPage();
    await page.goto(process.env.C98_DEV_URL ?? 'http://127.0.0.1:1437/');
    await page.waitForFunction(() => '__studio' in window);
  } else {
    app = await launchApp(9354);
    page = app.page;
  }
  page.on('pageerror', (e) => errors.push(e.message));
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
describe('カード98: 胸の実画面', () => {
  for (const size of [
    { width: 1440, height: 1000 },
    { width: 800, height: 600 },
  ])
    it(`${size.width}×${size.height}: 胸の2出力・固定点・重力・方式切替と保存`, async () => {
      await page.setViewportSize(size);
      const project = validateProject(
        JSON.parse(readFileSync(join(ROOT, 'fixtures/chest-model/project.json'), 'utf8')),
      );
      const pngs = Object.fromEntries(
        project.assets.map((a) => [a.id, Array.from(readFileSync(join(ROOT, 'fixtures/chest-model', a.path)))]),
      );
      await page.evaluate(
        async ({ project, pngs }) => {
          const s = window.__studio.services;
          s.autoSaver.stop();
          for (const [id, png] of Object.entries(pngs)) await s.assets.put(id, new Uint8Array(png));
          s.store.load(project);
          s.editor.set({
            mode: 'modeling',
            selectedPartIds: ['chest'],
            activeParameterIds: [],
            editorParamValues: {},
            uiLevel: { modeling: 'easy', animation: 'easy', studio: 'easy' },
          });
        },
        { project, pngs },
      );
      const parts = page.locator('[data-panel-id="structure.parts"]'),
        settings = page.locator('[data-panel-id="partSettings"]');
      for (const panel of [parts, settings]) {
        const toggle = panel.locator('.panel-title .panel-toggle');
        if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
      }
      await parts.getByRole('tab', { name: 'パーツ構造', exact: true }).click();
      expect(await parts.getByRole('img', { name: '胸：胸揺れ：ON', exact: true }).count()).toBe(1);
      expect(await parts.getByRole('img', { name: '胸：軸揺れ：ON', exact: true }).count()).toBe(0);
      expect(await settings.getByLabel('胸を揺らす', { exact: true }).isChecked()).toBe(true);
      const numbers = settings.getByRole('button', { name: '物理の数値', exact: true });
      if ((await numbers.getAttribute('aria-expanded')) === 'false') await numbers.click();
      const gravity = settings.getByRole('spinbutton', { name: '胸の重力の強さ', exact: true });
      await gravity.fill('0.5');
      await gravity.press('Tab');
      expect(await page.evaluate(() => window.__studio.services.store.get().physics[0]!.bounce!.gravityStrength)).toBe(
        0.5,
      );
      const pinning = settings.getByRole('button', { name: '胸の固定範囲', exact: true });
      if ((await pinning.getAttribute('aria-expanded')) === 'false') await pinning.click();
      expect(await settings.getByRole('img', { name: '胸の固定点（白丸）と揺れる点（黒丸）' }).count()).toBe(1);
      const brightness = await settings
        .getByRole('img', { name: '胸の固定点（白丸）と揺れる点（黒丸）' })
        .locator('circle')
        .evaluateAll((dots) =>
          dots.map((dot) => {
            const rgb = getComputedStyle(dot).fill.match(/\d+/g)!.slice(0, 3).map(Number);
            return rgb.reduce((a, b) => a + b, 0) / 3;
          }),
        );
      const weights = project.physics[0]!.bounce!.weights;
      expect(brightness).toHaveLength(weights.length);
      weights.forEach((weight, i) => {
        if (weight === 0) expect(brightness[i]).toBeGreaterThan(192);
        else expect(brightness[i]).toBeLessThan(64);
      });
      await page.evaluate(() => window.__studio.services.editor.set({ editorParamValues: { BodyAngleZ: 45 } }));
      await settings.getByRole('button', { name: '上下を試す', exact: true }).click();
      await page.waitForTimeout(350);
      expect(await settings.getByRole('button', { name: '止める', exact: true }).count()).toBe(1);
      await settings.getByRole('button', { name: '止める', exact: true }).click();
      expect(await page.evaluate(() => window.__studio.services.editor.get().editorParamValues)).toEqual({
        BodyAngleZ: 45,
      });
      await page.evaluate(async () => {
        window.__studio.canvas.requestFit();
        await new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
      });
      const geometry = await page.evaluate(() =>
        Array.from(window.__studio.canvas.lastDeformed()!.byPartId.chest!.positions),
      );
      const originalView = await page.evaluate(() => window.__studio.canvas.getState().view);
      await page.evaluate(async (view) => {
        window.__studio.canvas.setView({
          scale: view.scale * 0.5,
          offset: { x: view.offset.x + 27, y: view.offset.y - 19 },
        });
        await new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
      }, originalView);
      expect(
        await page.evaluate(() => Array.from(window.__studio.canvas.lastDeformed()!.byPartId.chest!.positions)),
      ).toEqual(geometry);
      await page.evaluate((view) => window.__studio.canvas.setView(view), originalView);
      await settings.getByRole('img', { name: '胸の固定点（白丸）と揺れる点（黒丸）' }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(OUT, `pinning-${size.width}.png`) });
      await settings.getByRole('button', { name: '胸の固定範囲', exact: true }).click();
      await settings.getByRole('button', { name: '物理の数値', exact: true }).click();
      await settings.getByLabel('胸を揺らす', { exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(OUT, `settings-${size.width}.png`) });
      await settings.getByRole('button', { name: '布', exact: true }).click();
      expect(await page.evaluate(() => window.__studio.services.store.get().physics[0]!.deform)).toBe('swing');
      await page.evaluate(() => window.__studio.services.store.undo());
      expect(await settings.getByLabel('胸を揺らす', { exact: true }).isChecked()).toBe(true);
      await settings.getByLabel('胸を揺らす', { exact: true }).uncheck();
      expect(await page.evaluate(() => window.__studio.services.store.get().physics)).toEqual([]);
      await page.evaluate(() => window.__studio.services.store.undo());
      const roundtrip = await page.evaluate(
        async (dir) => {
          const s = window.__studio.services,
            p = s.store.get();
          const pngs = Object.fromEntries(
            p.assets.flatMap((a) => {
              const png = s.assets.getPng(a.id);
              return png ? [[a.id, png]] : [];
            }),
          );
          await s.io.save(dir, p, pngs);
          const loaded = await s.io.load(dir);
          s.store.load(loaded.project);
          return { physics: loaded.project.physics, repairs: loaded.report.repairs };
        },
        EDGE ? `/card98-${size.width}` : join(OUT, `save-${size.width}`),
      );
      expect(roundtrip.repairs).toEqual([]);
      expect(roundtrip.physics[0]!.bounce!.gravityStrength).toBe(0.5);
      expect(roundtrip.physics[0]!.verticalOutputParameterId).toBe('BustY');
      expect(errors).toEqual([]);
      writeFileSync(
        join(OUT, `result-${size.width}.json`),
        JSON.stringify({ size, repairs: roundtrip.repairs, errors, physics: roundtrip.physics }, null, 2) + '\n',
      );
    });
  it('スタジオの実再生でも手動の胸キーを保ち、空トラックでは自動の重力を残す', async () => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const project = validateProject(JSON.parse(readFileSync(join(ROOT, 'fixtures/chest-model/project.json'), 'utf8')));
    const pngs = Object.fromEntries(
      project.assets.map((a) => [a.id, Array.from(readFileSync(join(ROOT, 'fixtures/chest-model', a.path)))]),
    );
    project.animations[0]!.tracks = [
      { parameterId: 'BodyAngleZ', keyframes: [{ time: 0, value: 45, curve: 'linear' }] },
      { parameterId: 'BustY', keyframes: [{ time: 0, value: -0.7, curve: 'linear' }] },
    ];
    project.animations[0]!.transition = {
      ...project.animations[0]!.transition,
      blendIn: 0,
      blendOut: 0,
      keepPhysics: true,
    };
    await page.evaluate(
      async ({ project, pngs }) => {
        const s = window.__studio.services;
        for (const [id, png] of Object.entries(pngs)) await s.assets.put(id, new Uint8Array(png));
        s.store.load(project);
        s.editor.set({ mode: 'studio' });
      },
      { project, pngs },
    );
    const panel = page.locator('[data-panel-id="studioAnimations"]');
    const toggle = panel.locator('.panel-title .panel-toggle');
    if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
    const play = panel.getByRole('button', { name: /体を動かして胸揺れを試す/ });
    await play.click();
    await page.waitForFunction(() => {
      const frame = window.__studio.studio.runtime.lastFrame();
      return frame?.params.BodyAngleZ === 45 && frame.params.BustY === -0.7;
    });
    const manual = await page.evaluate(() => {
      const frame = window.__studio.studio.runtime.lastFrame()!;
      return { values: frame.params, physics: frame.layers.find((l) => l.id === 'physics')?.values ?? {} };
    });
    expect(manual.values.BustX).toBe(0);
    expect(manual.physics).not.toHaveProperty('BustY');
    await page.screenshot({ path: join(OUT, 'audit-studio.png') });
    await play.click();
    project.animations[0]!.tracks[1]!.keyframes = [];
    await page.evaluate((p) => window.__studio.services.store.load(p), project);
    await play.click();
    await page.waitForFunction(() => {
      const frame = window.__studio.studio.runtime.lastFrame();
      return frame?.params.BodyAngleZ === 45 && (frame.params.BustY ?? 0) > 0.05;
    });
    const automatic = await page.evaluate(() => window.__studio.studio.runtime.lastFrame()!.params);
    expect(automatic.BustX).toBeGreaterThan(0);
    expect(errors).toEqual([]);
    writeFileSync(join(OUT, 'audit-result.json'), JSON.stringify({ manual, automatic, errors }, null, 2) + '\n');
    await play.click();
    await page.evaluate(() => window.__studio.services.editor.set({ mode: 'modeling' }));
  });
});
