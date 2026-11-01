// AT-02 の独立確認（CL）。期待値は報告（docs/arm-tracking/reports/AT-02-rig.md）の約束から別に計算し、
// CO の補助試験と実装の式を写さない。対象の版は evidence/AT-02/manifest.json の kinematics.ts・render.ts。
import { describe, expect, it } from 'vitest';
import poses from '../../../docs/arm-tracking/evidence/AT-02/poses.json';
import {
  constrain,
  forward,
  fromWorld,
  handPoint,
  POSES,
  referencePoint,
  REST,
  solveTarget,
  toWorld,
  waveAt,
  type Point,
  type Pose,
  type Side,
} from './kinematics';
import { sceneContent } from './render';

const D = Math.PI / 180;
const close = (a: Point, b: Point, digits = 9): void => {
  expect(a.x).toBeCloseTo(b.x, digits);
  expect(a.y).toBeCloseTo(b.y, digits);
};
const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const rotate = (v: Point, degrees: number): Point => ({
  x: v.x * Math.cos(degrees * D) - v.y * Math.sin(degrees * D),
  y: v.x * Math.sin(degrees * D) + v.y * Math.cos(degrees * D),
});

// 報告の約束: L の肩 (78,240)・R は (-78,240)。骨の向きは L が (sin a, cos a)、R は x だけ符号反転。
// 上腕 118・前腕 108。手の回転は L が 180−s−e−w、R はその符号反転
function expected(pose: Pose, side: Side) {
  const k = side === 'L' ? 1 : -1;
  const shoulder = { x: 78 * k, y: 240 };
  const a = pose.shoulder * D;
  const b = (pose.shoulder + pose.elbow) * D;
  const elbow = { x: shoulder.x + k * 118 * Math.sin(a), y: shoulder.y + 118 * Math.cos(a) };
  const wrist = { x: elbow.x + k * 108 * Math.sin(b), y: elbow.y + 108 * Math.cos(b) };
  return { shoulder, elbow, wrist, handRotation: k * (180 - pose.shoulder - pose.elbow - pose.wrist) };
}

const RANGES = { shoulder: [-25, 160], elbow: [0, 145], wrist: [-40, 40], forearm: [-25, 300], hand: [-55, 300] };
const inRange = (p: Pose): boolean =>
  p.shoulder >= RANGES.shoulder[0]! &&
  p.shoulder <= RANGES.shoulder[1]! &&
  p.elbow >= RANGES.elbow[0]! &&
  p.elbow <= RANGES.elbow[1]! &&
  p.wrist >= RANGES.wrist[0]! &&
  p.wrist <= RANGES.wrist[1]! &&
  p.shoulder + p.elbow >= RANGES.forearm[0]! &&
  p.shoulder + p.elbow <= RANGES.forearm[1]! &&
  p.shoulder + p.elbow + p.wrist >= RANGES.hand[0]! &&
  p.shoulder + p.elbow + p.wrist <= RANGES.hand[1]!;

describe('AT-02 独立確認: 基準座標', () => {
  it('肘 0・45・90° と休止姿勢を手計算の座標と照合する（L/R）', () => {
    const half = 118 / Math.SQRT2;
    const cases: [Pose, Point, Point, number][] = [
      [{ shoulder: 0, elbow: 0, wrist: 0 }, { x: 78, y: 358 }, { x: 78, y: 466 }, 180],
      [
        { shoulder: 45, elbow: 45, wrist: 0 },
        { x: 78 + half, y: 240 + half },
        { x: 78 + half + 108, y: 240 + half },
        90,
      ],
      [{ shoulder: 90, elbow: 90, wrist: 0 }, { x: 196, y: 240 }, { x: 196, y: 132 }, 0],
    ];
    for (const [pose, elbow, wrist, hand] of cases) {
      const left = forward(pose, 'L');
      close(left.elbow, elbow);
      close(left.wrist, wrist);
      expect(left.handRotation).toBeCloseTo(hand, 9);
      const right = forward(pose, 'R');
      close(right.elbow, { x: -elbow.x, y: elbow.y });
      close(right.wrist, { x: -wrist.x, y: wrist.y });
      expect(right.handRotation).toBeCloseTo(-hand, 9);
    }
  });

  it('証跡 poses.json の全姿勢・左右で、制約後の角から別計算した座標と一致し、親の変換は等倍率の回転だけ', () => {
    expect(poses.poses).toHaveLength(16);
    for (const scene of poses.poses) {
      for (const applied of scene.applied) {
        const side = applied.side as Side;
        const want = expected(applied.pose, side);
        close(applied.model.shoulder, want.shoulder);
        close(applied.model.elbow, want.elbow);
        close(applied.model.wrist, want.wrist);
        expect(applied.model.handRotation).toBeCloseTo(want.handRotation, 9);
        expect(inRange(applied.pose)).toBe(true);
        // 世界座標の骨 = 親の倍率 × 親の回転 × モデルの骨（呼吸・pivot の位置に依らない）
        const { rotation, scale } = scene.parent;
        for (const [from, to] of [
          ['shoulder', 'elbow'],
          ['elbow', 'wrist'],
        ] as const) {
          const model = sub(applied.model[to], applied.model[from]);
          const world = sub(applied.world[to], applied.world[from]);
          const turned = rotate(model, rotation);
          close(world, { x: turned.x * scale, y: turned.y * scale });
        }
      }
    }
  });
});

describe('AT-02 独立確認: 角度の制約', () => {
  it('報告の例と非有限の入力', () => {
    expect(constrain({ shoulder: 160, elbow: 145, wrist: 40 }).pose).toEqual({ shoulder: 160, elbow: 140, wrist: 0 });
    expect(constrain({ shoulder: -25, elbow: 0, wrist: -40 }).pose).toEqual({ shoulder: -25, elbow: 0, wrist: -30 });
    expect(constrain({ shoulder: Number.NaN, elbow: 10, wrist: 0 }).pose).toEqual(REST);
    expect(constrain({ shoulder: 10, elbow: Number.POSITIVE_INFINITY, wrist: 0 }).pose).toEqual(REST);
  });

  it('範囲の内外を 5° 刻みで調べ、出力は常に全区間の中、範囲内の入力は変えず、2回かけても同じ', () => {
    for (let s = -60; s <= 200; s += 5)
      for (let e = -30; e <= 190; e += 5)
        for (let w = -80; w <= 80; w += 10) {
          const input = { shoulder: s, elbow: e, wrist: w };
          const out = constrain(input).pose;
          expect(inRange(out)).toBe(true);
          if (inRange(input)) expect(out).toEqual(input);
          expect(constrain(out).pose).toEqual(out);
        }
  });
});

describe('AT-02 独立確認: 左右と掌面', () => {
  it('R は L の x 反転の位置。手の変換は回転と正の倍率だけで、行列式は正（裏返らない）', () => {
    for (const parent of [
      { rotation: 0, scale: 1, breath: 0 },
      { rotation: 23, scale: 1.7, breath: 6 },
      { rotation: -12, scale: 0.85, breath: -3 },
    ])
      for (const pose of [REST, { shoulder: 110, elbow: 130, wrist: -30 }, { shoulder: 160, elbow: 20, wrist: 40 }])
        for (const side of ['L', 'R'] as const) {
          const o = handPoint({ x: 0, y: 0 }, pose, side, parent);
          const ex = sub(handPoint({ x: 1, y: 0 }, pose, side, parent), o);
          const ey = sub(handPoint({ x: 0, y: 1 }, pose, side, parent), o);
          expect(ex.x * ey.y - ex.y * ey.x).toBeCloseTo(parent.scale ** 2, 9);
        }
  });

  it('掌を前に向けた腕で、親指は下ろすと体の外側・上げると頭の側（render の親指の印 L:-31, R:+31）', () => {
    const thumb = { L: { x: -31, y: -36 }, R: { x: 31, y: -36 } } as const;
    const down = { shoulder: 0, elbow: 0, wrist: 0 };
    const up = { shoulder: 160, elbow: 20, wrist: 0 };
    for (const side of ['L', 'R'] as const) {
      const outward = side === 'L' ? 1 : -1; // L は画面の右側にある
      const wristDown = forward(down, side).wrist;
      const wristUp = forward(up, side).wrist;
      expect(Math.sign(handPoint(thumb[side], down, side).x - wristDown.x)).toBe(outward);
      expect(Math.sign(handPoint(thumb[side], up, side).x - wristUp.x)).toBe(-outward);
    }
  });
});

describe('AT-02 独立確認: 基準角からの差分と親', () => {
  it('曲がった基準姿勢 (25,65,10) の点を、各姿勢の関節位置と手の向きへ運ぶ', () => {
    const reference = { shoulder: 25, elbow: 65, wrist: 10 };
    const parent = { rotation: 23, scale: 1.7, breath: 6 };
    for (const pose of [REST, { shoulder: 110, elbow: 130, wrist: -30 }, { shoulder: -25, elbow: 0, wrist: -30 }])
      for (const side of ['L', 'R'] as const) {
        const base = expected(reference, side);
        const want = expected(pose, side);
        close(referencePoint(base.elbow, reference, pose, side, 'upper'), want.elbow);
        close(referencePoint(base.wrist, reference, pose, side, 'lower'), want.wrist);
        const offset = { x: 5, y: -20 };
        const moved = referencePoint(
          { x: base.wrist.x + offset.x, y: base.wrist.y + offset.y },
          reference,
          pose,
          side,
          'hand',
        );
        const turned = rotate(offset, want.handRotation - base.handRotation);
        close(moved, { x: want.wrist.x + turned.x, y: want.wrist.y + turned.y });
        // 親は最後に1回だけ
        close(referencePoint(base.wrist, reference, pose, side, 'lower', parent), toWorld(want.wrist, parent));
      }
  });

  it('親の変換は往復で戻り、0 以下の倍率は受け付けない', () => {
    const parent = { rotation: 37, scale: 0.6, breath: 4 };
    const p = { x: 123.4, y: 456.7 };
    close(fromWorld(toWorld(p, parent), parent), p);
    expect(() => toWorld(p, { rotation: 0, scale: 0, breath: 0 })).toThrow();
    expect(() => toWorld(p, { rotation: 0, scale: -1, breath: 0 })).toThrow();
  });
});

describe('AT-02 独立確認: 連続性と到達不能', () => {
  it('1Hz の手振りを 60fps で10秒: 全て有限・範囲内で、1フレームの変化が小さく、手の回転が一周しない', () => {
    let previous: ReturnType<typeof forward> | null = null;
    let largest = 0;
    for (let i = 0; i <= 600; i++) {
      const scene = waveAt(i / 60);
      for (const side of ['L', 'R'] as const) {
        const pose = constrain(side === 'L' ? scene.left : scene.right).pose;
        expect(inRange(pose)).toBe(true);
        const arm = forward(pose, side);
        expect([arm.elbow.x, arm.elbow.y, arm.wrist.x, arm.wrist.y, arm.handRotation].every(Number.isFinite)).toBe(
          true,
        );
        if (side === 'L') {
          if (previous) largest = Math.max(largest, Math.abs(arm.handRotation - previous.handRotation));
          previous = arm;
        }
      }
    }
    expect(largest).toBeLessThan(5);
  });

  it('届かない目標でも骨長と可動域を守り、届く目標にはほぼ一致する', () => {
    for (const side of ['L', 'R'] as const)
      for (const target of [
        { x: 1000, y: -1000 },
        { x: -1000, y: 1000 },
        { x: side === 'L' ? 78 : -78, y: 240 },
        { x: 0, y: 0 },
      ]) {
        const result = solveTarget(target, side);
        expect(inRange(result.pose)).toBe(true);
        const arm = forward(result.pose, side);
        expect(Math.hypot(arm.elbow.x - arm.shoulder.x, arm.elbow.y - arm.shoulder.y)).toBeCloseTo(118, 9);
        expect(Math.hypot(arm.wrist.x - arm.elbow.x, arm.wrist.y - arm.elbow.y)).toBeCloseTo(108, 9);
        expect(Number.isFinite(result.error)).toBe(true);
      }
    const reachable = expected({ shoulder: 110, elbow: 130, wrist: 0 }, 'L').wrist;
    const solved = solveTarget(reachable, 'L');
    expect(solved.error).toBeLessThan(0.05);
    expect(solved.pose.shoulder).toBeCloseTo(110, 1);
    expect(solved.pose.elbow).toBeCloseTo(130, 1);
  });
});

describe('AT-02 独立確認: 描画順', () => {
  it('胴体→上腕→顔・前髪→前腕→手 L→手 R の順に描く（全姿勢）', () => {
    for (const scene of POSES) {
      const svg = sceneContent(scene, false);
      const order = [
        svg.indexOf('fill="#dce6ec"'), // 胴体
        svg.indexOf('stroke-width="35"'), // 上腕
        svg.indexOf('<ellipse'), // 顔
        svg.indexOf('fill="#b3c3ce"'), // 前髪
        svg.indexOf('stroke-width="27"'), // 前腕
        svg.indexOf('data-hand="L"'),
        svg.indexOf('data-hand="R"'),
      ];
      expect(order.every((i) => i >= 0)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
    }
  });
});
