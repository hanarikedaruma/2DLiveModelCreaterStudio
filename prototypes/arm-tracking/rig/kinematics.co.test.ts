import { describe, it, expect } from 'vitest';
import {
  RIG,
  REST,
  POSES,
  constrain,
  distance,
  forward,
  toWorld,
  fromWorld,
  handPoint,
  referencePoint,
  solveTarget,
  waveAt,
  transitionAt,
} from './kinematics';
import { handSvg, sceneContent } from './render';

describe('AT-02 CO補助試験（CLの独立確認とは別）', () => {
  it('左右の0・90度を手計算の座標と照合する', () => {
    expect(forward({ shoulder: 0, elbow: 0, wrist: 0 }, 'L').wrist).toEqual({ x: 78, y: 466 });
    expect(forward({ shoulder: 0, elbow: 0, wrist: 0 }, 'R').wrist).toEqual({ x: -78, y: 466 });
    const left = forward({ shoulder: 90, elbow: 90, wrist: 0 }, 'L');
    expect(left.elbow.x).toBeCloseTo(196, 10);
    expect(left.elbow.y).toBeCloseTo(240, 10);
    expect(left.wrist.x).toBeCloseTo(196, 10);
    expect(left.wrist.y).toBeCloseTo(132, 10);
    const diagonal = forward({ shoulder: 45, elbow: 45, wrist: 0 }, 'L');
    expect(diagonal.elbow.x).toBeCloseTo(161.4386001800126, 10);
    expect(diagonal.wrist.x).toBeCloseTo(269.4386001800126, 10);
    expect(diagonal.wrist.y).toBeCloseTo(323.4386001800126, 10);
  });
  it('全域の角度・合成角度が有限で、肘が逆に曲がらない', () => {
    for (let s = -540; s <= 540; s += 15)
      for (let e = -180; e <= 360; e += 15)
        for (const w of [-180, -40, 0, 40, 180]) {
          const p = constrain({ shoulder: s, elbow: e, wrist: w }).pose;
          expect(p.shoulder).toBeGreaterThanOrEqual(-25);
          expect(p.shoulder).toBeLessThanOrEqual(160);
          expect(p.elbow).toBeGreaterThanOrEqual(0);
          expect(p.elbow).toBeLessThanOrEqual(145);
          expect(p.wrist).toBeGreaterThanOrEqual(-40);
          expect(p.wrist).toBeLessThanOrEqual(40);
          expect(p.shoulder + p.elbow).toBeLessThanOrEqual(300);
          expect(p.shoulder + p.elbow + p.wrist).toBeGreaterThanOrEqual(-55);
          expect(p.shoulder + p.elbow + p.wrist).toBeLessThanOrEqual(300);
        }
  });
  it('非有限入力・負倍率は受け付けない', () => {
    for (const v of [NaN, Infinity, -Infinity])
      expect(constrain({ shoulder: v, elbow: 3, wrist: 0 }).pose).toEqual(REST);
    expect(() => toWorld({ x: 2, y: 3 }, { rotation: 0, scale: -1, breath: 0 })).toThrow();
    expect(solveTarget({ x: NaN, y: 1 }, 'L').pose).toEqual(REST);
  });
  it('親の回転・拡縮・呼吸後も骨長と手首の接続を保つ', () => {
    for (const scene of POSES)
      for (const side of ['L', 'R'] as const) {
        const pose = constrain(side === 'L' ? scene.left : scene.right).pose,
          a = forward(pose, side),
          parent = { rotation: 23, scale: 1.7, breath: 6 };
        const s = toWorld(a.shoulder, parent),
          e = toWorld(a.elbow, parent),
          w = toWorld(a.wrist, parent);
        expect(distance(s, e)).toBeCloseTo(118 * 1.7, 8);
        expect(distance(e, w)).toBeCloseTo(108 * 1.7, 8);
        expect(handPoint({ x: 0, y: 0 }, pose, side, parent)).toEqual(w);
        expect(distance(fromWorld(w, parent), a.wrist)).toBeLessThan(1e-10);
      }
  });
  it('手の変換が左右とも向きを反転しない', () => {
    for (const scene of POSES)
      for (const side of ['L', 'R'] as const) {
        const pose = constrain(side === 'L' ? scene.left : scene.right).pose;
        const o = handPoint({ x: 0, y: 0 }, pose, side, scene.parent),
          x = handPoint({ x: 1, y: 0 }, pose, side, scene.parent),
          y = handPoint({ x: 0, y: 1 }, pose, side, scene.parent);
        expect((x.x - o.x) * (y.y - o.y) - (x.y - o.y) * (y.x - o.x)).toBeCloseTo(scene.parent.scale ** 2, 8);
      }
  });
  it('曲がった基準姿勢の子→親の差分回転が絶対座標と一致する', () => {
    const reference = { shoulder: 25, elbow: 65, wrist: 10 },
      parent = { rotation: 23, scale: 1.7, breath: 6 };
    for (const side of ['L', 'R'] as const)
      for (const scene of POSES) {
        const pose = constrain(side === 'L' ? scene.left : scene.right).pose;
        const rest = forward(reference, side),
          target = forward(pose, side);
        expect(
          distance(referencePoint(rest.elbow, reference, pose, side, 'upper', parent), toWorld(target.elbow, parent)),
        ).toBeLessThan(1e-10);
        expect(
          distance(referencePoint(rest.wrist, reference, pose, side, 'lower', parent), toWorld(target.wrist, parent)),
        ).toBeLessThan(1e-10);
        const local = { x: -17, y: -60 },
          referenceHand = handPoint(local, reference, side);
        expect(
          distance(
            referencePoint(referenceHand, reference, pose, side, 'hand', parent),
            handPoint(local, pose, side, parent),
          ),
        ).toBeLessThan(1e-10);
      }
  });
  it('4形は左右別の形状で、顔より前に描く', () => {
    for (const shape of ['open', 'fist', 'point', 'peace'] as const)
      expect(handSvg('L', shape)).not.toEqual(handSvg('R', shape));
    const s = sceneContent(POSES[8]!);
    expect(s.indexOf('data-hand="L"')).toBeGreaterThan(s.indexOf('<ellipse'));
    expect(s).not.toContain('scale(-');
    expect(() => sceneContent({ ...POSES[0]!, parent: { rotation: 0, scale: -1, breath: 0 } })).toThrow();
  });
  it('固定した枝の有界探索で既知の到達可能な点を追える', () => {
    for (const pose of [
      { shoulder: 45, elbow: 90, wrist: 0 },
      { shoulder: 110, elbow: 130, wrist: -30 },
      { shoulder: 90, elbow: 0, wrist: 0 },
    ])
      for (const side of ['L', 'R'] as const)
        expect(solveTarget(forward(pose, side).wrist, side, pose.wrist).error).toBeLessThan(0.1);
  });
  it('到達不能な目標へ腕を伸ばしたり回転を蓄積したりしない', () => {
    for (const target of [
      { x: 1000, y: -1000 },
      { x: -1000, y: 1000 },
      { x: 78, y: 240 },
    ]) {
      const result = solveTarget(target, 'L'),
        a = forward(result.pose, 'L');
      expect(result.limited).toBe(true);
      expect(result.error).toBeGreaterThan(1);
      expect(distance(a.shoulder, a.elbow)).toBeCloseTo(RIG.upperLength, 8);
      expect(distance(a.elbow, a.wrist)).toBeCloseTo(RIG.lowerLength, 8);
    }
  });
  it('1Hzの手振りを60fpsで10往復しても枝と長さを保つ', () => {
    let prev = constrain(waveAt(0).left).pose;
    for (let i = 1; i <= 600; i++) {
      const p = constrain(waveAt(i / 60).left).pose,
        a = forward(p, 'L');
      expect(Math.abs(p.shoulder - prev.shoulder)).toBeLessThan(1);
      expect(Math.abs(p.elbow - prev.elbow)).toBeLessThan(1.1);
      expect(Math.abs(p.wrist - prev.wrist)).toBeLessThan(2.7);
      expect(distance(a.shoulder, a.elbow)).toBeCloseTo(118, 8);
      prev = p;
    }
  });
  it('指さしから顔の前への連続遷移も制約内で、手形は1種類に切り替わる', () => {
    for (let i = 0; i <= 120; i++) {
      const scene = transitionAt(POSES[6]!, POSES[8]!, i / 120);
      expect(constrain(scene.left).reasons).toEqual([]);
      expect(scene.leftHand).toBe(i < 60 ? 'point' : 'peace');
    }
  });
});
