// 計測の表示（カード25）: Ctrl+Shift+D で開閉し、スタジオで描画の fps が出て、記録を取れる
import { afterAll, describe, expect, it } from 'vitest';
import { answerDialog, launchApp, sleep, type RunningApp } from './app';

let app: RunningApp | null = null;

afterAll(async () => {
  await app?.close();
});

describe('計測の表示', () => {
  it('Ctrl+Shift+D で開閉し、スタジオの描画の fps を出し、記録を取れる', async () => {
    app = await launchApp(9337);
    const page = app.page;
    while ((await answerDialog(page, 'キャンセル', 2000)) !== null) {
      // 前の作業の残りは復元しない
    }
    await page.evaluate(async () => {
      await window.__studio.services.tracking.stop();
      window.__studio.services.editor.set({ mode: 'studio' });
    });
    await page.locator('.app-title').click();

    await page.keyboard.press('Control+Shift+D');
    const overlay = page.getByRole('status', { name: '計測' });
    await overlay.waitFor({ state: 'visible' });
    await page.getByRole('button', { name: '記録を始める' }).click();
    await sleep(2000);
    await expect.poll(async () => overlay.textContent(), { timeout: 5000 }).toMatch(/描画 \d+\.\d fps/);
    expect(await overlay.textContent()).toContain('記録中');
    const eye = overlay.locator('tr[data-parameter-id="EyeOpenL"]');
    expect(await eye.locator('[data-layer-id="auto"]').textContent()).toMatch(/重み 1\.000/);
    expect(await eye.locator('[data-layer-id="tracking"]').textContent()).toBe('—');
    await page.getByRole('button', { name: '記録を止める' }).click();
    const record = await page.evaluate(() => window.__studio.diagnostics.lastRecord());
    expect(record?.kind).toBe('live2d-studio-diagnostics');
    expect(record!.summary.render.frames).toBeGreaterThan(30);
    expect(record!.environment).toHaveProperty('gpu');
    expect(record!.samples.layers.length).toBeGreaterThanOrEqual(3);
    expect(record!.samples.layers.length).toBeLessThanOrEqual(8);
    expect(
      record!.samples.layers.some((sample) =>
        sample.layers.some((layer) => layer.id === 'auto' && 'EyeOpenL' in layer.values),
      ),
    ).toBe(true);
    expect(await page.getByRole('button', { name: 'JSON に書き出す' }).isEnabled()).toBe(true);

    await page.evaluate(() => {
      const services = window.__studio.services;
      services.store.dispatch({
        label: '計測の表情を確認',
        apply: (project) => ({
          ...project,
          expressions: [
            ...project.expressions,
            {
              id: '__diagnostics_test__',
              name: '計測の表情',
              entries: [{ parameterId: 'EyeOpenL', value: 0.2, blend: 'add' }],
              fadeIn: 0,
              fadeOut: 0,
            },
          ],
        }),
      });
      services.expressions.apply('__diagnostics_test__', performance.now());
    });
    await expect
      .poll(async () => eye.locator('[data-layer-id="expression"]').textContent())
      .toContain('0.200 / 重み 1.000・加算');
    await expect.poll(async () => Number(await eye.locator('[data-final]').textContent())).toBeGreaterThan(0.5);
    await page.evaluate(() => {
      window.__studio.services.expressions.apply(null, performance.now());
      window.__studio.services.store.undo();
    });

    await page.keyboard.press('Control+Shift+D');
    await overlay.waitFor({ state: 'detached' });
  }, 180_000);
});
