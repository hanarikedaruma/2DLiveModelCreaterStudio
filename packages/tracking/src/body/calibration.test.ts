import type { ArmCalibrationStep, PosePoint } from '@app/contracts';
import { armCalibrationSchema } from '@app/schema';
import { describe, expect, it } from 'vitest';
import { calibrationMismatch, computeArmCalibration, type CalibrationSample } from './calibration';

const IMAGE = { width: 1280, height: 720 };
type P = [number, number] | null;
function sample(step: ArmCalibrationStep, points: Record<number, P>, image = IMAGE): CalibrationSample {
  const landmarks: PosePoint[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 }));
  for (const [i, p] of Object.entries(points))
    if (p) landmarks[Number(i)] = { x: p[0] / image.width, y: p[1] / image.height, z: 0, visibility: 0.9 };
  return { step, pose: { landmarks, worldLandmarks: [] }, image };
}
// 演者の右肩 (540,300)・左肩 (740,300)。腕を下ろすと手首は画面の下に出る（写らない）
const SHOULDERS = { 11: [740, 300] as P, 12: [540, 300] as P };
const camera = { deviceId: 'cam', width: 1280, height: 720, fps: 30 };
const repeat = (n: number, s: CalibrationSample) => Array.from({ length: n }, () => s);

function goodSamples(): CalibrationSample[] {
  return [
    ...repeat(8, sample('neutral', { ...SHOULDERS })),
    // 肘を軽く曲げる：左腕 上腕130・前腕110、右腕 上腕120・前腕100
    ...repeat(
      8,
      sample('bend', {
        ...SHOULDERS,
        13: [740 + 50, 300 + 120],
        15: [740 + 50 + 110, 420],
        14: [540 - 72, 300 + 96],
        16: [540 - 72 - 100, 396],
      }),
    ),
    ...repeat(8, sample('left', { ...SHOULDERS, 15: [900, 150] })),
    ...repeat(8, sample('right', { ...SHOULDERS, 16: [380, 150] })),
  ];
}

describe('computeArmCalibration', () => {
  it('肩の中心・軸・幅、演者の左右の上腕と前腕の長さを px で求め、保存の形に合う', () => {
    const result = computeArmCalibration(goodSamples(), camera);
    expect(result.problems).toEqual([]);
    const c = result.calibration!;
    expect(c.shoulderCenter).toEqual({ x: 640, y: 300 });
    expect(c.shoulderAxis.x).toBeCloseTo(1);
    expect(c.shoulderWidth).toBeCloseTo(200);
    expect(c.arms.left.upper).toBeCloseTo(130);
    expect(c.arms.left.lower).toBeCloseTo(110);
    expect(c.arms.right.upper).toBeCloseTo(120);
    expect(c.arms.right.lower).toBeCloseTo(100);
    // 中立の手首が写らないときは、肩の真下に腕の長さだけ下がった位置
    expect(c.arms.left.neutralWrist).toEqual({ x: 740, y: 300 + 240 });
    expect(armCalibrationSchema.safeParse(c).success).toBe(true);
    // 片手を上げた手は、未反転の画像で演者の右手が画像の左側
    expect(result.sides).toEqual({
      left: { confirmed: true, imageHalf: 'right' },
      right: { confirmed: true, imageHalf: 'left' },
    });
  });

  it('肘が写っていない校正は完了させない', () => {
    const samples = goodSamples().map((s) =>
      s.step === 'bend' ? sample('bend', { ...SHOULDERS, 15: [900, 420], 16: [368, 396] }) : s,
    );
    const result = computeArmCalibration(samples, camera);
    expect(result.calibration).toBeNull();
    expect(result.problems.some((p) => p.includes('肘'))).toBe(true);
  });

  it('上げた手が案内と違う側なら、左右を確かめられないとして完了させない', () => {
    const samples = goodSamples().map((s) =>
      s.step === 'right' ? sample('right', { ...SHOULDERS, 16: [380, 500] }) : s,
    );
    const result = computeArmCalibration(samples, camera);
    expect(result.calibration).toBeNull();
    expect(result.sides.right.confirmed).toBe(false);
  });

  it('上腕と前腕の比が人の腕の範囲を外れたら誤検出として完了させない', () => {
    const samples = goodSamples().map((s) =>
      s.step === 'bend'
        ? sample('bend', { ...SHOULDERS, 13: [790, 420], 15: [1190, 420], 14: [468, 396], 16: [368, 396] })
        : s,
    );
    expect(computeArmCalibration(samples, camera).problems.some((p) => p.includes('比'))).toBe(true);
  });

  it('縦横比の違う映像でも、px で同じ長さになる', () => {
    const wide = goodSamples();
    const square = goodSamples().map((s) => {
      const image = { width: 1280, height: 1280 };
      return {
        ...s,
        image,
        pose: { ...s.pose, landmarks: s.pose.landmarks.map((p) => ({ ...p, y: (p.y * 720) / 1280 })) },
      };
    });
    const a = computeArmCalibration(wide, camera).calibration!;
    const b = computeArmCalibration(square, { ...camera, height: 1280 }).calibration!;
    expect(b.arms.left.upper).toBeCloseTo(a.arms.left.upper);
    expect(b.shoulderWidth).toBeCloseTo(a.shoulderWidth);
  });
});

describe('calibrationMismatch', () => {
  it('カメラ・縦横比・解像度の違いを理由として返し、同じなら空', () => {
    const c = computeArmCalibration(goodSamples(), camera).calibration!;
    expect(calibrationMismatch(c, { deviceId: 'cam', width: 1280, height: 720 })).toEqual([]);
    expect(calibrationMismatch(c, { deviceId: 'other', width: 1280, height: 720 })).toEqual(['カメラが変わった']);
    expect(calibrationMismatch(c, { deviceId: 'cam', width: 640, height: 480 })).toEqual(['映像の縦横比が変わった']);
    expect(calibrationMismatch(c, { deviceId: 'cam', width: 640, height: 360 })).toEqual([
      '映像の解像度が変わった（長さは比で直して使う）',
    ]);
  });
});
