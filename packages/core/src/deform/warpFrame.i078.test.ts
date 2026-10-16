import { describe, expect, it } from 'vitest';
import type { Binding, Vec2, Warp } from '@app/schema';
import { testModel } from '../eval/testModel';
import { createBindingEvaluator } from '../eval/evaluator';
import { groupPart, imagePart, meshOf } from './testParts';
import { applyWarp, regularWarpPoints } from './warp';
import { baseWarpAngle, reorientWarp, warpFrameBounds } from './warpFrame';
import { pointsToModelSpace, warpPointsToModelSpace } from './space';
import { createDeformPipeline } from './pipeline';
import { refitWarp } from './warpRefit';
import { generateSurfaceKeys } from '../generate/surface';
import { sphereTurn } from '../setup/faceTurn';

const none = { transforms: {}, vertices: {}, warpPoints: {} };
const bounds = { x: 10, y: 20, width: 120, height: 80 };
const warp = (angle = 0): Warp => ({
  id: 'w',
  partId: 'p',
  bounds,
  columns: 2,
  rows: 2,
  angle,
  points: regularWarpPoints(bounds, 2, 2, angle),
});
const near = (a: ArrayLike<number>, b: ArrayLike<number>, tolerance = 0.001) => {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) expect(Math.abs(a[i]! - b[i]!)).toBeLessThan(tolerance);
};
const flatten = (p: Vec2[]) => p.flatMap((v) => [v.x, v.y]);
const binding = (w: Warp): Binding => ({
  id: 'b',
  target: { type: 'warp', id: w.id },
  channel: 'warpPoints',
  parameterIds: ['FaceAngleX'],
  keyValues: [[-30, 0, 30]],
  generation: 'linear',
  divisions: null,
  keys: [-30, 0, 30].map((v) => ({
    coords: [v],
    delta: w.points.map((p) => ({ x: p.x * 0.1 + v / 3, y: p.y * 0.02 - v / 5 })),
    source: 'manual',
    locked: true,
  })),
});

describe('格子の向きと画像自身のワープ（I-078/I-079）', () => {
  it.each([0, 0.14, -1.2, Math.PI])('向き%fの規則的な格子は内外の点を動かさない', (a) => {
    const w = warp(a),
      input = new Float64Array([-20, -30, 40, 50, 70, 60, 200, 210]),
      out = input.slice();
    applyWarp(out, w, undefined);
    near(out, input, 1e-8);
  });

  it('画像自身→自分の変形→親のワープの順で、点の変換と描画が一致する。制御点には自身を二重に掛けない', () => {
    const w = { ...warp(), points: warp().points.map((p) => ({ x: p.x + 10, y: p.y + 3 })) };
    const outer = {
      ...warp(),
      id: 'outer',
      partId: 'g',
      points: warp().points.map((p) => ({ x: p.x - 4, y: p.y + 5 })),
    };
    const p = imagePart('p', { meshId: 'm', parentId: 'g', rotation: 90, pivot: { x: 0, y: 0 } });
    const m = testModel({
      parts: [groupPart('g'), p],
      meshes: [meshOf('m', [{ x: 40, y: 50 }])],
      warps: [w, outer],
      drawOrder: ['p'],
    });
    const expected = [-57, 55];
    near(createDeformPipeline().deform(m, none).byPartId.p!.positions, expected);
    near(flatten(pointsToModelSpace(m, none, 'p', [{ x: 40, y: 50 }])), expected);
    near(flatten(warpPointsToModelSpace(m, none, 'p', [{ x: 50, y: 53 }])), expected);
  });

  it('基準の回転を打ち消して格子の横と縦が画面に沿う。キーの傾きは一緒に回る', () => {
    const m = testModel({ parts: [groupPart('g', { rotation: 8 }), imagePart('p', { parentId: 'g', rotation: 12 })] });
    const a = baseWarpAngle(m, 'p');
    expect(a).toBeCloseTo((-20 * Math.PI) / 180);
    const w = warp(a),
      pts = warpPointsToModelSpace(m, none, 'p', w.points);
    expect(pts[0]!.y).toBeCloseTo(pts[2]!.y, 8);
    expect(pts[0]!.x).toBeCloseTo(pts[6]!.x, 8);
    const d = {
      ...none,
      transforms: { g: { position: { x: 0, y: 0 }, rotation: 10, scale: { x: 1, y: 1 }, opacity: 1 } },
    };
    const tilted = warpPointsToModelSpace(m, d, 'p', w.points);
    expect(Math.atan2(tilted[2]!.y - tilted[0]!.y, tilted[2]!.x - tilted[0]!.x)).toBeCloseTo((10 * Math.PI) / 180);
    const b = warpFrameBounds(w.points, a)!;
    expect(b.width).toBeCloseTo(bounds.width);
    expect(b.height).toBeCloseTo(bounds.height);
  });

  it('格子の向きを変えても一次の基準・非ゼロ既定値・キーと補間を保ち、メタ情報も残す', () => {
    const old = { ...warp(), points: warp().points.map((p) => ({ x: p.x * 1.1 + 7, y: p.y * 0.8 + 2 })) },
      b = binding(old);
    const result = reorientWarp(old, -0.14, [b])!;
    expect(result.bindings[0]!.keys.map(({ delta: _, ...k }) => k)).toEqual(b.keys.map(({ delta: _, ...k }) => k));
    const evaluator = createBindingEvaluator();
    for (let value = -30; value <= 30; value += 3) {
      const input = new Float64Array([-50, -80, 40, 50, 180, 170]),
        before = input.slice(),
        after = input.slice();
      const evalOld = evaluator.evaluate(testModel({ warps: [old], bindings: [b] }), { FaceAngleX: value });
      const evalNext = evaluator.evaluate(testModel({ warps: [result.warp], bindings: result.bindings }), {
        FaceAngleX: value,
      });
      applyWarp(before, old, evalOld.warpPoints.w);
      applyWarp(after, result.warp, evalNext.warpPoints.w);
      near(after, before);
    }
  });

  it('曲げた格子の向きを変えると近似になる。壊れたキーは変更せず、同じ向きは何もしない', () => {
    const w = warp();
    w.points[4] = { x: w.points[4]!.x + 20, y: w.points[4]!.y - 10 };
    const result = reorientWarp(w, -0.14, [])!;
    const before = new Float64Array([48, 43]),
      after = before.slice();
    applyWarp(before, w, undefined);
    applyWarp(after, result.warp, undefined);
    expect(Math.hypot(before[0]! - after[0]!, before[1]! - after[1]!)).toBeGreaterThan(0.1);
    expect(reorientWarp(w, 0, [])!.warp).toBe(w);
    const b = binding(w);
    b.keys[0]!.delta = [];
    expect(reorientWarp(w, -0.14, [b])).toBeNull();
  });

  it('向きのある格子を広げても、セルと非ゼロの既定値・全キーの写像を保つ', () => {
    const w = warp(-0.3),
      b = binding(w);
    w.points[4]!.x += 7;
    const r = refitWarp(w, { x: -40, y: -20, width: 250, height: 200 }, [b])!;
    for (let value = -30; value <= 30; value += 5) {
      const evaluator = createBindingEvaluator(),
        input = new Float64Array([-10, -30, 70, 60, 210, 160]),
        before = input.slice(),
        after = input.slice();
      applyWarp(
        before,
        w,
        evaluator.evaluate(testModel({ warps: [w], bindings: [b] }), { FaceAngleX: value }).warpPoints.w,
      );
      applyWarp(
        after,
        r.warp,
        evaluator.evaluate(testModel({ warps: [r.warp], bindings: r.bindings }), { FaceAngleX: value }).warpPoints.w,
      );
      near(after, before);
    }
  });

  it('曲面と斜めの合成は格子の向きで回る。0のキーはゼロを保つ', () => {
    const plain = warp(),
      rotated = warp(0.3),
      c = Math.cos(0.3),
      s = Math.sin(0.3);
    for (const param of ['FaceAngleX', 'FaceAngleY'] as const) {
      const a = generateSurfaceKeys(plain, param, [0, 30]),
        b = generateSurfaceKeys(rotated, param, [0, 30]);
      near(flatten(b[0]!), flatten(a[0]!), 1e-8);
      near(flatten(b[1]!), flatten(a[1]!.map((p) => ({ x: c * p.x - s * p.y, y: s * p.x + c * p.y }))), 1e-8);
    }
    near(
      flatten(sphereTurn(rotated, 30, 30)),
      flatten(sphereTurn(plain, 30, 30).map((p) => ({ x: c * p.x - s * p.y, y: s * p.x + c * p.y }))),
      1e-5,
    );
  });
});
