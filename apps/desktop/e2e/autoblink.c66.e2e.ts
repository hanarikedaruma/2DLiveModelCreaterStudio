// カード66の受け入れテスト担当 CO。本物のアプリで、カメラを使わず自動の層のまばたきを確かめる。
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright';
import { answerDialog, launchApp, type RunningApp } from './app';

let app: RunningApp | null = null;
let page: Page;
let previousAutoBlink = true;
beforeAll(async () => {
  app = await launchApp(9339);
  page = app.page;
  while ((await answerDialog(page, 'キャンセル', 2000)) !== null) {
    // 利用者の前回の自動保存を変更しない。
  }
  previousAutoBlink = await page.evaluate(() => window.__studio.environment.get().autoBlink);
}, 180_000);
afterAll(async () => {
  if (page)
    await page
      .evaluate(async (autoBlink) => {
        window.__studio.environment.set({ autoBlink });
        await window.__studio.environment.flush();
      }, previousAutoBlink)
      .catch(() => {});
  await app?.close();
});

describe('カード66: カメラ停止中の自動まばたき', () => {
  it('自動の層から閉じ、オフにすると目の値を出さない。設定の保存と復元も通る', async () => {
    const observed = await page.evaluate(async () => {
      const { services, environment, studio } = window.__studio;
      services.autoSaver.stop();
      studio.runtime.stopTracking();
      services.editor.set({ mode: 'studio' });
      environment.set({ autoBlink: true });
      await environment.flush();
      const end = performance.now() + 7500;
      let minimum = 1;
      let autoSeen = false;
      let trackingSeen = false;
      while (performance.now() < end) {
        const frame = studio.runtime.lastFrame();
        if (frame) {
          minimum = Math.min(minimum, frame.params.EyeOpenL ?? 1, frame.params.EyeOpenR ?? 1);
          autoSeen ||= frame.layers.some((layer) => layer.id === 'auto' && 'EyeOpenL' in layer.values);
          trackingSeen ||= frame.layers.some((layer) => layer.id === 'tracking');
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 16));
      }
      return { minimum, autoSeen, trackingSeen };
    });
    expect(observed.minimum).toBeLessThan(0.1);
    expect(observed.autoSeen).toBe(true);
    expect(observed.trackingSeen).toBe(false);
    const disabled = await page.evaluate(async () => {
      const { environment, studio } = window.__studio;
      environment.set({ autoBlink: false });
      await environment.flush();
      await environment.load();
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      const frame = studio.runtime.lastFrame()!;
      return {
        setting: environment.get().autoBlink,
        params: frame.params,
        auto: frame.layers.some((layer) => layer.id === 'auto'),
      };
    });
    expect(disabled.setting).toBe(false);
    expect(disabled.auto).toBe(false);
    expect(disabled.params).toMatchObject({ EyeOpenL: 1, EyeOpenR: 1 });
  });
});
