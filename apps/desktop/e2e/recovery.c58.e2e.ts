// カード58の受け入れテスト担当 CO。欠けた素材を、本物の Tauri アプリの一覧から差し替える。
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Page } from 'playwright';
import type { Project } from '@app/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { answerDialog, launchApp, ROOT, slash, type RunningApp } from './app';
import { decodePng } from '@app/io/src/import/png';

let app: RunningApp | null = null;
let page: Page;
let workDir = '';
let previousLastProjectDir: string | null = null;
const fixture = join(ROOT, 'fixtures', 'sample-model');

beforeAll(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'live2d-studio-c58-'));
  cpSync(fixture, workDir, { recursive: true });
  app = await launchApp(9338);
  page = app.page;
  previousLastProjectDir = await page.evaluate(() => window.__studio.environment.get().lastProjectDir);
  while ((await answerDialog(page, 'キャンセル', 2000)) !== null) {
    // 利用者の前回の自動保存は復元しない。
  }
}, 180_000);

afterAll(async () => {
  if (page) {
    await page
      .evaluate(async (dir) => {
        window.__studio.environment.set({ lastProjectDir: dir });
        await window.__studio.environment.flush();
      }, previousLastProjectDir)
      .catch(() => {});
  }
  await app?.close();
  // 自分で作った一時フォルダだけを片付ける。
  if (workDir && resolve(workDir).startsWith(`${resolve(tmpdir())}\\live2d-studio-c58-`)) {
    rmSync(workDir, { recursive: true, force: true });
  }
});

describe('カード58: 欠けた素材の復旧', () => {
  it('欠けた素材を知らせ、一覧から PNG を差し替え、Undo・Redo と保存後の開き直しができる', async () => {
    const source = JSON.parse(readFileSync(join(workDir, 'project.json'), 'utf8')) as Project;
    const asset = source.assets.find((a) => source.model.parts.some((p) => p.assetId === a.id))!;
    const affected = source.model.parts.filter((p) => p.assetId === asset.id).map((p) => p.id);
    const missingPath = resolve(workDir, asset.path);
    expect(missingPath.startsWith(`${resolve(workDir)}\\`)).toBe(true);
    rmSync(missingPath);

    await page.evaluate((dir) => window.__studio.project.open(dir), slash(workDir));
    expect(await page.evaluate(() => window.__studio.project.missingAssetIds())).toEqual([asset.id]);
    const section = page.getByRole('region', { name: '欠けた素材' });
    await section.waitFor({ state: 'visible' });
    expect(await section.textContent()).toContain(asset.source.file);
    const item = section.locator('li').first();
    await item.locator('input[type="file"]').setInputFiles(join(fixture, asset.path));
    // 見本の素材は余白を切り落とした PNG なので、キャンバスサイズの相違を確認して差し替える。
    if (asset.width !== asset.canvasSize.width || asset.height !== asset.canvasSize.height) {
      expect(await answerDialog(page, 'OK')).toContain('キャンバスの大きさ');
    }
    await page.waitForFunction(() => window.__studio.project.missingAssetIds().length === 0);
    const replacementId = await page.evaluate((partIds) => {
      const parts = window.__studio.services.store.get().model.parts.filter((p) => partIds.includes(p.id));
      return parts.map((p) => p.assetId);
    }, affected);
    expect(new Set(replacementId).size).toBe(1);
    expect(replacementId[0]).not.toBe(asset.id);

    await page.evaluate(() => window.__studio.services.store.undo());
    expect(await page.evaluate(() => window.__studio.project.missingAssetIds())).toEqual([asset.id]);
    await section.waitFor({ state: 'visible' });
    await page.evaluate(() => window.__studio.services.store.redo());
    expect(await page.evaluate(() => window.__studio.project.missingAssetIds())).toEqual([]);
    await page.evaluate(() => window.__studio.project.save());
    expect(await page.evaluate(() => window.__studio.project.isDirty())).toBe(false);
    expect(existsSync(missingPath)).toBe(false);
    const saved = JSON.parse(readFileSync(join(workDir, 'project.json'), 'utf8')) as Project;
    const replacement = saved.assets.find((a) => a.id === replacementId[0])!;
    expect(decodePng(readFileSync(join(workDir, replacement.path)))).toEqual(
      decodePng(readFileSync(join(fixture, asset.path))),
    );
    await page.evaluate((dir) => window.__studio.project.open(dir), slash(workDir));
    expect(await page.evaluate(() => window.__studio.project.missingAssetIds())).toEqual([]);
    expect(await section.count()).toBe(0);
  });
});
