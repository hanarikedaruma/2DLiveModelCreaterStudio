import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { curveMeshSignature } from '@app/core';
import type { CurveGuide } from '@app/schema';
import { hairProject } from '../src/modes/modeling/curveGuide/testing';
import { makePart, makeAsset } from '../src/modes/modeling/structure/testing';
import { launchApp, waitForStartup, ROOT, slash, type RunningApp, type StudioHook } from './app';

const EDGE = process.env.C100_BROWSER === 'edge';
const EVIDENCE = join(ROOT, '.cache', 'verification', 'card100-flow-sway-2026-10-08', EDGE ? 'edge' : 'native');
const SAVE_RUN = join(EVIDENCE, `save-${Date.now()}`);
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
    await page.goto(process.env.C100_DEV_URL ?? 'http://127.0.0.1:1435/');
    await page.waitForFunction(() => '__studio' in window);
  } else {
    app = await launchApp(9353);
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

describe('流れ線で揺らす・両方式の表示と試す操作', () => {
  for (const size of [
    { width: 1440, height: 1000 },
    { width: 800, height: 600 },
  ])
    it(`${size.width}×${size.height}`, async () => {
      await page.setViewportSize(size);
      const project = hairProject();
      const bodyMesh = {
        ...project.model.meshes[0]!,
        id: 'bodyMesh',
        vertices: [
          { x: 200, y: 330 },
          { x: 400, y: 330 },
          { x: 200, y: 430 },
          { x: 400, y: 430 },
        ],
        triangles: [
          [0, 1, 2],
          [1, 3, 2],
        ] as [number, number, number][],
        uvs: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 0, y: 1 },
          { x: 1, y: 1 },
        ],
      };
      project.model.meshes.push(bodyMesh);
      project.model.parts.push(makePart('body', { name: '服と肩', meshId: bodyMesh.id, assetId: 'bodyAsset' }));
      project.model.drawOrder.unshift('body');
      project.assets.push(makeAsset('bodyAsset', { width: 200, height: 100, offset: { x: 200, y: 330 } }));
      project.model.parts.find((p) => p.id === 'hair')!.name = '長い髪・振り子と風鈴と目と鍵が隠れない長い名前';
      const points: CurveGuide['points'] = [
        { x: 300, y: 200 },
        { x: 300, y: 300 },
        { x: 300, y: 400 },
      ];
      project.model.curveGuides = [
        {
          id: 'g',
          partId: 'hair',
          meshId: 'm',
          meshSignature: curveMeshSignature(project.model.meshes[0]!),
          reference: points,
          points,
          radius: 70,
          rootFraction: 0.15,
          gravity: true,
          enabled: true,
        },
      ];
      await page.evaluate(async (p) => {
        const s = window.__studio.services;
        const texture = document.createElement('canvas');
        texture.width = 20;
        texture.height = 200;
        const ctx = texture.getContext('2d')!;
        ctx.fillStyle = '#c2a16d';
        ctx.fillRect(0, 0, 20, 200);
        const blob = await new Promise<Blob>((resolve) => texture.toBlob((v) => resolve(v!)));
        const buffer = await blob.arrayBuffer();
        for (const asset of p.assets) {
          let data = buffer;
          if (asset.id === 'bodyAsset') {
            texture.width = 200;
            texture.height = 100;
            const body = texture.getContext('2d')!;
            body.fillStyle = '#507b8d';
            body.fillRect(0, 0, 200, 100);
            data = await (await new Promise<Blob>((resolve) => texture.toBlob((v) => resolve(v!)))).arrayBuffer();
          }
          asset.hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)))
            .map((v) => v.toString(16).padStart(2, '0'))
            .join('');
          await s.assets.put(asset.id, new Uint8Array(data));
        }
        s.store.load(p);
        s.editor.set({ mode: 'modeling', selectedPartIds: ['hair'], activeParameterIds: [], editorParamValues: {} });
      }, project);
      await page.getByRole('button', { name: '線で曲げる', exact: true }).click();
      const panel = page.locator('[data-panel-id="curveGuide"]');
      const parts = page.locator('[data-panel-id="structure.parts"]');
      const settings = page.locator('[data-panel-id="partSettings"]');
      for (const box of [panel, parts, settings]) {
        const toggle = box.locator('.panel-title .panel-toggle');
        if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
      }
      await parts.getByRole('tab', { name: 'パーツ構造', exact: true }).click();
      const flow = panel.getByLabel('流れ線で揺らす', { exact: true });
      expect(await flow.isChecked()).toBe(false);
      expect(await parts.getByRole('img', { name: /流れ揺れ：ON/ }).count()).toBe(0);
      const before = await page.getByTestId('canvas-stage').boundingBox();
      await flow.check();
      await settings.getByLabel('軸で揺らす', { exact: true }).check();
      const row = parts.locator('[role="treeitem"][data-part-id="hair"]');
      expect(await row.getByRole('img').count()).toBe(2);
      const geometry = await row.evaluate((element) => {
        const rowBox = element.getBoundingClientRect();
        const icons = Array.from(element.querySelectorAll<HTMLElement>('.part-sway-badge')).map((icon) => {
          const b = icon.getBoundingClientRect(),
            svg = icon.querySelector('svg')!;
          return {
            label: icon.getAttribute('aria-label'),
            width: b.width,
            height: b.height,
            inside: b.left >= rowBox.left && b.right <= rowBox.right,
            stroke: getComputedStyle(svg).stroke,
            color: getComputedStyle(icon).color,
          };
        });
        const name = element.querySelector<HTMLElement>('.part-name')!;
        return { icons, truncated: name.scrollWidth > name.clientWidth };
      });
      expect(geometry.icons.map((i) => i.label)).toEqual([
        `${project.model.parts[1]!.name}：軸揺れ：ON`,
        `${project.model.parts[1]!.name}：流れ揺れ：ON`,
      ]);
      geometry.icons.forEach((i) => {
        expect(i.width).toBe(14);
        expect(i.height).toBe(14);
        expect(i.inside).toBe(true);
        expect(i.stroke).toBe(i.color);
      });
      expect(geometry.truncated).toBe(true);
      await panel.scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(EVIDENCE, `settings-${size.width}.png`) });
      await parts.screenshot({ path: join(EVIDENCE, `badges-${size.width}.png`) });
      await settings.getByLabel('軸で揺らす', { exact: true }).uncheck();
      expect(await row.getByRole('img', { name: /流れ揺れ：ON/ }).count()).toBe(1);
      expect(await flow.isChecked()).toBe(true);
      await settings.getByLabel('軸で揺らす', { exact: true }).check();
      const collision = panel.getByLabel('肩に当てる（衝突判定）', { exact: true });
      expect(await collision.isChecked()).toBe(false);
      const modelPoint = async (x: number, y: number) =>
        page.evaluate(
          ({ x, y }) => {
            const view = window.__studio.canvas.getState().view;
            const box = document.querySelector('[data-testid="canvas-overlay"]')!.getBoundingClientRect();
            return { x: box.left + view.offset.x + x * view.scale, y: box.top + view.offset.y + y * view.scale };
          },
          { x, y },
        );
      await panel.getByRole('button', { name: '肩の線を追加', exact: true }).click();
      const start = await modelPoint(240, 350),
        end = await modelPoint(288, 350);
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(end.x, end.y, { steps: 8 });
      await page.keyboard.press('Escape');
      await page.mouse.up();
      expect(await page.evaluate(() => window.__studio.services.store.get().model.shoulderColliders?.length ?? 0)).toBe(
        0,
      );
      await panel.getByRole('button', { name: '肩の線を追加', exact: true }).click();
      await page.mouse.click(start.x, start.y);
      await page.mouse.click(end.x, end.y);
      await page.waitForFunction(() => window.__studio.services.store.get().model.shoulderColliders?.length === 1);
      expect(await collision.isChecked()).toBe(false);
      const shoulders = await page.evaluate(() => window.__studio.services.store.get().model.shoulderColliders);
      await page.getByTestId('canvas-overlay').focus();
      await page.keyboard.press('Control+z');
      expect(await page.evaluate(() => window.__studio.services.store.get().model.shoulderColliders?.length ?? 0)).toBe(
        0,
      );
      await page.keyboard.press('Control+y');
      expect(await page.evaluate(() => window.__studio.services.store.get().model.shoulderColliders)).toEqual(
        shoulders,
      );
      await collision.check();
      await page.waitForFunction(() =>
        ['ok', 'limited'].includes(window.__studio.canvas.lastDeformed()?.curveGuides?.g?.collision?.status ?? ''),
      );
      await panel.getByRole('button', { name: '肩の線 1を編集', exact: true }).click();
      await page.screenshot({ path: join(EVIDENCE, `shoulder-${size.width}.png`) });
      await flow.uncheck();
      expect(await collision.isChecked()).toBe(true);
      expect(await row.getByRole('img', { name: /軸揺れ：ON/ }).count()).toBe(1);
      await flow.check();
      await collision.uncheck();
      expect(await flow.isChecked()).toBe(true);
      const ids = await page.evaluate(
        () => window.__studio.services.store.get().model.curveGuides![0]!.collision!.colliderIds,
      );
      expect(ids).toHaveLength(1);
      await collision.check();
      const saved = await page.evaluate(() => window.__studio.services.store.get());
      const editor = await page.evaluate(() => window.__studio.services.editor.get().editorParamValues);
      await panel.getByRole('button', { name: '動きを試す', exact: true }).click();
      await page.waitForFunction(
        () =>
          window.__studio.canvas.getState().motionPreview !== null && !!window.__studio.canvas.getState().motionPreview,
      );
      const samples = await page.evaluate(async () => {
        const values: { tip: { x: number; y: number }; status: string; collision: string }[] = [];
        for (let i = 0; i < 65; i++) {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          const g = window.__studio.canvas.lastDeformed()?.curveGuides?.g;
          if (g)
            values.push({
              tip: g.curve.at(-1)!,
              status: g.dynamics?.status ?? '',
              collision: g.collision?.status ?? '',
            });
        }
        return values;
      });
      expect(samples.some((s) => s.status === 'running')).toBe(true);
      expect(samples.every((s) => ['ok', 'limited'].includes(s.collision))).toBe(true);
      await page.screenshot({ path: join(EVIDENCE, `playing-${size.width}.png`) });
      await page.getByRole('button', { name: '選択・変形', exact: true }).click();
      expect(await panel.count()).toBe(0);
      expect(await page.evaluate(() => !!window.__studio.canvas.getState().motionPreview)).toBe(true);
      await page.getByRole('button', { name: '線で曲げる', exact: true }).click();
      await panel.getByRole('button', { name: '動きを止める', exact: true }).click();
      await page.waitForFunction(() => !window.__studio.canvas.getState().motionPreview);
      expect(await page.evaluate(() => window.__studio.services.store.get())).toEqual(saved);
      expect(await page.evaluate(() => window.__studio.services.editor.get().editorParamValues)).toEqual(editor);
      await flow.uncheck();
      expect(await row.getByRole('img', { name: /軸揺れ：ON/ }).count()).toBe(1);
      expect(await row.getByRole('img', { name: /流れ揺れ：ON/ }).count()).toBe(0);
      await page.getByTestId('canvas-overlay').focus();
      await page.keyboard.press('Control+z');
      expect(await flow.isChecked()).toBe(true);
      if (EDGE) await page.evaluate((p) => window.__studio.services.store.load(JSON.parse(JSON.stringify(p))), saved);
      else {
        const dir = slash(join(SAVE_RUN, `project-${size.width}`));
        await page.evaluate((d) => window.__studio.project.saveAs(d), dir);
        await page.evaluate((d) => window.__studio.project.open(d), dir);
        await page.evaluate(() => {
          window.__studio.services.autoSaver.stop();
          window.__studio.services.editor.set({ selectedPartIds: ['hair'] });
        });
        expect(await page.evaluate(() => window.__studio.services.store.get().model.curveGuides)).toEqual(
          saved.model.curveGuides,
        );
        expect(await page.evaluate(() => window.__studio.services.store.get().physics)).toEqual(saved.physics);
        expect(await page.evaluate(() => window.__studio.services.store.get().model.shoulderColliders)).toEqual(
          saved.model.shoulderColliders,
        );
      }
      expect(await row.getByRole('img').count()).toBe(2);
      await panel.getByLabel('重力に沿わせる', { exact: true }).uncheck();
      expect(await row.getByRole('img', { name: /流れ揺れ：ON.*停止中/ }).getAttribute('class')).toContain('is-paused');
      expect(await row.getByRole('img', { name: /軸揺れ：ON/ }).getAttribute('class')).not.toContain('is-paused');
      const after = await page.getByTestId('canvas-stage').boundingBox();
      expect(after).toEqual(before);
      writeFileSync(
        join(EVIDENCE, `measure-${size.width}.json`),
        JSON.stringify({ geometry, samples, before, after }, null, 2),
      );
      expect(errors).toEqual([]);
    });
});
