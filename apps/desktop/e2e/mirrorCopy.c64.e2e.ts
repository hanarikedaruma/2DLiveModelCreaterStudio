// カード72・CO引き継ぎ: 左右反転コピーの実画面操作と、本物の評価・変形処理を確認する。
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { createEmptyProject, ensureStandardParameters, type Binding, type TransformDelta } from '@app/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launchApp, waitForStartup, ROOT, type RunningApp, type StudioHook } from './app';

const EDGE = process.env.C64_BROWSER === 'edge';
const EVIDENCE = join(ROOT, '.cache', 'verification', 'co-step3-handoff-2026-10-07', 'mirror-copy');
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
    await page.goto(process.env.C64_DEV_URL ?? 'http://127.0.0.1:1435/');
    await page.waitForFunction(() => '__studio' in window);
  } else {
    app = await launchApp(9347);
    page = app.page;
  }
  page.on('pageerror', (error) => errors.push(error.message));
  await waitForStartup(page);
  environment = await page.evaluate(() => window.__studio.environment.get());
  collapsed = await page.evaluate(() => localStorage.getItem('live2d-studio.collapsedPanels'));
  await page.evaluate(() => window.__studio.services.autoSaver.stop());
}, 180_000);

afterAll(async () => {
  if (page) {
    await page
      .evaluate(
        async ({ previous, panels }) => {
          if (previous) {
            window.__studio.environment.set(previous);
            await window.__studio.environment.flush();
          }
          if (panels === null) localStorage.removeItem('live2d-studio.collapsedPanels');
          else localStorage.setItem('live2d-studio.collapsedPanels', panels);
        },
        { previous: environment, panels: collapsed },
      )
      .catch(() => {});
  }
  await app?.close();
  await browser?.close();
});

describe('カード64: 実画面から左右反転コピーする', () => {
  for (const size of [
    { width: 1440, height: 1000 },
    { width: 800, height: 600 },
  ]) {
    it(`${size.width}×${size.height}: 向き・傾き・L/R・ユーザー定義のキーと素材を写し、1回のUndoで戻る`, async () => {
      await page.setViewportSize(size);
      // 生成前の見本JSONにはメッシュが無いので、実PSDの取り込み・割り当てを通す。
      const blank = createEmptyProject('カード64の実操作');
      blank.model = ensureStandardParameters(blank.model, 'step2');
      await page.evaluate((project) => {
        const s = window.__studio.services;
        s.store.load(project);
        s.editor.set({ mode: 'modeling' });
      }, blank);
      await page
        .locator('input[type=file]')
        .first()
        .setInputFiles(join(ROOT, 'fixtures', 'sample-model', 'sample-model.psd'));
      await page.waitForFunction(() => window.__studio.services.store.get().assets.length === 28);
      const project = await page.evaluate(() => {
        const { services: s, modeling } = window.__studio;
        for (const asset of s.store.get().assets)
          modeling.assignAssets(s, { kind: 'standard', type: asset.source.layerName ?? '' }, [asset.id]);
        return s.store.get();
      });
      const original = project.model.parts.find((p) => p.standardType === 'irisR')!;
      expect(original.meshId).not.toBeNull();
      project.model.parameters.push({
        id: 'CustomAngle',
        name: '独自の角度',
        groupId: 'other',
        min: -1,
        max: 1,
        default: 0,
        standard: false,
      });
      const binding = (id: string, values: [number, number, number][]): Binding => ({
        id: `c64-${id}`,
        target: { type: 'part', id: original.id },
        channel: 'transform',
        parameterIds: [id],
        keyValues: [values.map(([v]) => v)],
        generation: 'linear',
        divisions: null,
        keys: values.map(([v, x, rotation]) => ({
          coords: [v],
          delta: { position: { x, y: 0 }, rotation, scale: { x: 1, y: 1 }, opacity: 1 } satisfies TransformDelta,
          source: 'manual',
          locked: false,
        })),
      });
      project.model.bindings = [
        binding('EyeBallX', [
          [-1, -6, 0],
          [0, 0, 0],
          [1, 6, 0],
        ]),
        binding('FaceAngleX', [
          [-30, -4, 0],
          [0, 0, 0],
          [30, 10, 0],
        ]),
        binding('FaceAngleZ', [
          [-30, 0, -8],
          [0, 0, 0],
          [30, 0, 12],
        ]),
        binding('BodyAngleX', [
          [-10, -2, 0],
          [0, 0, 0],
          [10, 5, 0],
        ]),
        binding('BodyAngleZ', [
          [-10, 0, -8],
          [0, 0, 0],
          [10, 0, 12],
        ]),
        binding('MouthOpen', [
          [0, 0, 0],
          [1, 2, 0],
        ]),
        binding('FaceAngleY', [
          [-30, -3, 0],
          [0, 0, 0],
          [30, 4, 0],
        ]),
        binding('CustomAngle', [
          [-1, -3, 0],
          [0, 0, 0],
          [1, 4, 0],
        ]),
        binding('EyeOpenR', [
          [0, 3, 0],
          [1, 0, 0],
        ]),
      ];
      await page.evaluate((model) => {
        const s = window.__studio.services;
        s.store.load(model);
        s.editor.set({ mode: 'modeling', selectedPartIds: [], activeParameterIds: [], editorParamValues: {} });
      }, project);
      const row = page.locator(`[data-part-id="${original.id}"]`);
      await row.click({ button: 'right' });
      await page.getByRole('menuitem', { name: '左右反転コピー', exact: true }).click();
      await page.waitForFunction(
        (count) => window.__studio.services.store.get().model.parts.length === count + 1,
        project.model.parts.length,
      );
      const copied = await page.evaluate(
        (ids) => window.__studio.services.store.get().model.parts.find((p) => !ids.includes(p.id))!,
        project.model.parts.map((p) => p.id),
      );
      expect(copied.standardType).toBe('irisL');
      expect(copied.assetId).not.toBe(original.assetId);
      expect(copied.meshId).not.toBe(original.meshId);
      for (const [parameter, value, x, rotation] of [
        ['EyeBallX', 1, 6, 0],
        ['EyeBallX', -1, -6, 0],
        ['FaceAngleX', 30, 4, 0],
        ['FaceAngleX', -30, -10, 0],
        ['FaceAngleZ', 30, 0, 8],
        ['BodyAngleX', 10, 2, 0],
        ['BodyAngleZ', 10, 0, 8],
        ['MouthOpen', 1, -2, 0],
        ['FaceAngleY', 30, -4, 0],
        ['CustomAngle', 1, -4, 0],
        ['EyeOpenL', 0, -3, 0],
      ] as const) {
        const actual = await page.evaluate(
          ({ parameter, value, originalId, copyId }) => {
            const s = window.__studio.services;
            const model = s.store.get().model;
            const defaults = Object.fromEntries(model.parameters.map((p) => [p.id, p.default]));
            const base = s.pipeline.deform(model, s.evaluator.evaluate(model, defaults));
            const evaluated = s.evaluator.evaluate(model, { ...defaults, [parameter]: value });
            const moved = s.pipeline.deform(model, evaluated);
            const meanX = (id: string, output: typeof moved) => {
              const positions = output.byPartId[id]!.positions;
              let sum = 0;
              for (let i = 0; i < positions.length; i += 2) sum += positions[i]!;
              return sum / (positions.length / 2);
            };
            s.editor.set({ editorParamValues: { [parameter]: value } });
            return {
              x: evaluated.transforms[copyId]?.position.x ?? 0,
              rotation: evaluated.transforms[copyId]?.rotation ?? 0,
              originalX: meanX(originalId, moved) - meanX(originalId, base),
              copiedX: meanX(copyId, moved) - meanX(copyId, base),
            };
          },
          { parameter, value, originalId: original.id, copyId: copied.id },
        );
        expect(actual.x).toBeCloseTo(x, 6);
        expect(actual.rotation).toBeCloseTo(rotation, 6);
        if (parameter === 'EyeBallX') {
          expect(actual.originalX).toBeCloseTo(value * 6, 6);
          expect(actual.copiedX).toBeCloseTo(value * 6, 6);
        }
      }
      await page.screenshot({ path: join(EVIDENCE, `${EDGE ? 'edge' : 'native'}-${size.width}.png`) });
      await page.keyboard.press('Control+z');
      expect(await page.evaluate(() => window.__studio.services.store.get())).toEqual(project);
      expect(errors).toEqual([]);
    });
  }
});
