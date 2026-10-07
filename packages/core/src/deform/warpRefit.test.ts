import { describe, expect, it } from 'vitest';
import type { Binding, Warp } from '@app/schema';
import { applyWarp, regularWarpPoints } from './warp';
import { refitWarp } from './warpRefit';
import { createBindingEvaluator } from '../eval/evaluator';
import { testModel } from '../eval/testModel';
import { createDeformPipeline } from './pipeline';
import { groupPart, imagePart, meshOf } from './testParts';

const original = (): Warp => ({
  id: 'w',
  partId: 'g',
  columns: 3,
  rows: 2,
  bounds: { x: 10, y: 20, width: 120, height: 100 },
  points: regularWarpPoints({ x: 10, y: 20, width: 120, height: 100 }, 3, 2).map((p, i) => ({
    x: p.x + Math.sin(i) * 14,
    y: p.y + Math.cos(i) * 9,
  })),
});
const binding = (warp: Warp): Binding => ({
  id: 'b',
  target: { type: 'warp', id: warp.id },
  channel: 'warpPoints',
  parameterIds: ['FaceAngleX'],
  keyValues: [[-30, 0, 30]],
  generation: 'linear',
  divisions: null,
  keys: [-30, 0, 30].map((v, k) => ({
    coords: [v],
    source: k === 0 ? 'auto' : 'manual',
    locked: k === 2,
    delta: warp.points.map((_, i) => ({ x: Math.sin(i * 2 + k) * 23, y: Math.cos(i + k) * 17 })),
  })),
});

describe('格子の範囲を合わせ直す', () => {
  it('多段ワープと回転・非一様な拡縮がある親でも、全キーと途中の値の頂点を保つ', () => {
    const w = original();
    const b = binding(w);
    const outer = { ...original(), id: 'outer', partId: 'root' };
    const model = testModel({
      parts: [
        groupPart('root', { rotation: 37, scale: { x: 1.4, y: 0.7 } }),
        groupPart('g', { parentId: 'root', rotation: -23, scale: { x: -1.2, y: 0.8 } }),
        imagePart('p', { parentId: 'g', meshId: 'm' }),
      ],
      meshes: [
        meshOf('m', [
          { x: -40, y: -10 },
          { x: 70, y: 55 },
          { x: 185, y: 155 },
          { x: 200, y: 210 },
        ]),
      ],
      warps: [w, outer],
      bindings: [b],
      drawOrder: ['p'],
    });
    const r = refitWarp(w, { x: -70, y: -80, width: 400, height: 380 }, model.bindings)!;
    const next = { ...model, warps: [r.warp, outer], bindings: r.bindings };
    const evaluate = createBindingEvaluator();
    const pipeline = createDeformPipeline();
    for (let v = -30; v <= 30; v += 3) {
      const before = pipeline.deform(model, evaluate.evaluate(model, { FaceAngleX: v })).byPartId.p!.positions;
      const after = pipeline.deform(next, evaluate.evaluate(next, { FaceAngleX: v })).byPartId.p!.positions;
      after.forEach((value, i) => expect(Math.abs(value - before[i]!)).toBeLessThan(0.01));
    }
  });
  it('元のセルの境界を残して広げ、全キーと補間中・元の格子外でも同じ写像になる', () => {
    const w = original();
    const b = binding(w);
    const result = refitWarp(w, { x: -37, y: -18, width: 260, height: 201 }, [b])!;
    expect(result.warp.bounds).toEqual({ x: -70, y: -30, width: 320, height: 250 });
    const probes = new Float64Array(
      Array.from({ length: 101 }, (_, i) => [-85 + i * 3.7, -55 + ((i * 17) % 330)]).flat(),
    );
    for (let t = 0; t <= 2; t += 0.1) {
      const lo = Math.min(1, Math.floor(t));
      const s = t - lo;
      const delta = (keys: Binding['keys']) =>
        new Float32Array(
          (keys[lo]!.delta as { x: number; y: number }[]).flatMap((d, i) => {
            const e = (keys[lo + 1]!.delta as { x: number; y: number }[])[i]!;
            return [d.x * (1 - s) + e.x * s, d.y * (1 - s) + e.y * s];
          }),
        );
      const before = probes.slice();
      const after = probes.slice();
      applyWarp(before, w, delta(b.keys));
      applyWarp(after, result.warp, delta(result.bindings[0]!.keys));
      after.forEach((v, i) => expect(Math.abs(v - before[i]!)).toBeLessThan(0.01));
    }
    expect(result.bindings[0]!.keys.map(({ delta: _, ...meta }) => meta)).toEqual(
      b.keys.map(({ delta: _, ...meta }) => meta),
    );
    expect(w.points).toHaveLength(12);
    expect(b.keys[0]!.delta).toHaveLength(12);
  });
  it('内側の範囲なら格子もキーも作り直さない', () => {
    const w = original();
    const b = binding(w);
    const result = refitWarp(w, { x: 15, y: 25, width: 80, height: 70 }, [b])!;
    expect(result.warp).toBe(w);
    expect(result.bindings[0]).toBe(b);
  });
  it('無効な格子や範囲、壊れたキーは置き換えない', () => {
    const w = original();
    const b = binding(w);
    expect(refitWarp({ ...w, columns: 0 }, w.bounds, [b])).toBeNull();
    expect(refitWarp(w, { ...w.bounds, width: Infinity }, [b])).toBeNull();
    expect(refitWarp(w, { ...w.bounds, width: 300 }, [{ ...b, keys: [{ ...b.keys[0]!, delta: [] }] }])).toBeNull();
  });
});
