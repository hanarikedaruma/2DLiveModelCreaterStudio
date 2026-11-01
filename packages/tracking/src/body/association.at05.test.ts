// COの独立確認。640x480の手計算と、世代の境界を公開APIへ流す。
import { expect, it } from 'vitest';
import type { BodyTrackingFrame, HandObservation, PosePoint } from '@app/contracts';
import type { ArmCalibration } from '@app/schema';
import { createBodyAssociation } from './association';
import { computeArmCalibration } from './calibration';

const calibration: ArmCalibration = {
  version: 1,
  camera: { deviceId: 'c', width: 640, height: 480, fps: 30 },
  shoulderCenter: { x: 320, y: 168 },
  shoulderAxis: { x: 1, y: 0 },
  shoulderWidth: 192,
  arms: {
    left: { upper: 100, lower: 100, neutralWrist: { x: 416, y: 368 } },
    right: { upper: 100, lower: 100, neutralWrist: { x: 224, y: 368 } },
  },
};
function pose(generation: number, t: number): BodyTrackingFrame {
  const landmarks: PosePoint[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.2, z: 0, visibility: 1 }));
  for (const [i, x, y] of [
    [11, 0.65, 0.35],
    [12, 0.35, 0.35],
    [13, 0.72, 0.55],
    [14, 0.24, 0.55],
    [15, 0.82, 0.3],
    [16, 0.15, 0.3],
  ])
    landmarks[i!] = { x: x!, y: y!, z: 0, visibility: 1 };
  return {
    image: { width: 640, height: 480 },
    pose: {
      time: {
        generation,
        frameId: t,
        capturedAt: t,
        captureSource: 'captureTime',
        completedAt: t + 10,
        receivedAt: t + 12,
      },
      value: { landmarks, worldLandmarks: [] },
    },
    hands: null,
  };
}
it('ミラーON/OFFの所属と縦横比を手計算に合わせる', () => {
  for (const mirror of [true, false]) {
    const a = createBodyAssociation({ mirror, calibration }),
      out = a.update(pose(1, 100));
    const right = out.arms[mirror ? 'L' : 'R']!,
      left = out.arms[mirror ? 'R' : 'L']!;
    expect(right.actorSide).toBe('right');
    expect(right.wrist.position!.x).toBeCloseTo(0.64, 10);
    expect(right.wrist.position!.y).toBeCloseTo(-0.12, 10);
    expect(left.actorSide).toBe('left');
    expect(left.wrist.position!.x).toBeCloseTo(0.544, 10);
    expect(left.wrist.position!.y).toBeCloseTo(-0.12, 10);
  }
});
it('自動で新世代を受けた後は、旧世代の別通知を採用しない', () => {
  const a = createBodyAssociation({ calibration });
  a.update(pose(4, 100));
  const stale = a.update(pose(3, 90));
  expect(stale.generation).toBe(4);
  expect(stale.arms).toEqual({});
  expect(stale.hands).toEqual({});
});
function hands(t: number, wrists: number[]): BodyTrackingFrame {
  const sample = pose(1, t).pose!;
  return {
    image: { width: 640, height: 480 },
    pose: null,
    hands: {
      time: sample.time,
      value: wrists.map((x): HandObservation => ({
        landmarks: Array.from({ length: 21 }, () => ({ x, y: 0.3, z: 0 })),
        worldLandmarks: [],
        handedness: { side: x > 0.5 ? 'right' : 'left', score: 1 },
        gesture: null,
      })),
    },
  };
}
it('検出順と誤ったSDK左右に依存せず、手首が交差してもPoseに対応付ける', () => {
  for (const crossed of [false, true])
    for (const reversed of [false, true]) {
      const a = createBodyAssociation({ mirror: false, calibration });
      const p = pose(1, 100);
      if (crossed) {
        p.pose!.value.landmarks[15]!.x = 0.15;
        p.pose!.value.landmarks[16]!.x = 0.82;
      }
      a.update(p);
      const values = crossed ? [0.15, 0.82] : [0.82, 0.15];
      if (reversed) values.reverse();
      const out = a.update(hands(110, values));
      expect(out.hands.L?.validity).toBe('valid');
      expect(out.hands.R?.validity).toBe('valid');
      const leftX = crossed ? ((0.15 - 0.65) * 640) / 200 : 0.544;
      const rightX = crossed ? ((0.35 - 0.82) * 640) / 200 : 0.64;
      expect(out.hands.L!.landmarks[0]!.x).toBeCloseTo(leftX);
      expect(out.hands.R!.landmarks[0]!.x).toBeCloseTo(rightX);
    }
});
it('同時刻のPoseが無い手・完全に重なった手・本人の手首から遠い手を無理に所属させない', () => {
  const a = createBodyAssociation({ calibration });
  a.update(pose(1, 100));
  const stale = a.update(hands(181, [0.15, 0.82]));
  expect(stale.hands.L?.validity).toBe('ambiguous');
  expect(stale.hands.R?.validity).toBe('ambiguous');
  const overlap = pose(1, 200);
  overlap.pose!.value.landmarks[15]!.x = 0.5;
  overlap.pose!.value.landmarks[16]!.x = 0.5;
  const b = createBodyAssociation({ calibration });
  b.update(overlap);
  const both = b.update(hands(200, [0.5, 0.5]));
  expect(both.hands.L?.validity).toBe('ambiguous');
  expect(both.hands.R?.validity).toBe('ambiguous');
  const c = createBodyAssociation({ calibration });
  c.update(pose(1, 100));
  const stranger = hands(100, [0.5]);
  stranger.hands!.value[0]!.landmarks.forEach((p) => {
    p.y = 0.95;
  });
  const outside = c.update(stranger);
  expect(outside.hands.L?.validity).toBe('missing');
  expect(outside.hands.R?.validity).toBe('missing');
});
it('校正用の有効な観測が無ければ、架空の腕長を保存せず不足理由を返す', () => {
  const result = computeArmCalibration([], calibration.camera);
  expect(result.calibration).toBeNull();
  expect(result.problems.length).toBeGreaterThan(0);
  expect(result.sides.left.confirmed).toBe(false);
  expect(result.sides.right.confirmed).toBe(false);
});
