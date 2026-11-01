// 実装者 CL の補助試験。CO の独立確認は別のファイル（*.at01.test.ts）で行う
import { describe, expect, it } from 'vitest';
import { fps, percentile, summarize, type BodyRecord, type Timeline } from './metrics';
import { LatestSlot } from './queue';

const body = (patch: Partial<BodyRecord>): BodyRecord => ({
  id: 1,
  captureTime: 0,
  sentAt: 0,
  receivedAt: 0,
  poseStart: null,
  poseEnd: null,
  handStart: null,
  handEnd: null,
  postedAt: 0,
  arrivedAt: 0,
  appliedAt: null,
  poseDetected: null,
  hands: null,
  stale: false,
  ...patch,
});

const empty = (): Timeline => ({
  frames: [],
  bodies: [],
  rafs: [],
  longTasks: [],
  mainDropped: [],
  transferErrors: [],
});

describe('percentile', () => {
  it('線形補間で求め、有限でない値は除く', () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(percentile([10, Number.NaN, 20], 0.95)).toBeCloseTo(19.5);
    expect(percentile([], 0.5)).toBeNull();
  });
});

describe('fps', () => {
  it('分母は窓の秒数、分子は窓に入った完了時刻の数（終わりは含まない）', () => {
    expect(fps([0, 100, 999, 1000], 0, 1000)).toBe(3);
    expect(fps([0, 500, 1000, 1500], 0, 2000)).toBe(2);
    expect(fps([null, 10], 0, 1000)).toBe(1);
  });
});

describe('summarize', () => {
  it('Pose と手を完了時刻で別々に数え、捨てた結果は入れない', () => {
    const timeline = empty();
    for (let i = 0; i < 30; i++) {
      const t = i * (1000 / 30);
      timeline.bodies.push(
        body({
          id: i,
          captureTime: t,
          poseStart: t + 5,
          poseEnd: t + 15,
          // 手は1つおき（15fps の軽量案）
          handStart: i % 2 ? null : t + 15,
          handEnd: i % 2 ? null : t + 25,
          arrivedAt: t + 27,
          appliedAt: t + 30,
          poseDetected: true,
          hands: i % 2 ? null : 1,
        }),
      );
    }
    timeline.bodies.push(body({ id: 99, poseEnd: 500, arrivedAt: 500, stale: true }));
    // 推定は窓の中で終わったが、ページに届いたのは窓の後
    timeline.bodies.push(body({ id: 100, captureTime: 980, poseEnd: 995, handEnd: 998, arrivedAt: 1005, hands: 0 }));
    const summary = summarize(timeline, 0, 1000);
    expect(summary.pose.fps).toBe(30);
    expect(summary.hands.fps).toBe(15);
    expect(summary.pose.inferMs.p50).toBeCloseTo(10);
    expect(summary.pose.captureToDisplayMs.p95).toBeCloseTo(30);
    expect(summary.worker.stale).toBe(1);
  });

  it('描画の間隔から遅いフレームを数える', () => {
    const timeline = empty();
    timeline.rafs = [0, 16, 33, 50, 100, 116];
    const summary = summarize(timeline, 0, 200);
    expect(summary.render.slowFrames).toBe(1);
    expect(summary.render.intervalMs.max).toBe(50);
  });
});

describe('LatestSlot', () => {
  it('待ちは最新の1枚だけ。置き換えた古い方を閉じて数える', () => {
    const closed: number[] = [];
    const item = (n: number) => ({ n, close: () => closed.push(n) });
    const slot = new LatestSlot<ReturnType<typeof item>>();
    slot.offer(item(1));
    slot.offer(item(2));
    slot.offer(item(3));
    expect(closed).toEqual([1, 2]);
    expect(slot.dropped).toBe(2);
    expect(slot.take()?.n).toBe(3);
    expect(slot.take()).toBeNull();
    slot.offer(item(4));
    slot.clear();
    expect(closed).toEqual([1, 2, 4]);
    expect(slot.waiting).toBe(false);
  });
});
