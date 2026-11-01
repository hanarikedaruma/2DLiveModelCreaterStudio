// COの独立確認。期待値は秒数と結果の受取時刻から手計算する。
import { describe, expect, it } from 'vitest';
import { summarize, type BodyRecord, type Timeline } from './metrics';
import { LatestSlot } from './queue';
import { indexDirection, geometricShape } from './analyze';
import type { RecHand } from './record';

const body = (patch: Partial<BodyRecord>): BodyRecord => ({
  id: 1,
  captureTime: 100,
  sentAt: 105,
  receivedAt: 108,
  poseStart: null,
  poseEnd: null,
  handStart: null,
  handEnd: null,
  postedAt: 130,
  arrivedAt: 140,
  appliedAt: 150,
  poseDetected: null,
  hands: null,
  stale: false,
  ...patch,
});
const timeline = (): Timeline => ({
  frames: [],
  bodies: [],
  rafs: [],
  longTasks: [],
  mainDropped: [],
  transferErrors: [],
});
describe('AT-01 CO独立確認: 分割結果・時刻・点列', () => {
  it('2秒窓でPoseと手の分割投稿を二重計上せず、実際に届いた結果だけ数える', () => {
    const t = timeline();
    t.bodies = [
      body({ poseStart: 110, poseEnd: 120, arrivedAt: 140 }),
      body({ handStart: 120, handEnd: 145, arrivedAt: 160, appliedAt: 175, hands: 2 }),
      body({ id: 2, poseStart: 1900, poseEnd: 1920, arrivedAt: 1999, captureTime: 1890, appliedAt: null }),
      body({ id: 3, poseEnd: 1980, arrivedAt: 2000 }),
      body({ id: 4, poseEnd: 500, arrivedAt: 500, stale: true }),
    ];
    const actual = summarize(t, 0, 2000);
    expect(actual.pose.fps).toBe(1);
    expect(actual.hands.fps).toBe(0.5);
    expect(actual.pose.inferMs.p50).toBe(15);
    expect(actual.hands.inferMs.p50).toBe(25);
    expect(actual.pose.ageAtArrivalMs.p95).toBeCloseTo(105.55, 8);
    expect(actual.hands.captureToDisplayMs.p95).toBe(75);
    expect(actual.pose.captureToDisplayMs.count).toBe(1); // 未描画を0msとして混ぜない
    expect(actual.worker.stale).toBe(1);
  });
  it('カメラの通知と顔の完了の窓を分け、検出なしの顔も処理fpsに数える', () => {
    const t = timeline();
    const cameraFrame = {
      id: 1,
      now: 900,
      capture: 880,
      captureSource: 'captureTime' as const,
      presentationTime: null,
      expectedDisplayTime: null,
      faceStart: 999,
      faceEnd: 1010,
      faceDetected: false,
      sent: false,
      createMs: null,
    };
    t.frames = [cameraFrame, { ...cameraFrame, id: 2, now: 1990, capture: 1980, faceStart: 1995, faceEnd: 2005 }];
    const actual = summarize(t, 1000, 2000);
    expect(actual.camera.fps).toBe(1);
    expect(actual.face.fps).toBe(1);
    expect(actual.face.inferMs.p95).toBe(11);
    expect(actual.face.ageMs.p95).toBe(130);
    expect(actual.face.detectedRatio).toBe(0);
  });
  it('待ち画像だけを閉じ、取り出した画像の所有権は処理側へ渡す', () => {
    const closed: string[] = [];
    const a = { close: () => closed.push('a') },
      b = { close: () => closed.push('b') };
    const slot = new LatestSlot<typeof a>();
    slot.offer(a);
    expect(slot.take()).toBe(a);
    slot.clear();
    expect(closed).toEqual([]);
    slot.offer(b);
    slot.clear();
    slot.clear();
    expect(closed).toEqual(['b']);
    a.close();
    expect(closed).toEqual(['b', 'a']);
  });
  it('正規化座標が対角線でも、640×480で画素の縦横比を補正する', () => {
    const lm = Array<number>(84).fill(0);
    lm[5 * 4] = 0.3;
    lm[5 * 4 + 1] = 0.7;
    lm[8 * 4] = 0.6;
    lm[8 * 4 + 1] = 0.4;
    const hand: RecHand = { lm, world: [], sdkSide: null, sdkSideScore: null, gesture: null, gestureScore: null };
    expect(indexDirection(hand, 640, 480)).toBeCloseTo(36.86989764584402, 8);
    expect(geometricShape(hand)).toBe('unknown');
  });
});
