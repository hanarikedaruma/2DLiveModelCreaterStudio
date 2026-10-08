// カード99追補 / CO: 振り子の目印を実画面の2サイズ・文字色への追従と、実際の揺れスイッチで確かめる。
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { enablePhysicsCommand } from '../src/modes/modeling/physics/commands';
import { makeMesh, makePart, makeProject } from '../src/modes/modeling/structure/testing';
import { launchApp, waitForStartup, ROOT, type RunningApp, type StudioHook } from './app';

const EDGE = process.env.C99_BROWSER === 'edge';
const EVIDENCE = join(ROOT, '.cache', 'verification', 'card99-sway-badge-2026-10-08', EDGE ? 'edge' : 'native');
const HAIR_NAME = '長い髪・振り子の目印と目と鍵が隠れないことを確認するための長い名前';
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
    app = await launchApp(9352);
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

describe('カード99追補: 軸揺れの振り子', () => {
  for (const size of [
    { width: 1440, height: 1000 },
    { width: 800, height: 600 },
  ]) {
    it(`${size.width}×${size.height}: 目印・実スイッチ・履歴・長い名前・文字色`, async () => {
      await page.setViewportSize(size);
      const initial = enablePhysicsCommand('head', {
        physics: 'ph-head',
        transform: 'bt-head',
        vertices: 'bv-head',
      }).apply(
        makeProject({
          parts: [
            makePart('head', { name: '頭', kind: 'group' }),
            makePart('hair', { name: HAIR_NAME, parentId: 'head', meshId: 'm' }),
            makePart('plain', { name: '揺れのない飾り', parentId: 'head' }),
          ],
          meshes: [makeMesh('m')],
        }),
      );
      await page.evaluate((project) => {
        const s = window.__studio.services;
        s.store.load(project);
        s.editor.set({ mode: 'modeling', selectedPartIds: ['hair'], activeParameterIds: [], editorParamValues: {} });
      }, initial);
      const parts = page.locator('[data-panel-id="structure.parts"]');
      const settings = page.locator('[data-panel-id="partSettings"]');
      for (const panel of [parts, settings]) {
        const toggle = panel.locator('.panel-title .panel-toggle');
        if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
      }
      await parts.getByRole('tab', { name: 'パーツ構造', exact: true }).click();
      const hair = parts.locator('[role="treeitem"][data-part-id="hair"]');
      const badge = hair.getByRole('img', { name: `${HAIR_NAME}：軸揺れ：ON`, exact: true });
      expect(await badge.count()).toBe(0);
      expect(await parts.getByRole('img', { name: '頭：軸揺れ：ON', exact: true }).count()).toBe(1);
      const sway = settings.getByLabel('揺らす', { exact: true });
      await sway.check();
      await badge.waitFor({ state: 'visible' });
      expect(await parts.locator('[data-part-id="plain"]').getByRole('img').count()).toBe(0);
      await badge.click();
      expect(await sway.isChecked()).toBe(true);
      const metrics = await hair.evaluate((row) => {
        const icon = row.querySelector<HTMLElement>('.part-sway-badge')!;
        const name = row.querySelector<HTMLElement>('.part-name')!;
        const box = row.getBoundingClientRect();
        const iconBox = icon.getBoundingClientRect();
        return {
          iconWidth: iconBox.width,
          iconHeight: iconBox.height,
          iconInside: iconBox.left >= box.left && iconBox.right <= box.right,
          buttonsInside: [...row.querySelectorAll('button')].every((button) => {
            const b = button.getBoundingClientRect();
            return b.left >= box.left && b.right <= box.right && b.height > 0;
          }),
          nameTruncated: name.scrollWidth > name.clientWidth,
          stroke: getComputedStyle(icon.querySelector('svg')!).stroke,
          color: getComputedStyle(icon).color,
        };
      });
      expect(metrics.iconWidth).toBe(14);
      expect(metrics.iconHeight).toBe(14);
      expect(metrics.iconInside).toBe(true);
      expect(metrics.buttonsInside).toBe(true);
      expect(metrics.nameTruncated).toBe(true);
      expect(metrics.stroke).toBe(metrics.color);
      // 現製品の配色は固定。テーマ機能を仮定せず、文字色の変数を一時変更して追従だけを確認する。
      const colorFollow = await badge.evaluate((element) => {
        const icon = element as HTMLElement;
        const oldColor = icon.style.getPropertyValue('--text');
        icon.style.setProperty('--text', '#242424');
        const result = {
          stroke: getComputedStyle(icon.querySelector('svg')!).stroke,
          color: getComputedStyle(icon).color,
        };
        if (oldColor) icon.style.setProperty('--text', oldColor);
        else icon.style.removeProperty('--text');
        return result;
      });
      expect(colorFollow.stroke).toBe(colorFollow.color);
      expect(colorFollow.color).not.toBe(metrics.color);
      await page.screenshot({ path: join(EVIDENCE, `parts-${size.width}.png`) });
      await parts.screenshot({ path: join(EVIDENCE, `pendulum-${size.width}.png`) });
      await sway.uncheck();
      expect(await badge.count()).toBe(0);
      await page.evaluate(() => window.__studio.services.store.undo());
      await badge.waitFor({ state: 'visible' });
      await page.evaluate(() => window.__studio.services.store.redo());
      await page.waitForFunction(() => !window.__studio.services.store.get().physics.some((p) => p.partId === 'hair'));
      expect(await badge.count()).toBe(0);
      await sway.check();
      await badge.waitFor({ state: 'visible' });
      await parts.getByRole('tab', { name: '描画順', exact: true }).click();
      await parts.getByRole('img', { name: `${HAIR_NAME}：軸揺れ：ON`, exact: true }).waitFor({ state: 'visible' });
      await page.screenshot({ path: join(EVIDENCE, `draw-order-${size.width}.png`) });
      writeFileSync(join(EVIDENCE, `geometry-${size.width}.json`), JSON.stringify({ metrics, colorFollow }, null, 2));
      expect(errors).toEqual([]);
    });
  }
});
