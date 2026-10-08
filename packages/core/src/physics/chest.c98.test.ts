import { describe, expect, it } from 'vitest';
import { validateProject, loadProjectJson, standardParametersFor } from '@app/schema';
import { createBindingEvaluator } from '../eval/evaluator';
import { createDeformPipeline } from '../deform/pipeline';
import { bounceFrame, bounceWeights, safeBounceScale, limitChestOutput } from './bounce';
import { chestEquilibrium, ChestDynamicsSession } from './chestSession';
import { createPhysicsEngine } from './engine';
import { chestFixture } from './testChest.c98';

describe('胸の重力・慣性と保存', () => {
  it('胸を使うときだけ2出力を追加し、固定した脇と上端を変形しない', () => {
    const p = chestFixture(),
      item = p.physics[0]!;
    expect(standardParametersFor('step2').some((p) => p.id === 'BustX' || p.id === 'BustY')).toBe(false);
    expect(p.model.parameters.some((p) => p.id === 'BustX')).toBe(true);
    expect(bounceWeights(p.model.meshes[1]!)).toEqual([0, 0, 0, 0, expect.any(Number), 0, 0, 1, 0]);
    const actual = createDeformPipeline().deform(
      p.model,
      createBindingEvaluator().evaluate(p.model, { BustX: 1, BustY: 1 }),
    );
    const base = createDeformPipeline().deform(p.model, createBindingEvaluator().evaluate(p.model, {}));
    for (const i of [0, 1, 2, 3, 5, 6, 8])
      expect(Array.from(actual.byPartId.chest!.positions.slice(i * 2, i * 2 + 2))).toEqual(
        Array.from(base.byPartId.chest!.positions.slice(i * 2, i * 2 + 2)),
      );
    expect(item.bounce!.weights[7]).toBe(1);
  });
  it.each([-90, -45, 0, 45, 90])('静止した%s度でも重力との釣り合いを出し、読込で基準を変えない', (angle) => {
    const p = chestFixture(),
      item = p.physics[0]!,
      b = item.bounce!;
    const engine = createPhysicsEngine();
    const values = engine.produce({
      project: p,
      mixedSoFar: { BodyAngleZ: angle },
      now: 0,
      dt: 0,
      flags: { lipSyncWeight: 1, physicsActive: true },
    })!.values;
    const rad = (angle * Math.PI) / 180;
    expect(values.BustX).toBeCloseTo((Math.sin(rad) * b.gravityStrength * b.amplitudes.y) / b.amplitudes.x, 5);
    expect(values.BustY).toBeCloseTo((1 - Math.cos(rad)) * b.gravityStrength, 5);
    const loaded = loadProjectJson(JSON.stringify(p));
    expect(loaded.physics[0]!.bounce).toEqual(b);
    expect(validateProject(p)).toEqual(p);
  });
  it('横に加速すると、体が45度でもモデル座標の逆方向に遅れる', () => {
    const p = chestFixture(),
      item = p.physics[0]!;
    const deltas = createBindingEvaluator().evaluate(p.model, { BodyAngleZ: 45 });
    const frame = bounceFrame(p, item, deltas)!;
    const session = new ChestDynamicsSession();
    const equilibrium = chestEquilibrium(item.bounce!, frame.basis);
    session.advance(item, frame, { now: 0, dt: 0 });
    for (let i = 1; i <= 20; i++) {
      const t = i / 120;
      session.advance(
        item,
        { ...frame, center: { x: frame.center.x + 40 * t * t, y: frame.center.y } },
        { now: (i * 1000) / 120, dt: 1000 / 120 },
      );
    }
    expect(session.state(item.id)!.q.x).toBeLessThan(equilibrium.x);
    expect(session.state(item.id)!.q.y).toBeCloseTo(equilibrium.y, 5);
  });
  it('同じフレームを再表示しても再積分せず、長い停止を移動の衝撃にしない', () => {
    const p = chestFixture(),
      item = p.physics[0]!,
      frame = bounceFrame(p, item, createBindingEvaluator().evaluate(p.model, {}))!;
    const session = new ChestDynamicsSession();
    const ctx = { now: 0, dt: 0, frameId: 'a' };
    session.advance(item, frame, ctx);
    const next = { ...frame, center: { x: frame.center.x + 10, y: frame.center.y } };
    const q = session.advance(item, next, { now: 16, dt: 16, frameId: 'b' });
    expect(session.advance(item, next, { now: 16, dt: 16, frameId: 'b' })).toEqual(q);
    expect(
      session.advance(item, { ...frame, center: { x: 5000, y: 5000 } }, { now: 5000, dt: 4984, frameId: 'c' }),
    ).toEqual({ x: 0, y: 0 });
  });
  it('薄い三角形で同時に両方向へ振れても反転しない幅へ制限する', () => {
    const p = chestFixture(),
      mesh = p.model.meshes[1]!;
    const positions = Float32Array.from(mesh.vertices.flatMap((v) => [v.x, v.y]));
    const scale = safeBounceScale(mesh, positions, p.physics[0]!.bounce!.weights, { x: 1000, y: -1000 });
    expect(scale).toBeGreaterThan(0);
    expect(scale).toBeLessThan(1);
  });
  it('手編集した場も実際のキーを評価し、最終三角形の符号と10%の面積を残す', () => {
    const p = chestFixture(),
      item = p.physics[0]!,
      ev = createBindingEvaluator();
    const binding = p.model.bindings.find((b) => b.id === 'bx')!;
    binding.keys = binding.keys.map((k) => ({
      ...k,
      source: 'manual',
      delta: (k.delta as { x: number; y: number }[]).map((v) => ({ x: v.x * 1000, y: v.y })),
    }));
    const frame = bounceFrame(
      p,
      item,
      ev.evaluate({ ...p.model, bindings: p.model.bindings.filter((b) => b.id !== 'bx' && b.id !== 'by') }, {}),
    )!;
    const q = limitChestOutput(p, item, frame, {}, item.bounce!.amplitudes);
    expect(q.x).toBeLessThan(item.bounce!.amplitudes.x);
    const final = createDeformPipeline().deform(
      p.model,
      ev.evaluate(p.model, { BustX: q.x / item.bounce!.amplitudes.x, BustY: q.y / item.bounce!.amplitudes.y }),
    ).byPartId.chest!.positions;
    const area = (points: Float32Array, t: [number, number, number]) => {
      const [a, b, c] = t;
      return (
        (points[b * 2]! - points[a * 2]!) * (points[c * 2 + 1]! - points[a * 2 + 1]!) -
        (points[b * 2 + 1]! - points[a * 2 + 1]!) * (points[c * 2]! - points[a * 2]!)
      );
    };
    for (const t of frame.mesh.triangles)
      expect(area(final, t) / area(frame.positions, t)).toBeGreaterThanOrEqual(0.0999);
  });
  it('顔だけを動かしても揺らさず、明示した入力は指定方向にだけ作用する', () => {
    const p = chestFixture(),
      engine = createPhysicsEngine();
    const frames = Array.from(
      { length: 40 },
      (_, i) =>
        engine.produce({
          project: p,
          mixedSoFar: { FaceAngleX: i % 20 },
          now: (i * 1000) / 60,
          dt: i ? 1000 / 60 : 0,
          flags: { physicsActive: true, lipSyncWeight: 1 },
        })!.values,
    );
    expect(frames.every((v) => (v.BustX ?? 0) === 0 && (v.BustY ?? 0) === 0)).toBe(true);
    p.physics[0]!.inputs = [{ parameterId: 'FaceAngleX', weight: 1, axis: 'vertical' }];
    engine.reset();
    const explicit = Array.from(
      { length: 40 },
      (_, i) =>
        engine.produce({
          project: p,
          mixedSoFar: { FaceAngleX: Math.min(i, 15) },
          now: (i * 1000) / 60,
          dt: i ? 1000 / 60 : 0,
          flags: { physicsActive: true, lipSyncWeight: 1 },
        })!.values,
    );
    expect(explicit.every((v) => (v.BustX ?? 0) === 0)).toBe(true);
    expect(explicit.some((v) => Math.abs(v.BustY ?? 0) > 0.01)).toBe(true);
  });
  it('30・60・120fpsで同じ波形に追従し、停止後は釣り合いへ収束する', () => {
    const p = chestFixture(),
      item = p.physics[0]!,
      base = bounceFrame(p, item, createBindingEvaluator().evaluate(p.model, {}))!;
    const runs = [30, 60, 120].map((fps) => {
      const session = new ChestDynamicsSession();
      const values: number[] = [];
      for (let i = 0; i <= 4 * fps; i++) {
        const t = i / fps,
          u = Math.max(0, Math.min(1, (t - 0.2) / 0.3)),
          x = 4 * u * u * (3 - 2 * u);
        const q = session.advance(
          item,
          { ...base, center: { x: base.center.x + x, y: base.center.y } },
          { now: t * 1000, dt: i ? 1000 / fps : 0 },
        );
        if (i % (fps / 30) === 0) values.push(q.x / item.bounce!.amplitudes.x);
      }
      return values;
    });
    for (const values of runs) {
      expect(Math.max(...values.map(Math.abs))).toBeGreaterThan(0.02);
      expect(Math.abs(values.at(-1)!)).toBeLessThan(0.02);
    }
    for (let i = 0; i < runs[0]!.length; i++)
      expect(Math.max(...runs.map((v) => v[i]!)) - Math.min(...runs.map((v) => v[i]!))).toBeLessThan(0.03);
  });
});
