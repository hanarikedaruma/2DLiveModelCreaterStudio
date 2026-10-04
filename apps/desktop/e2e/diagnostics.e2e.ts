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
    await page.evaluate(() => window.__studio.services.editor.set({ mode: 'studio' }));
    await page.locator('.app-title').click();

    await page.keyboard.press('Control+Shift+D');
    const overlay = page.getByRole('status', { name: '計測' });
    await overlay.waitFor({ state: 'visible' });
    await page.getByRole('button', { name: '記録を始める' }).click();
    await sleep(2000);
    await expect.poll(async () => overlay.textContent(), { timeout: 5000 }).toMatch(/描画 \d+\.\d fps/);
    expect(await overlay.textContent()).toContain('記録中');
    await page.getByRole('button', { name: '記録を止める' }).click();
    const record = await page.evaluate(() => window.__studio.diagnostics.lastRecord());
    expect(record?.kind).toBe('live2d-studio-diagnostics');
    expect(record!.summary.render.frames).toBeGreaterThan(30);
    expect(record!.environment).toHaveProperty('gpu');
    expect(await page.getByRole('button', { name: 'JSON に書き出す' }).isEnabled()).toBe(true);

    await page.keyboard.press('Control+Shift+D');
    await overlay.waitFor({ state: 'detached' });
  }, 180_000);
});
