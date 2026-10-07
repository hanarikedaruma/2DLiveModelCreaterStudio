// カード62の実PSD確認。CLの未実施分をCOが引き継ぐ。既存のNative e2eで実行する。
// C62_BROWSER=edge の場合は既存の開発サーバーで同じ操作をEdgeの2サイズで確認する。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { createEmptyProject, ensureStandardParameters, type Asset, type Mesh, type Project } from '@app/schema';
import { answerDialog, launchApp, ROOT, type RunningApp, type StudioHook } from './app';

interface Pixels {
  data: Uint8ClampedArray;
}
interface PsdCanvas {
  width: number;
  height: number;
  getContext(kind: '2d'): {
    fillStyle: string;
    fillRect(x: number, y: number, width: number, height: number): void;
    drawImage(canvas: PsdCanvas, x: number, y: number): void;
    getImageData(x: number, y: number, width: number, height: number): Pixels;
    putImageData(pixels: Pixels, x: number, y: number): void;
  };
}
interface PsdLayer {
  name?: string;
  left?: number;
  top?: number;
  right?: number;
  bottom?: number;
  canvas?: PsdCanvas;
}
interface TestPsd {
  width: number;
  height: number;
  children: PsdLayer[];
}
// fixturesにすでにあるPSD・canvasの道具を使う。依存や新しい生成コマンドを足さない。
const fixtureRequire = createRequire(join(ROOT, 'fixtures', 'package.json'));
const { createCanvas } = fixtureRequire('@napi-rs/canvas') as {
  createCanvas(width: number, height: number): PsdCanvas;
};
const { initializeCanvas, readPsd, writePsdUint8Array } = fixtureRequire('ag-psd') as {
  initializeCanvas(create: (width: number, height: number) => PsdCanvas): void;
  readPsd(bytes: Uint8Array): TestPsd;
  writePsdUint8Array(psd: TestPsd, options: { generateThumbnail: boolean }): Uint8Array;
};
initializeCanvas(createCanvas);

const PSD = join(ROOT, 'fixtures', 'sample-model', 'sample-model.psd');
const EVIDENCE = join(ROOT, '.cache', 'verification', 'co-step3-handoff-2026-10-07', 'psd-reload');
const EDGE = process.env.C62_BROWSER === 'edge';
let app: RunningApp | null = null;
let browser: Browser | null = null;
let page: Page;
let previousEnvironment: ReturnType<StudioHook['environment']['get']> | null = null;
let previousCollapsed: string | null = null;
const errors: string[] = [];

beforeAll(async () => {
  mkdirSync(EVIDENCE, { recursive: true });
  if (EDGE) {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    page = await browser.newPage();
    await page.goto(process.env.C62_DEV_URL ?? 'http://127.0.0.1:1435/');
    await page.waitForFunction(() => '__studio' in window);
  } else {
    app = await launchApp(9346);
    page = app.page;
  }
  page.on('pageerror', (error) => errors.push(error.message));
  while ((await answerDialog(page, 'キャンセル', 1000)) !== null) {
    // 利用者の自動保存は復元しない。
  }
  previousEnvironment = await page.evaluate(() => window.__studio.environment.get());
  previousCollapsed = await page.evaluate(() => localStorage.getItem('live2d-studio.collapsedPanels'));
  await page.evaluate(() => window.__studio.services.autoSaver.stop());
}, 180_000);

afterAll(async () => {
  if (page) {
    await page
      .evaluate(
        async ({ environment, collapsed }) => {
          if (environment) {
            window.__studio.environment.set(environment);
            await window.__studio.environment.flush();
          }
          if (collapsed === null) localStorage.removeItem('live2d-studio.collapsedPanels');
          else localStorage.setItem('live2d-studio.collapsedPanels', collapsed);
        },
        { environment: previousEnvironment, collapsed: previousCollapsed },
      )
      .catch(() => {});
  }
  await app?.close();
  await browser?.close();
});

function recolor(layer: PsdLayer) {
  const canvas = layer.canvas!;
  const ctx = canvas.getContext('2d');
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    if (pixels.data[i + 3]! > 0) pixels.data[i] = 255 - pixels.data[i]!;
  }
  ctx.putImageData(pixels, 0, 0);
}

function variant(label: string, change: (psd: TestPsd) => void) {
  const psd = readPsd(readFileSync(PSD));
  change(psd);
  const file = join(EVIDENCE, `${label}.psd`);
  writeFileSync(file, writePsdUint8Array(psd, { generateThumbnail: false }));
  return file;
}

type Geometry = { mesh: Mesh; asset: Asset };
function covered(mesh: Mesh, x: number, y: number) {
  return mesh.triangles.some(([a, b, c]) => {
    const va = mesh.vertices[a]!;
    const vb = mesh.vertices[b]!;
    const vc = mesh.vertices[c]!;
    const cross = (p: typeof va, q: typeof va) => (q.x - p.x) * (y - p.y) - (q.y - p.y) * (x - p.x);
    const signs = [cross(va, vb), cross(vb, vc), cross(vc, va)];
    return signs.every((v) => v >= -1e-7) || signs.every((v) => v <= 1e-7);
  });
}

function paintedGap(geometry: Geometry, label: string) {
  let pixel: { x: number; y: number } | null = null;
  const file = variant(label, (psd) => {
    const layer = psd.children.find((l) => l.name === 'frontHair')!;
    const ctx = layer.canvas!.getContext('2d');
    const shiftX = geometry.asset.offset.x - (layer.left ?? 0);
    const shiftY = geometry.asset.offset.y - (layer.top ?? 0);
    const raw = ctx.getImageData(0, 0, layer.canvas!.width, layer.canvas!.height).data;
    const alpha = (x: number, y: number) => raw[((shiftY + y) * layer.canvas!.width + shiftX + x) * 4 + 3] ?? 0;
    for (let y = 2; y < geometry.asset.height - 2 && !pixel; y += 2) {
      for (let x = 2; x < geometry.asset.width - 2; x += 2) {
        if (alpha(x, y) > 0) continue;
        const mx = geometry.asset.offset.x + x + 0.5;
        const my = geometry.asset.offset.y + y + 0.5;
        if (covered(geometry.mesh, mx, my)) continue;
        pixel = { x: mx, y: my };
        ctx.fillStyle = '#ff0099';
        // 小さい孤立した点として除かれないよう、既存の毛束から3px幅で塗り足す。
        let nearest = { x: 0, y: 0, distance: Infinity };
        for (let oy = 1; oy < geometry.asset.height - 1; oy += 2) {
          for (let ox = 1; ox < geometry.asset.width - 1; ox += 2) {
            if (alpha(ox, oy) === 0) continue;
            const distance = (ox - x) ** 2 + (oy - y) ** 2;
            if (distance < nearest.distance) nearest = { x: ox, y: oy, distance };
          }
        }
        expect(nearest.distance).toBeLessThan(Infinity);
        const steps = Math.ceil(Math.sqrt(nearest.distance));
        for (let i = 0; i <= steps; i++) {
          ctx.fillRect(
            shiftX + Math.round(x + ((nearest.x - x) * i) / steps) - 1,
            shiftY + Math.round(y + ((nearest.y - y) * i) / steps) - 1,
            3,
            3,
          );
        }
        break;
      }
    }
    expect(pixel, '同じ外接矩形の透明な所で、旧メッシュの外に描き足す').not.toBeNull();
  });
  return { file, pixel: pixel! };
}

async function snapshot() {
  return page.evaluate(() => window.__studio.services.store.get());
}

async function geometry(type: string): Promise<Geometry> {
  return page.evaluate((standardType) => {
    const p = window.__studio.services.store.get();
    const part = p.model.parts.find((item) => item.standardType === standardType)!;
    return {
      mesh: p.model.meshes.find((m) => m.id === part.meshId)!,
      asset: p.assets.find((a) => a.id === part.assetId)!,
    };
  }, type);
}

async function reload(file: string) {
  await page.getByLabel('読み込み直す PSD ファイル', { exact: true }).setInputFiles(file);
  await page.getByRole('status', { name: '再読み込みの結果' }).waitFor({ state: 'visible' });
}

async function undo(expected: Project) {
  await page.locator('.app-title').click();
  await page.keyboard.press('Control+z');
  await expect.poll(snapshot).toEqual(expected);
  await page.getByRole('status', { name: '再読み込みの結果' }).waitFor({ state: 'detached' });
}

async function importSample() {
  const blank = createEmptyProject('カード62の実PSD確認');
  blank.model = ensureStandardParameters(blank.model, 'step2');
  await page.evaluate((project) => {
    const s = window.__studio.services;
    s.store.load(project);
    s.editor.set({ mode: 'modeling' });
  }, blank);
  await page.locator('input[type=file]').first().setInputFiles(PSD);
  await page.waitForFunction(() => window.__studio.services.store.get().assets.length === 28);
  await page.evaluate(() => {
    const { services: s, modeling } = window.__studio;
    for (const asset of s.store.get().assets)
      modeling.assignAssets(s, { kind: 'standard', type: asset.source.layerName ?? '' }, [asset.id]);
    const p = s.store.get();
    const bindings = ['frontHair', 'torso'].map((type) => {
      const part = p.model.parts.find((item) => item.standardType === type)!;
      const mesh = p.model.meshes.find((item) => item.id === part.meshId)!;
      return {
        id: `c62-shear-${type}`,
        target: { type: 'mesh' as const, id: mesh.id },
        channel: 'vertices' as const,
        parameterIds: [type === 'frontHair' ? 'FaceAngleX' : 'BodyAngleZ'],
        keyValues: [[0, 10]],
        keys: [
          { coords: [0], delta: mesh.vertices.map(() => ({ x: 0, y: 0 })), source: 'manual' as const, locked: false },
          { coords: [10], delta: mesh.vertices.map(() => ({ x: 7, y: 3 })), source: 'manual' as const, locked: true },
        ],
        generation: 'linear' as const,
        divisions: null,
      };
    });
    s.store.load({ ...p, model: { ...p.model, bindings: [...p.model.bindings, ...bindings] } });
    s.editor.set({ mode: 'modeling' });
  });
  const detail = page.getByRole('button', { name: '詳細', exact: true });
  if (await detail.count()) await detail.click();
  const trayToggle = page.locator('[data-panel-id="assets.tray"] .panel-title button');
  if ((await trayToggle.getAttribute('aria-expanded')) === 'false') await trayToggle.click();
  await page.getByRole('button', { name: 'PSD を読み込み直す', exact: true }).waitFor();
}

function assertTransferred(project: Project, type: string) {
  const part = project.model.parts.find((p) => p.standardType === type)!;
  const mesh = project.model.meshes.find((m) => m.id === part.meshId)!;
  const binding = project.model.bindings.find((b) => b.id === `c62-shear-${type}`)!;
  expect(binding.keys[1]!.locked).toBe(true);
  expect(binding.keys[1]!.source).toBe('manual');
  expect(binding.keys[1]!.coords).toEqual([10]);
  const deltas = binding.keys[1]!.delta;
  expect(Array.isArray(deltas)).toBe(true);
  if (!Array.isArray(deltas)) throw new Error('頂点キーでない');
  expect(deltas).toHaveLength(mesh.vertices.length);
  mesh.vertices.forEach((_, i) => {
    expect(deltas[i]!.x).toBeCloseTo(7, 2);
    expect(deltas[i]!.y).toBeCloseTo(3, 2);
  });
}

describe('カード62: 実PSDの再読み込みとUndo（UC-30・UC-CH-27）', () => {
  for (const [width, height] of [
    [1440, 1000],
    [800, 600],
  ] as const) {
    it(`${width}×${height}: 絵・大きさ・追加・欠落、同じ大きさの描き足し、瞳の位置を実ファイルから更新する`, async () => {
      await page.setViewportSize({ width, height });
      await importSample();
      const original = await snapshot();
      const revised = variant(`uc30-${width}`, (psd) => {
        recolor(psd.children.find((l) => l.name === 'frontHair')!);
        const torso = psd.children.find((l) => l.name === 'torso')!;
        const old = torso.canvas!;
        torso.canvas = createCanvas(old.width, old.height + 30);
        torso.canvas.getContext('2d').drawImage(old, 0, 0);
        torso.canvas.getContext('2d').fillStyle = '#ff0099';
        torso.canvas.getContext('2d').fillRect(0, old.height, old.width, 30);
        const ribbon = createCanvas(24, 30);
        ribbon.getContext('2d').fillStyle = '#0088ff';
        ribbon.getContext('2d').fillRect(0, 0, 24, 30);
        psd.children = psd.children.filter((l) => l.name !== 'tongue');
        psd.children.push({ name: 'ribbon', left: 250, top: 250, canvas: ribbon });
      });
      await reload(revised);
      const result = page.getByRole('status', { name: '再読み込みの結果' });
      expect(await result.locator('[data-reload-group="updated"]').innerText()).toContain('frontHair');
      expect(await result.locator('[data-reload-group="updated"]').innerText()).toContain(
        'メッシュを作り直して変形を移した',
      );
      expect(await result.locator('[data-reload-group="added"]').innerText()).toContain('ribbon');
      expect(await result.locator('[data-reload-group="missing"]').innerText()).toContain('tongue');
      const updated = await snapshot();
      expect(updated.model.parts.some((p) => p.standardType === 'tongue')).toBe(true);
      assertTransferred(updated, 'frontHair');
      assertTransferred(updated, 'torso');
      await page.screenshot({ path: join(EVIDENCE, `${EDGE ? 'edge' : 'native'}-uc30-${width}.png`) });
      await undo(original);

      const oldGeometry = await geometry('frontHair');
      const filled = paintedGap(oldGeometry, `gap-${width}`);
      await reload(filled.file);
      const alert = result.getByRole('alert');
      expect(await alert.innerText()).toContain('frontHair');
      const reloaded = await snapshot();
      const newAsset = (await geometry('frontHair')).asset;
      expect([newAsset.width, newAsset.height, newAsset.offset]).toEqual([
        oldGeometry.asset.width,
        oldGeometry.asset.height,
        oldGeometry.asset.offset,
      ]);
      await result.getByRole('button', { name: '描き足した素材のメッシュをまとめて作り直す' }).click();
      expect(await answerDialog(page, 'OK')).not.toBeNull();
      await expect
        .poll(async () => covered((await geometry('frontHair')).mesh, filled.pixel.x, filled.pixel.y))
        .toBe(true);
      assertTransferred(await snapshot(), 'frontHair');
      await page.screenshot({ path: join(EVIDENCE, `${EDGE ? 'edge' : 'native'}-gap-${width}.png`) });
      await undo(reloaded);
      await page.locator('.app-title').click();
      await page.keyboard.press('Control+z');
      await expect.poll(snapshot).toEqual(original);

      const moved = variant(`iris-${width}`, (psd) => {
        const iris = psd.children.find((l) => l.name === 'irisL')!;
        iris.left = (iris.left ?? 0) + 15;
        iris.top = (iris.top ?? 0) + 5;
        iris.right = (iris.right ?? 0) + 15;
        iris.bottom = (iris.bottom ?? 0) + 5;
      });
      const oldIris = original.model.parts.find((p) => p.standardType === 'irisL')!;
      const oldIrisMesh = (await geometry('irisL')).mesh;
      await reload(moved);
      const movedProject = await snapshot();
      const iris = movedProject.model.parts.find((p) => p.id === oldIris.id)!;
      expect(iris.pivot).toEqual({ x: oldIris.pivot.x + 15, y: oldIris.pivot.y + 5 });
      const movedMesh = (await geometry('irisL')).mesh;
      movedMesh.vertices.forEach((v, i) => {
        expect(v.x - iris.pivot.x).toBeCloseTo(oldIrisMesh.vertices[i]!.x - oldIris.pivot.x, 6);
        expect(v.y - iris.pivot.y).toBeCloseTo(oldIrisMesh.vertices[i]!.y - oldIris.pivot.y, 6);
      });
      expect(movedProject.model.parts.filter((p) => p.id !== iris.id)).toEqual(
        original.model.parts.filter((p) => p.id !== iris.id),
      );
      await page.screenshot({ path: join(EVIDENCE, `${EDGE ? 'edge' : 'native'}-iris-${width}.png`) });
      await undo(original);

      // UC-30の最後: 同名の2レイヤーでも、描き直した下の1枚だけが対応する枠へ入る。
      const duplicatePsd = (changed: boolean) =>
        variant(`duplicates-${changed ? 'updated' : 'original'}-${width}`, (psd) => {
          psd.children = [0, 1].map((i) => {
            const canvas = createCanvas(24, 24);
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = i === 0 ? (changed ? '#ff8800' : '#ff0088') : '#0088ff';
            ctx.fillRect(0, 0, 24, 24);
            return { name: 'duplicate', left: 150 + i * 60, top: 300, canvas };
          });
        });
      const duplicateOriginal = duplicatePsd(false);
      const duplicateUpdated = duplicatePsd(true);
      const empty = createEmptyProject('同名レイヤーの再読み込み');
      empty.model = ensureStandardParameters(empty.model, 'step2');
      await page.evaluate((p) => window.__studio.services.store.load(p), empty);
      await page.locator('input[type=file]').first().setInputFiles(duplicateOriginal);
      await page.waitForFunction(() => window.__studio.services.store.get().assets.length === 2);
      await page.evaluate(() => {
        const { services: s, modeling } = window.__studio;
        for (const [i, asset] of s.store.get().assets.entries()) {
          modeling.assignAssets(s, { kind: 'free', partId: null, name: `同名レイヤー${i + 1}` }, [asset.id]);
        }
      });
      const beforeDuplicate = await snapshot();
      expect(beforeDuplicate.model.parts).toHaveLength(2);
      expect(beforeDuplicate.assets.filter((a) => a.offset.x === 150)).toHaveLength(1);
      await reload(duplicateUpdated);
      const afterDuplicate = await snapshot();
      for (const oldPart of beforeDuplicate.model.parts) {
        const oldAsset = beforeDuplicate.assets.find((a) => a.id === oldPart.assetId)!;
        const samePart = afterDuplicate.model.parts.find((p) => p.id === oldPart.id)!;
        const newAsset = afterDuplicate.assets.find((a) => a.id === samePart.assetId)!;
        if (oldAsset.offset.x === 150) expect(newAsset.hash).not.toBe(oldAsset.hash);
        else expect(newAsset.hash).toBe(oldAsset.hash);
      }
      expect(await result.locator('[data-reload-group="updated"] .layer-names > li').count()).toBe(1);
      await page.screenshot({ path: join(EVIDENCE, `${EDGE ? 'edge' : 'native'}-duplicates-${width}.png`) });
      await undo(beforeDuplicate);
      expect(errors).toEqual([]);
    }, 180_000);
  }
});
