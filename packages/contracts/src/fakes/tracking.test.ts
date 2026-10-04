import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TrackingFrame } from '../index';
import { FakeTrackingLayer, FakeTrackingSource, fakeTrackingFrame } from './tracking';

afterEach(() => {
  vi.useRealTimers();
});

describe('FakeTrackingSource', () => {
  it('30fps で顔を左右に振るフレームを出し、stop で止まる（4秒で1往復）', async () => {
    vi.useFakeTimers();
    let now = 0;
    const source = new FakeTrackingSource(() => now);
    const frames: TrackingFrame[] = [];
    const off = source.onFrame((f) => frames.push(f));
    await source.start();
    for (let i = 0; i < 120; i++) {
      now += 1000 / 30;
      vi.advanceTimersByTime(1000 / 30);
    }
    expect(frames.length).toBeGreaterThanOrEqual(119);
    expect(frames.length).toBeLessThanOrEqual(121);
    const yaws = frames.map((f) => f.faceYaw);
    expect(Math.max(...yaws)).toBeGreaterThan(10);
    expect(Math.min(...yaws)).toBeLessThan(-10);
    source.stop();
    const count = frames.length;
    vi.advanceTimersByTime(1000);
    expect(frames.length).toBe(count);
    off();
    expect(await source.listDevices()).toHaveLength(1);
  });

  it('20秒ごとに2秒間 detected が false', () => {
    expect(fakeTrackingFrame(0, 0).detected).toBe(true);
    expect(fakeTrackingFrame(17999, 0).detected).toBe(true);
    expect(fakeTrackingFrame(18000, 0).detected).toBe(false);
    expect(fakeTrackingFrame(19999, 0).detected).toBe(false);
    expect(fakeTrackingFrame(20000, 0).detected).toBe(true);
    expect(fakeTrackingFrame(38500, 0).detected).toBe(false);
  });
});

describe('FakeTrackingLayer', () => {
  it('フレームの値をそのままパラメータに写す', () => {
    const layer = new FakeTrackingLayer();
    expect(layer.status()).toBe('lost');
    layer.update({ ...fakeTrackingFrame(0, 0), faceYaw: 12, eyeOpenL: 0.3, mouthOpen: 0.7 });
    expect(layer.status()).toBe('tracking');
    const out = layer.tick(0);
    expect(out.id).toBe('tracking');
    expect(out.values).toMatchObject({ FaceAngleX: 12, EyeOpenL: 0.3, MouthOpen: 0.7 });
  });

  it('外れたら lost になり、直前の値を保つ', () => {
    const layer = new FakeTrackingLayer();
    layer.update({ ...fakeTrackingFrame(0, 0), faceYaw: 12 });
    layer.update(fakeTrackingFrame(18000, 0));
    expect(layer.status()).toBe('lost');
    expect(layer.tick(0).values.FaceAngleX).toBe(12);
  });
});
