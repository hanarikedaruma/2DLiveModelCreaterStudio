import { describe, expect, it } from 'vitest';
import {
  type BlendshapeCategory,
  type LandmarkerResultLike,
  NEUTRAL_TRACKING_FRAME,
  blendshapesToFrame,
  landmarkerResultToFrame,
  matrixToAngles,
} from './convert';

type Vec3 = [number, number, number];
const rad = (deg: number): number => (deg * Math.PI) / 180;

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

// カメラの座標（x = 映像の右 = ユーザーの左、y = 上、z = カメラへ）で、顔の前と頭の上の向きから
// MediaPipe と同じ列優先の 4×4 を作る。顔の x 軸は y × z（右手系）
function poseMatrix(forward: Vec3, up: Vec3, scale = 1): number[] {
  const x = cross(up, forward);
  const columns = [x, up, forward];
  const data: number[] = [];
  for (const c of columns) data.push(c[0] * scale, c[1] * scale, c[2] * scale, 0);
  data.push(1.5, -2, -45, 1); // 平行移動（顔はカメラの前、−z の側）
  return data;
}

const FRONT: Vec3 = [0, 0, 1];
const UP: Vec3 = [0, 1, 0];

describe('matrixToAngles', () => {
  it('正面を向いた顔は 0・0・0', () => {
    const a = matrixToAngles(poseMatrix(FRONT, UP))!;
    expect(a.yaw).toBeCloseTo(0, 6);
    expect(a.pitch).toBeCloseTo(0, 6);
    expect(a.roll).toBeCloseTo(0, 6);
  });

  it('ユーザーが自分の右を向くと yaw が正（顔の前が映像の左 = −x へ向く）', () => {
    const t = rad(20);
    const a = matrixToAngles(poseMatrix([-Math.sin(t), 0, Math.cos(t)], UP))!;
    expect(a.yaw).toBeCloseTo(20, 6);
    expect(a.pitch).toBeCloseTo(0, 6);
    expect(a.roll).toBeCloseTo(0, 6);
  });

  it('ユーザーが自分の左を向くと yaw が負', () => {
    const t = rad(25);
    const a = matrixToAngles(poseMatrix([Math.sin(t), 0, Math.cos(t)], UP))!;
    expect(a.yaw).toBeCloseTo(-25, 6);
  });

  it('上を向くと pitch が正、下を向くと負', () => {
    const t = rad(15);
    const upward = matrixToAngles(poseMatrix([0, Math.sin(t), Math.cos(t)], [0, Math.cos(t), -Math.sin(t)]))!;
    expect(upward.pitch).toBeCloseTo(15, 6);
    expect(upward.yaw).toBeCloseTo(0, 6);
    expect(upward.roll).toBeCloseTo(0, 6);
    const downward = matrixToAngles(poseMatrix([0, -Math.sin(t), Math.cos(t)], [0, Math.cos(t), Math.sin(t)]))!;
    expect(downward.pitch).toBeCloseTo(-15, 6);
  });

  it('ユーザーが自分の右へ傾けると roll が正（頭の上が映像の左 = −x へ倒れる）', () => {
    const t = rad(10);
    const right = matrixToAngles(poseMatrix(FRONT, [-Math.sin(t), Math.cos(t), 0]))!;
    expect(right.roll).toBeCloseTo(10, 6);
    expect(right.yaw).toBeCloseTo(0, 6);
    expect(right.pitch).toBeCloseTo(0, 6);
    const left = matrixToAngles(poseMatrix(FRONT, [Math.sin(t), Math.cos(t), 0]))!;
    expect(left.roll).toBeCloseTo(-10, 6);
  });

  it('向きと傾きを組み合わせても、それぞれの角度に戻る', () => {
    // 体の軸で右を向き（a）、首を上げ（b）、顔を傾ける（c）。R = Ry(−yaw)·Rx(−pitch)·Rz(roll)
    const cases: Vec3[] = [
      [20, 10, 5],
      [-30, -15, 12],
      [8, 25, -20],
    ];
    for (const [yaw, pitch, roll] of cases) {
      const ry = (v: Vec3, d: number): Vec3 => {
        const [c, s] = [Math.cos(rad(d)), Math.sin(rad(d))];
        return [c * v[0] + s * v[2], v[1], -s * v[0] + c * v[2]];
      };
      const rx = (v: Vec3, d: number): Vec3 => {
        const [c, s] = [Math.cos(rad(d)), Math.sin(rad(d))];
        return [v[0], c * v[1] - s * v[2], s * v[1] + c * v[2]];
      };
      const rz = (v: Vec3, d: number): Vec3 => {
        const [c, s] = [Math.cos(rad(d)), Math.sin(rad(d))];
        return [c * v[0] - s * v[1], s * v[0] + c * v[1], v[2]];
      };
      const rotate = (v: Vec3): Vec3 => ry(rx(rz(v, roll), -pitch), -yaw);
      const a = matrixToAngles(poseMatrix(rotate(FRONT), rotate(UP)))!;
      expect(a.yaw).toBeCloseTo(yaw, 6);
      expect(a.pitch).toBeCloseTo(pitch, 6);
      expect(a.roll).toBeCloseTo(roll, 6);
    }
  });

  it('倍率が掛かっていても角度は変わらない', () => {
    const t = rad(20);
    const a = matrixToAngles(poseMatrix([-Math.sin(t), 0, Math.cos(t)], UP, 1.7))!;
    expect(a.yaw).toBeCloseTo(20, 6);
  });

  it('列優先として読む（行優先として並べると符号が逆になる）', () => {
    const t = rad(20);
    const columnMajor = poseMatrix([-Math.sin(t), 0, Math.cos(t)], UP);
    const rowMajor = [0, 1, 2, 3].flatMap((r) => [0, 1, 2, 3].map((c) => columnMajor[c * 4 + r]!));
    expect(matrixToAngles(columnMajor)!.yaw).toBeCloseTo(20, 6);
    expect(matrixToAngles(rowMajor)!.yaw).toBeCloseTo(-20, 6);
  });

  it('16個に満たないときは null', () => {
    expect(matrixToAngles([1, 0, 0])).toBeNull();
  });
});

function categories(scores: Record<string, number>): BlendshapeCategory[] {
  return Object.entries(scores).map(([categoryName, score]) => ({ categoryName, score }));
}

describe('blendshapesToFrame', () => {
  it('何も無ければ目を開け・正面を見て・口を閉じ・口と眉はふつうの値', () => {
    expect(blendshapesToFrame([])).toEqual({
      eyeOpenL: 1,
      eyeOpenR: 1,
      eyeBallX: 0,
      eyeBallY: 0,
      mouthOpen: 0,
      mouthForm: 0,
      mouthWidth: 0,
      browY: 0,
    });
  });

  it('eyeOpenL・R は 1 − eyeBlink。Left はユーザー自身の左目（MediaPipe の説明どおり。実機で確かめる）', () => {
    const v = blendshapesToFrame(categories({ eyeBlinkLeft: 0.8, eyeBlinkRight: 0.1 }));
    expect(v.eyeOpenL).toBeCloseTo(0.2, 9);
    expect(v.eyeOpenR).toBeCloseTo(0.9, 9);
  });

  it('ユーザーが自分の右を見ると eyeBallX が正（左目は内、右目は外を向く）', () => {
    const v = blendshapesToFrame(categories({ eyeLookInLeft: 0.6, eyeLookOutRight: 0.4 }));
    expect(v.eyeBallX).toBeCloseTo(0.5, 9);
    const w = blendshapesToFrame(categories({ eyeLookOutLeft: 0.6, eyeLookInRight: 0.4 }));
    expect(w.eyeBallX).toBeCloseTo(-0.5, 9);
  });

  it('上を見ると eyeBallY が正、下を見ると負', () => {
    expect(blendshapesToFrame(categories({ eyeLookUpLeft: 0.7, eyeLookUpRight: 0.5 })).eyeBallY).toBeCloseTo(0.6, 9);
    expect(blendshapesToFrame(categories({ eyeLookDownLeft: 0.2, eyeLookDownRight: 0.4 })).eyeBallY).toBeCloseTo(
      -0.3,
      9,
    );
  });

  it('mouthOpen は jawOpen', () => {
    expect(blendshapesToFrame(categories({ jawOpen: 0.35 })).mouthOpen).toBeCloseTo(0.35, 9);
  });

  describe('口の形・口の横幅・眉（STEP1）', () => {
    it('mouthForm = 笑顔の平均 − への字の平均', () => {
      const smile = blendshapesToFrame(
        categories({ mouthSmileLeft: 0.8, mouthSmileRight: 0.6, mouthFrownLeft: 0.1, mouthFrownRight: 0.1 }),
      );
      expect(smile.mouthForm).toBeCloseTo(0.6, 9);
      const frown = blendshapesToFrame(categories({ mouthFrownLeft: 0.5, mouthFrownRight: 0.3 }));
      expect(frown.mouthForm).toBeCloseTo(-0.4, 9);
    });

    it('mouthWidth = 横に引く量の平均 − すぼめる量', () => {
      const wide = blendshapesToFrame(categories({ mouthStretchLeft: 0.4, mouthStretchRight: 0.2, mouthPucker: 0.1 }));
      expect(wide.mouthWidth).toBeCloseTo(0.2, 9);
      const pucker = blendshapesToFrame(
        categories({ mouthStretchLeft: 0.1, mouthStretchRight: 0.1, mouthPucker: 0.9 }),
      );
      expect(pucker.mouthWidth).toBeCloseTo(-0.8, 9);
    });

    it('browY = 眉の内側を上げる量 − 眉を下げる量の平均', () => {
      const up = blendshapesToFrame(categories({ browInnerUp: 0.7, browDownLeft: 0.1, browDownRight: 0.3 }));
      expect(up.browY).toBeCloseTo(0.5, 9);
      const down = blendshapesToFrame(categories({ browDownLeft: 0.6, browDownRight: 0.8 }));
      expect(down.browY).toBeCloseTo(-0.7, 9);
    });

    it('左右のどちらか片方だけでも半分の量になる（左右を取り違えても値は同じ）', () => {
      const l = blendshapesToFrame(categories({ mouthSmileLeft: 0.6, browDownLeft: 0.4 }));
      const r = blendshapesToFrame(categories({ mouthSmileRight: 0.6, browDownRight: 0.4 }));
      expect(l.mouthForm).toBeCloseTo(0.3, 9);
      expect(l.browY).toBeCloseTo(-0.2, 9);
      expect(r.mouthForm).toBeCloseTo(l.mouthForm, 9);
      expect(r.browY).toBeCloseTo(l.browY, 9);
    });

    it('いずれも −1..1 に収まり、−0 にならない（端の値と NaN を含む）', () => {
      const max = blendshapesToFrame(
        categories({
          mouthSmileLeft: 1,
          mouthSmileRight: 1,
          mouthStretchLeft: 1,
          mouthStretchRight: 1,
          browInnerUp: 1,
        }),
      );
      expect([max.mouthForm, max.mouthWidth, max.browY]).toEqual([1, 1, 1]);
      const min = blendshapesToFrame(
        categories({ mouthFrownLeft: 1, mouthFrownRight: 1, mouthPucker: 1, browDownLeft: 1, browDownRight: 1 }),
      );
      expect([min.mouthForm, min.mouthWidth, min.browY]).toEqual([-1, -1, -1]);
      const nan = blendshapesToFrame(categories({ mouthSmileLeft: Number.NaN, mouthPucker: 2, browInnerUp: -1 }));
      expect(nan.mouthForm).toBe(0);
      expect(nan.mouthWidth).toBe(-1);
      expect(Object.is(nan.browY, 0)).toBe(true);
      expect(Object.is(blendshapesToFrame([]).mouthForm, 0)).toBe(true);
    });
  });

  it('0..1 の外のスコアと NaN は丸める', () => {
    const v = blendshapesToFrame(categories({ eyeBlinkLeft: 1.2, eyeBlinkRight: -0.1, jawOpen: Number.NaN }));
    expect(v.eyeOpenL).toBe(0);
    expect(v.eyeOpenR).toBe(1);
    expect(v.mouthOpen).toBe(0);
  });
});

describe('landmarkerResultToFrame', () => {
  const t = rad(20);
  const face: LandmarkerResultLike = {
    faceBlendshapes: [{ categories: categories({ eyeBlinkLeft: 1, jawOpen: 0.5 }) }],
    facialTransformationMatrixes: [{ data: poseMatrix([-Math.sin(t), 0, Math.cos(t)], UP) }],
  };
  const noFace: LandmarkerResultLike = { faceBlendshapes: [], facialTransformationMatrixes: [] };

  it('顔があれば detected true で、行列とブレンドシェイプの値を入れる', () => {
    const f = landmarkerResultToFrame(face, 100, NEUTRAL_TRACKING_FRAME);
    expect(f.time).toBe(100);
    expect(f.detected).toBe(true);
    expect(f.faceYaw).toBeCloseTo(20, 6);
    expect(f.eyeOpenL).toBe(0);
    expect(f.eyeOpenR).toBe(1);
    expect(f.mouthOpen).toBe(0.5);
  });

  it('口の形・口の横幅・眉もフレームに入る', () => {
    const smiling: LandmarkerResultLike = {
      ...face,
      faceBlendshapes: [
        { categories: categories({ mouthSmileLeft: 0.5, mouthSmileRight: 0.5, mouthPucker: 0.4, browInnerUp: 0.3 }) },
      ],
    };
    const f = landmarkerResultToFrame(smiling, 100, NEUTRAL_TRACKING_FRAME);
    expect(f.mouthForm).toBeCloseTo(0.5, 9);
    expect(f.mouthWidth).toBeCloseTo(-0.4, 9);
    expect(f.browY).toBeCloseTo(0.3, 9);
    // まだ推定していない（ブレンドシェイプが一度も無い）ときは undefined のまま
    const noBlendshapes = landmarkerResultToFrame({ ...face, faceBlendshapes: [] }, 100, NEUTRAL_TRACKING_FRAME);
    expect(noBlendshapes.mouthForm).toBeUndefined();
  });

  it('顔が無いフレームは detected false で、ほかの値は前回のまま', () => {
    const previous = landmarkerResultToFrame(face, 100, NEUTRAL_TRACKING_FRAME);
    const f = landmarkerResultToFrame(noFace, 133, previous);
    expect(f).toEqual({ ...previous, time: 133, detected: false });
  });

  it('行列が欠けたときは向きだけ前回のまま', () => {
    const previous = { ...NEUTRAL_TRACKING_FRAME, faceYaw: 7, facePitch: 3, faceRoll: -2 };
    const f = landmarkerResultToFrame({ ...face, facialTransformationMatrixes: [] }, 50, previous);
    expect(f.detected).toBe(true);
    expect([f.faceYaw, f.facePitch, f.faceRoll]).toEqual([7, 3, -2]);
    expect(f.mouthOpen).toBe(0.5);
  });
});
