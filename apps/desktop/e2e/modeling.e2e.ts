// モデリングの通しのテスト（カード23）。VITE_E2E=1 でビルドした本物のアプリ（Tauri + WebView2）を、
// WebView2 のリモートデバッグ（CDP）経由で Playwright から操作する。実行は `pnpm e2e`（e2e/run.mjs）
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { answerDialog, launchApp, RESULTS, ROOT, sleep, slash, type RunningApp } from './app';

const PSD = join(ROOT, 'fixtures', 'sample-model', 'sample-model.psd');

let app: RunningApp | null = null;
let page: Page;
let workDir = '';
let previousLastProjectDir: string | null = null;
let previousCollapsedPanels: string | null = null;

// FaceAngleX を値 v にしたときのパーツの x の平均の移動量（0 との差）
function shiftsAt(v: number) {
  return page.evaluate((value) => {
    const s = window.__studio.services;
    const model = s.store.get().model;
    const deformAt = (x: number) => {
      const params: Record<string, number> = {};
      for (const p of model.parameters) params[p.id] = p.default;
      params.FaceAngleX = x;
      return s.pipeline.deform(model, s.evaluator.evaluate(model, params));
    };
    const meanX = (d: ReturnType<typeof deformAt>, type: string) => {
      const part = model.parts.find((p) => p.standardType === type);
      const item = part ? d.byPartId[part.id] : undefined;
      if (!item) return NaN;
      let sum = 0;
      for (let i = 0; i < item.positions.length; i += 2) sum += item.positions[i]!;
      return sum / (item.positions.length / 2);
    };
    const base = deformAt(0);
    const turned = deformAt(value);
    return {
      face: meanX(turned, 'face') - meanX(base, 'face'),
      frontHair: meanX(turned, 'frontHair') - meanX(base, 'frontHair'),
      backHair: meanX(turned, 'backHair') - meanX(base, 'backHair'),
    };
  }, v);
}

beforeAll(async () => {
  if (!existsSync(PSD)) throw new Error(`PSD が無い: ${PSD}（pnpm --filter @app/fixtures generate:psd）`);
  mkdirSync(RESULTS, { recursive: true });
  workDir = mkdtempSync(join(tmpdir(), 'live2d-studio-e2e-'));
  app = await launchApp(9333);
  page = app.page;
  previousLastProjectDir = await page.evaluate(() => window.__studio.environment.get().lastProjectDir);
  previousCollapsedPanels = await page.evaluate(() => localStorage.getItem('live2d-studio.collapsedPanels'));
  // 起動時に前回の自動保存の復元を聞かれたら断る（テストの前の状態に左右されないように）
  while ((await answerDialog(page, 'キャンセル', 2000)) !== null) {
    // 断り続ける
  }
}, 180_000);

afterAll(async () => {
  if (page) {
    await page
      .evaluate((previous) => {
        const key = 'live2d-studio.collapsedPanels';
        if (previous === null) localStorage.removeItem(key);
        else localStorage.setItem(key, previous);
      }, previousCollapsedPanels)
      .catch(() => {});
    // 利用者の環境設定に、消してしまうテストのフォルダを残さない
    await page
      .evaluate(async (dir) => {
        window.__studio.environment.set({ lastProjectDir: dir });
        await window.__studio.environment.flush();
      }, previousLastProjectDir)
      .catch(() => {});
  }
  await app?.close();
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

describe('モデリングの通し', () => {
  it('PSD を取り込み → 割り当て → かんたんセットアップ → 顔の向き → Undo → 保存 → 開き直し', async () => {
    // 1. セットアップ画面のファイルの入力から PSD を取り込む
    await page.locator('input[type=file]').first().setInputFiles(PSD);
    await page.waitForFunction(() => window.__studio.services.store.get().assets.length === 28, null, {
      timeout: 30_000,
    });
    const layerNames = await page.evaluate(() =>
      window.__studio.services.store.get().assets.map((a) => a.source.layerName),
    );
    expect(layerNames).toContain('frontHair');

    // 2. スクリプトで標準パーツへ割り当てる（レイヤー名 = standardType）
    await page.evaluate(() => {
      const { services, modeling } = window.__studio;
      for (const a of services.store.get().assets) {
        modeling.assignAssets(services, { kind: 'standard', type: a.source.layerName ?? '' }, [a.id]);
      }
    });
    const assigned = await page.evaluate(() => {
      const m = window.__studio.services.store.get().model;
      return { parts: m.parts.length, meshes: m.meshes.length };
    });
    expect(assigned).toEqual({ parts: 28, meshes: 28 });

    // 3. 利用者がたたんでいた場合だけ割り当てのパネルを開き、[かんたんセットアップ] を押す。
    const assignToggle = page.locator('[data-panel-id="assets.assign"] .panel-title button');
    if ((await assignToggle.getAttribute('aria-expanded')) === 'false') await assignToggle.click();
    await page.getByRole('button', { name: 'かんたんセットアップ' }).click();
    await page.waitForFunction(() => window.__studio.services.store.get().model.bindings.length > 0);
    const bindingCount = await page.evaluate(() => window.__studio.services.store.get().model.bindings.length);

    // 4. FaceAngleX を ±30 にすると、顔（目鼻の寄る中ほど）と前髪がその向きへはっきり動き、後ろ髪は頭の後ろ側として
    //    逆へ動く（I-039 の根本改善: 共通の姿勢から顔・髪・耳を個別に変形する。頭全体に同じワープは掛けない）
    for (const sign of [1, -1]) {
      const shifts = await shiftsAt(30 * sign);
      expect(shifts.face * sign).toBeGreaterThan(10);
      expect(shifts.frontHair * sign).toBeGreaterThan(10);
      expect(shifts.backHair * sign).toBeLessThan(0);
    }
    const shifts = await shiftsAt(30); // 7. で開き直したあとと比べる
    await page.evaluate(() => window.__studio.services.editor.set({ editorParamValues: { FaceAngleX: 30 } }));
    await sleep(300);
    await page.screenshot({ path: join(RESULTS, 'face-angle-x-30.png') });
    await page.evaluate(() => window.__studio.services.editor.set({ editorParamValues: {} }));

    // 5. Undo（Ctrl+Z）でセットアップの前に戻り、Ctrl+Shift+Z でやり直せる
    await page.locator('.app-title').click();
    await page.keyboard.press('Control+z');
    expect(await page.evaluate(() => window.__studio.services.store.get().model.bindings.length)).toBe(0);
    await page.keyboard.press('Control+Shift+z');
    expect(await page.evaluate(() => window.__studio.services.store.get().model.bindings.length)).toBe(bindingCount);

    // 6. 保存する
    const dir = slash(join(workDir, 'project'));
    await page.evaluate((d) => window.__studio.project.saveAs(d), dir);
    expect(existsSync(join(workDir, 'project', 'project.json'))).toBe(true);
    expect(readdirSync(join(workDir, 'project', 'assets'))).toHaveLength(28);
    const saved = await page.evaluate(() => JSON.stringify(window.__studio.services.store.get()));
    expect(await page.evaluate(() => window.__studio.project.isDirty())).toBe(false);

    // 7. 開き直すと同じ内容になり、同じように動く
    await page.evaluate((d) => window.__studio.project.open(d), dir);
    const reopened = await page.evaluate(() => JSON.stringify(window.__studio.services.store.get()));
    expect(JSON.parse(reopened)).toEqual(JSON.parse(saved));
    const after = await shiftsAt(30);
    expect(after.face).toBeCloseTo(shifts.face, 3);
    expect(after.frontHair).toBeCloseTo(shifts.frontHair, 3);
    expect(after.backHair).toBeCloseTo(shifts.backHair, 3);
  }, 180_000);
});
