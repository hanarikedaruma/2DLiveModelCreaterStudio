import { describe, expect, it } from 'vitest';
import type { TrackingFrame } from '@app/contracts';
import { createDiagnosticsCollector, RECORD_LIMIT_MS } from './collector';
import { formatSnapshot } from './index';
import { fpsStats, latencyStats, mean, percentile, ratePerSecond } from './stats';

const frame = (time: number, detected = true): TrackingFrame => ({
  time,
  detected,
  faceYaw: 0,
  facePitch: 0,
  faceRoll: 0,
  eyeOpenL: 1,
  eyeOpenR: 1,
  eyeBallX: 0,
  eyeBallY: 0,
  mouthOpen: 0,
});

describe('計測の数値', () => {
  it('パーセンタイルは線形補間、平均', () => {
    expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
    expect(percentile([10, 20], 95)).toBeCloseTo(19.5);
    expect(percentile([5, 1, 3], 0)).toBe(1);
    expect(percentile([], 50)).toBeNaN();
    expect(mean([1, 2, 3])).toBe(2);
  });

  it('fps は間隔の平均、1% 最低値は間隔の 99 パーセンタイルから', () => {
    // 16.7ms 間隔が 99 回、1回だけ 50ms
    const times = [0];
    for (let i = 0; i < 99; i++) times.push(times.at(-1)! + 1000 / 60);
    times.push(times.at(-1)! + 50);
    const s = fpsStats(times);
    expect(s.avg).toBeGreaterThan(57);
    expect(s.avg).toBeLessThan(60);
    expect(s.low1).toBeLessThan(40);
    expect(fpsStats([0]).avg).toBeNaN();
  });

  it('直近の窓の中の数を秒あたりにする', () => {
    const times = Array.from({ length: 300 }, (_, i) => i * (1000 / 30)); // 30fps で10秒
    expect(ratePerSecond(times, 5000, times.at(-1)! + 1)).toBeCloseTo(30, 0);
  });

  it('遅延の p95・平均・最大', () => {
    const s = latencyStats(Array.from({ length: 100 }, (_, i) => i + 1));
    expect(s.p95).toBeCloseTo(95.05);
    expect(s.avg).toBe(50.5);
    expect(s.max).toBe(100);
    expect(s.samples).toBe(100);
  });
});

describe('createDiagnosticsCollector', () => {
  it('母音の窓の先頭から初めて描いた時刻までを1回だけ計測し、記録にも残す', () => {
    const c = createDiagnosticsCollector();
    c.startRecording(0, new Date());
    c.onVowelRendered(10, 45);
    c.onVowelRendered(10, 60);
    c.onVowelRendered(30, 65);
    c.onVowelRendered(NaN, 65);
    c.onVowelRendered(80, 70);
    expect(c.snapshot(70).vowelLatency).toMatchObject({ samples: 2, avg: 35, p95: 35 });
    const record = c.stopRecording(100)!;
    expect(record.samples.vowelLatencies).toEqual([35, 35]);
    expect(record.summary.vowelLatency.p95).toBe(35);
    expect(c.snapshot(6000).vowelLatency.samples).toBe(0);
  });
  it('60fps の描画と 30fps のトラッキングから、fps と遅延を出す', () => {
    const c = createDiagnosticsCollector();
    // 33.3ms ごとにカメラのフレーム（時刻はその時点）、届くのは 10ms 後。描画は 16.7ms ごと
    let nextTracking = 0;
    for (let t = 0; t <= 4000; t += 1000 / 60) {
      while (nextTracking + 10 <= t) {
        c.onTrackingFrame(frame(nextTracking), nextTracking + 10);
        nextTracking += 1000 / 30;
      }
      c.onRenderedFrame(t);
    }
    const s = c.snapshot(4000);
    expect(s.render.avg).toBeCloseTo(60, 0);
    expect(s.trackingFps).toBeGreaterThan(20); // 4秒しか無いので5秒の窓では少なめになる
    // 遅延 = 次に描いた時刻 − カメラのフレームの時刻（10ms〜27ms）
    expect(s.latency.p95).toBeGreaterThanOrEqual(10);
    expect(s.latency.p95).toBeLessThanOrEqual(10 + 1000 / 60 + 0.01);
  });

  it('1つのトラッキングのフレームの遅延は、最初に描いたフレームで1回だけ測る。顔の無いフレームは測らない', () => {
    const c = createDiagnosticsCollector();
    c.onTrackingFrame(frame(100), 110);
    c.onRenderedFrame(120);
    c.onRenderedFrame(137);
    c.onTrackingFrame(frame(200, false), 210);
    c.onRenderedFrame(220);
    const s = c.snapshot(220);
    expect(s.latency.samples).toBe(1);
    expect(s.latency.avg).toBe(20);
  });

  it('記録は開始からの時刻で貯め、止めると要約つきで返す。5分を超えた分は入れない', () => {
    const c = createDiagnosticsCollector();
    c.onRenderedFrame(0);
    c.startRecording(1000, new Date('2026-10-03T00:00:00Z'));
    c.onTrackingFrame(frame(1005), 1010);
    c.onRenderedFrame(1020);
    c.onRenderedFrame(1040);
    c.onRenderedFrame(1000 + RECORD_LIMIT_MS + 100); // 5分を過ぎた
    const r = c.stopRecording(1000 + RECORD_LIMIT_MS + 200, { gpu: 'test' })!;
    expect(r.kind).toBe('live2d-studio-diagnostics');
    expect(r.startedAt).toBe('2026-10-03T00:00:00.000Z');
    expect(r.durationMs).toBe(RECORD_LIMIT_MS);
    expect(r.samples.renderTimes).toEqual([20, 40]);
    expect(r.samples.trackingTimes).toEqual([10]);
    expect(r.samples.latencies).toEqual([15]);
    expect(r.environment).toEqual({ gpu: 'test' });
    expect(r.summary.render.avg).toBeCloseTo(50);
    expect(c.isRecording()).toBe(false);
    expect(c.stopRecording(0)).toBeNull();
  });

  it('画面に出す文', () => {
    const c = createDiagnosticsCollector();
    for (let t = 0; t <= 1000; t += 20) c.onRenderedFrame(t);
    c.startRecording(1000, new Date());
    const lines = formatSnapshot({ ...c.snapshot(1000), recording: { active: true, elapsedMs: 65_000 } });
    expect(lines[0]).toMatch(/^描画 50\.0 fps/);
    expect(lines[2]).toMatch(/遅延 p95 — ms/);
    expect(lines[3]).toBe('記録中 1:05 / 5:00');
  });
});
