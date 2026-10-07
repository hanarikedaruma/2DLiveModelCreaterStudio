// カード65 の受け入れテスト。保存・読み込みの受け入れテスト担当 CO。
import { describe, expect, it, vi } from 'vitest';
import { createDefaultEnvironment } from '@app/schema';
import { createEnvironmentStore, memoryEnvironmentStorage, parseEnvironment } from './environment';

describe('カード65: 前の PC 設定の補完と保存', () => {
  it('前の版に新しい設定が無くても、他の設定は保持して既定値を補う', () => {
    const defaults = createDefaultEnvironment();
    const old = { ...defaults, mirror: false, output: { method: 'spout2', width: 1280, height: 720, fps: 30 } };
    Reflect.deleteProperty(old, 'autoBlink');
    expect(parseEnvironment(JSON.stringify(old))).toMatchObject({
      autoBlink: true,
      mirror: false,
      output: { method: 'spout2', width: 1280, height: 720, fps: 30, adapterId: null },
    });
  });

  it('不正な自動まばたきだけを補い、他の正常な設定と GPU は保つ', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const defaults = createDefaultEnvironment();
      const parsed = parseEnvironment(
        JSON.stringify({
          ...defaults,
          autoBlink: 'false',
          mirror: false,
          output: { ...defaults.output, adapterId: 'gpu:1' },
        }),
      );
      expect(parsed).toMatchObject({ autoBlink: true, mirror: false, output: { adapterId: 'gpu:1' } });
    } finally {
      warning.mockRestore();
    }
  });

  it('オフと GPU の変更を保存し、新しいストアへ読み直して復元する', async () => {
    const storage = memoryEnvironmentStorage();
    const store = createEnvironmentStore(storage);
    await store.load();
    store.set({ autoBlink: false, output: { ...store.get().output, adapterId: 'gpu:1' } } as Parameters<
      typeof store.set
    >[0]);
    await store.flush();
    const reopened = createEnvironmentStore(storage);
    await reopened.load();
    expect(reopened.get()).toMatchObject({ autoBlink: false, output: { adapterId: 'gpu:1' } });
  });
});
