import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeProject } from '../src/modes/modeling/structure/testing';
import { launchApp, waitForStartup, ROOT, type RunningApp, type StudioHook } from './app';

const KEY = 'live2d-studio.collapsedPanels';
const EDGE = process.env.I066_BROWSER === 'edge';
const EVIDENCE = join(ROOT, '.cache', 'verification', 'i066-panel-collapse-2026-10-08', EDGE ? 'edge' : 'native');
let app: RunningApp | null = null;
let browser: Browser | null = null;
let page: Page;
let environment: ReturnType<StudioHook['environment']['get']> | null = null;
let previous: string | null = null;
const errors: string[] = [];
beforeAll(async () => {
  mkdirSync(EVIDENCE, { recursive: true });
  if (EDGE) {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    page = await browser.newPage();
    await page.goto(process.env.I066_DEV_URL ?? 'http://127.0.0.1:1435/');
    await page.waitForFunction(() => '__studio' in window);
  } else {
    app = await launchApp(9354);
    page = app.page;
  }
  page.on('pageerror', (e) => errors.push(e.message));
  await waitForStartup(page);
  previous = await page.evaluate((key) => localStorage.getItem(key), KEY);
  environment = await page.evaluate(() => window.__studio.environment.get());
  await page.evaluate(() => window.__studio.services.autoSaver.stop());
});
afterAll(async () => {
  await page
    ?.evaluate(
      async ({ key, previous, environment }) => {
        if (previous === null) localStorage.removeItem(key);
        else localStorage.setItem(key, previous);
        if (environment) {
          window.__studio.environment.set(environment);
          await window.__studio.environment.flush();
        }
        window.__studio.services.autoSaver.stop();
      },
      { key: KEY, previous, environment },
    )
    .catch(() => {});
  await app?.close();
  await browser?.close();
});

describe('I-066: 列をまたぐ折りたたみの保存', () => {
  for (const size of [
    { width: 1440, height: 1000 },
    { width: 800, height: 600 },
  ])
    it(`${size.width}×${size.height}: 左・右・下・モード切替と再読込`, async () => {
      await page.setViewportSize(size);
      await page.evaluate((key) => localStorage.removeItem(key), KEY);
      await page.reload();
      await waitForStartup(page);
      const project = makeProject();
      const load = async () =>
        page.evaluate((p) => {
          const { services } = window.__studio;
          services.autoSaver.stop();
          services.store.load(p);
          services.editor.set({ mode: 'modeling', selectedPartIds: [] });
        }, project);
      await load();
      const panel = (id: string) => page.locator(`[data-panel-id="${id}"] .panel-toggle`);
      const saved = async () =>
        page.evaluate((key) => (JSON.parse(localStorage.getItem(key) ?? '[]') as string[]).sort(), KEY);
      const toggle = async (id: string) => panel(id).click();
      const closed = async (id: string) => expect(await panel(id).getAttribute('aria-expanded')).toBe('false');
      const left = 'assets.tray',
        right = 'parameters',
        bottom = 'studioExpressions',
        studioRight = 'studioSettings';
      await toggle(left);
      expect(await saved()).toEqual([left]);
      await toggle(right);
      expect(await saved()).toEqual([left, right].sort());
      await page.getByRole('button', { name: 'スタジオ', exact: true }).click();
      await toggle(bottom);
      await toggle(studioRight);
      expect(await saved()).toEqual([left, right, bottom, studioRight].sort());
      await page.getByRole('button', { name: 'モデリング', exact: true }).click();
      await closed(left);
      await closed(right);
      await toggle(right);
      const expected = [left, bottom, studioRight].sort();
      expect(await saved()).toEqual(expected);
      await page.reload();
      await waitForStartup(page);
      await load();
      await closed(left);
      expect(await panel(right).getAttribute('aria-expanded')).toBe('true');
      await page.getByRole('button', { name: 'スタジオ', exact: true }).click();
      await closed(bottom);
      await closed(studioRight);
      expect(await saved()).toEqual(expected);
      await page.screenshot({ path: join(EVIDENCE, `collapsed-${size.width}.png`) });
      writeFileSync(
        join(EVIDENCE, `state-${size.width}.json`),
        JSON.stringify({ size, saved: await saved(), errors }, null, 2),
      );
      expect(errors).toEqual([]);
    });
});
