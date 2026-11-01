import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultArmTrackingSettings } from '@app/schema';
import { createDemoArmService } from './demoService';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('開発用の仮の腕サービス', () => {
  it('購読している間だけ時間で動き、購読をやめたらタイマーを止める', () => {
    let now = 0;
    const service = createDemoArmService({ now: () => now });
    expect(vi.getTimerCount()).toBe(0);
    const seen: number[] = [];
    const off = service.onDiagnostics(() => seen.push(service.diagnostics()!.time));
    now = 1000;
    vi.advanceTimersByTime(100);
    expect(seen.length).toBeGreaterThan(1);
    expect(service.diagnostics()!.pose!.right.shoulder!.x).toBeLessThan(0.5); // 未反転：演者の右は画像の左
    off();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('入れた側だけ追従の状態になり、手形の固定は fixed になる', () => {
    const service = createDemoArmService({ now: () => 0 });
    const settings = defaultArmTrackingSettings();
    settings.sides.L = { ...settings.sides.L, enabled: true, handMode: 'peace' };
    service.setSettings(settings);
    expect(service.status().motion.L).toMatchObject({ state: 'tracking', handState: 'fixed', hand: 'peace' });
    expect(service.status().motion.R.state).toBe('off');
    expect(service.settings()).toEqual(settings);
  });

  it('校正は4手順で保存し、failOnce の手順は1回目だけ失敗、取り消すと途中の手順の結果を使わない', async () => {
    const service = createDemoArmService({ captureMs: 10, failOnce: 'bend' });
    const run = async (step: 'neutral' | 'bend' | 'left' | 'right') => {
      const done = service.captureCalibration(step);
      await vi.advanceTimersByTimeAsync(10);
      await done;
      return service.status().calibration;
    };
    expect(await run('neutral')).toMatchObject({ state: 'capturing' });
    expect(await run('bend')).toMatchObject({ state: 'invalid', step: 'bend' });
    expect(await run('bend')).toMatchObject({ state: 'capturing' });
    await run('left');
    const last = service.captureCalibration('right');
    service.cancelCalibration();
    await vi.advanceTimersByTimeAsync(10);
    await last;
    expect(service.calibration()).toBeNull();
    expect(await run('right')).toEqual({ state: 'ready', step: null, reason: null });
    expect(service.calibration()).not.toBeNull();
    service.clearCalibration();
    expect(service.status().calibration.state).toBe('empty');
  });
});
