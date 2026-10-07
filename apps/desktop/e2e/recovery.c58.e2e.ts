// カード58の受け入れテスト担当 CO。欠けた素材を、本物の Tauri アプリの一覧から差し替える。
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Page } from 'playwright';
import type { Project } from '@app/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { answerDialog, launchApp, ROOT, slash, type RunningApp } from './app';

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
    // 実アプリの画像復号で保存後の画素を比較する。io の非公開パスへ依存しない。
    expect(
      await page.evaluate(
        async ([actualBytes, expectedBytes]) => {
          const pixels = async (bytes: number[]) => {
            const image = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
            try {
              const canvas = new OffscreenCanvas(image.width, image.height);
              const context = canvas.getContext('2d', { willReadFrequently: true });
              if (!context) throw new Error('PNG の画素を比較する 2D コンテキストを作れない');
              context.drawImage(image, 0, 0);
              return context.getImageData(0, 0, image.width, image.height);
            } finally {
              image.close();
            }
          };
          const actual = await pixels(actualBytes);
          const expected = await pixels(expectedBytes);
          return (
            actual.width === expected.width &&
            actual.height === expected.height &&
            actual.data.every((value, index) => value === expected.data[index])
          );
        },
        [
          Array.from(readFileSync(join(workDir, replacement.path))),
          Array.from(readFileSync(join(fixture, asset.path))),
        ] as [number[], number[]],
      ),
    ).toBe(true);
    await page.evaluate((dir) => window.__studio.project.open(dir), slash(workDir));
    expect(await page.evaluate(() => window.__studio.project.missingAssetIds())).toEqual([]);
    expect(await section.count()).toBe(0);
  });

  // カード72・CO引き継ぎ: 本物のファイルIOで壊れたJSONを拒否し、開いているモデルを保つ。
  it('構文が壊れたJSONとスキーマが違うJSONを知らせ、元のプロジェクトを引き続き保存できる', async () => {
    const before = await page.evaluate(() => ({
      project: window.__studio.services.store.get(),
      dir: window.__studio.project.dir(),
      missing: window.__studio.project.missingAssetIds(),
      last: window.__studio.environment.get().lastProjectDir,
    }));
    for (const [name, json] of [
      ['truncated', '{"schemaVersion":'],
      ['wrong-schema', JSON.stringify({ schemaVersion: 2, model: { parts: 'invalid' } })],
    ]) {
      const brokenDir = join(workDir, name!);
      mkdirSync(brokenDir);
      writeFileSync(join(brokenDir, 'project.json'), json!);
      // 前の通知を閉じ、今回の失敗が実画面に出たことを確かめる。
      while ((await page.locator('.toast').count()) > 0) await page.locator('.toast').first().click();
      await page.evaluate((dir) => window.__studio.project.open(dir), slash(brokenDir));
      await page
        .getByRole('status')
        .getByText(/開けなかった:/)
        .waitFor({ state: 'visible' });
      expect(
        await page.evaluate(() => ({
          project: window.__studio.services.store.get(),
          dir: window.__studio.project.dir(),
          missing: window.__studio.project.missingAssetIds(),
          last: window.__studio.environment.get().lastProjectDir,
        })),
      ).toEqual(before);
    }
    await page.evaluate(() => window.__studio.project.save());
    expect(JSON.parse(readFileSync(join(workDir, 'project.json'), 'utf8'))).toEqual(before.project);
    expect(await page.evaluate(() => window.__studio.project.isDirty())).toBe(false);
  });
});
