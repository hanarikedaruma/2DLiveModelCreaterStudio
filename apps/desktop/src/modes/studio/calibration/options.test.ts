import { describe, expect, it, vi } from 'vitest';
import { TRACKING_PRESETS } from '@app/tracking';
import {
  createTrackingOptionsStore,
  defaultTrackingOptions,
  parseTrackingOptions,
  type TrackingOptionsStorage,
} from './options';

function memoryStorage(text: string | null = null): TrackingOptionsStorage & { text: string | null } {
  const s = {
    text,
    read: () => s.text,
    write: (t: string) => {
      s.text = t;
    },
  };
  return s;
}

describe('parseTrackingOptions', () => {
  it('無ければ既定値（目のトラッキングはオン、カスタムの値は標準と同じ）', () => {
    expect(parseTrackingOptions(null)).toEqual({ eyeTracking: true, custom: { ...TRACKING_PRESETS.standard } });
    expect(defaultTrackingOptions()).toEqual(parseTrackingOptions(null));
  });

  it('壊れた・足りない項目は既定値で埋める', () => {
    expect(parseTrackingOptions('{')).toEqual(defaultTrackingOptions());
    expect(parseTrackingOptions('null')).toEqual(defaultTrackingOptions());
    expect(
      parseTrackingOptions(JSON.stringify({ eyeTracking: 'no', custom: { minCutoff: 0, beta: 0.1, gain: -1 } })),
    ).toEqual({
      eyeTracking: true,
      custom: { minCutoff: 1, beta: 0.1, gain: 1, deadZone: 0.5 },
    });
  });
});

describe('createTrackingOptionsStore', () => {
  it('保存先から読み、変えたら書いて知らせる', () => {
    const storage = memoryStorage(
      JSON.stringify({ eyeTracking: false, custom: { minCutoff: 0.8, beta: 0.03, gain: 1.1, deadZone: 1 } }),
    );
    const store = createTrackingOptionsStore(storage);
    expect(store.get()).toEqual({ eyeTracking: false, custom: { minCutoff: 0.8, beta: 0.03, gain: 1.1, deadZone: 1 } });
    const listener = vi.fn();
    store.subscribe(listener);
    store.set({ eyeTracking: true });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(JSON.parse(storage.text!)).toMatchObject({ eyeTracking: true });
    // 同じ値なら何もしない
    store.set({ eyeTracking: true });
    expect(listener).toHaveBeenCalledTimes(1);
    // 読み直しても同じ
    expect(createTrackingOptionsStore(storage).get()).toEqual(store.get());
  });

  it('get は変えるまで同じオブジェクト（useSyncExternalStore で使える）', () => {
    const store = createTrackingOptionsStore(memoryStorage());
    expect(store.get()).toBe(store.get());
    const before = store.get();
    store.set({ custom: { minCutoff: 2, beta: 0, gain: 1, deadZone: 0 } });
    expect(store.get()).not.toBe(before);
    expect(store.get().custom.minCutoff).toBe(2);
  });
});
