import reference from '@app/fixtures/reference-model/project.json';
import { loadProjectJson, validateProject, type Project, type Vec2 } from '@app/schema';
import { describe, expect, it } from 'vitest';
import { createBindingEvaluator } from '../eval';
import { createDeformPipeline } from '../deform';
import { createProjectStore } from '../store';
import { createAutoSetup } from './autoSetup';
import { headWarpOf as modelHeadWarp } from './faceTurn';
import { faceTurnBindings as modelFaceTurns, HEAD_TURN_ANGLE } from './headTurn';

const base = () => loadProjectJson(JSON.stringify(reference));
const setup = createAutoSetup({ faceTurn: 'head-surface' });
const run = (p: Project) => setup.plan(p).command.apply(p);
const headWarpOf = (p: Project) => modelHeadWarp(p.model);
const faceTurnBindings = (p: Project) => modelFaceTurns(p.model);
function deform(p: Project, x = 0, y = 0) {
  const values = Object.fromEntries(p.model.parameters.map((v) => [v.id, v.default]));
  return createDeformPipeline().deform(
    p.model,
    createBindingEvaluator().evaluate(p.model, { ...values, FaceAngleX: x, FaceAngleY: y }),
  );
}
const centerX = (positions: Float32Array) =>
  positions.reduce((sum, v, i) => sum + (i % 2 === 0 ? v : 0), 0) / (positions.length / 2);

describe('I-039 shared head surface', () => {
  it('moves face and hair visibly in both directions, without changing the neutral pose', () => {
    const before = base();
    const p = run(before);
    expect(faceTurnBindings(p)).toHaveLength(0);
    const w = headWarpOf(p)!;
    expect(w).not.toBeNull();
    expect(p.model.warps).toHaveLength(before.model.warps.length + 1);
    const neutral = deform(p);
    const old = deform(before);
    for (const item of neutral.items) {
      expect(item.positions.every((v, i) => Math.abs(v - old.byPartId[item.partId]!.positions[i]!) < 0.001)).toBe(true);
    }
    const face = p.model.parts.find((v) => v.standardType === 'face')!;
    const width = p.assets.find((v) => v.id === face.assetId)!.width;
    for (const type of ['face', 'frontHair', 'irisL', 'irisR']) {
      const part = p.model.parts.find((v) => v.standardType === type)!;
      const rest = centerX(neutral.byPartId[part.id]!.positions);
      for (const sign of [-1, 1]) {
        const shift = centerX(deform(p, sign * 30).byPartId[part.id]!.positions) - rest;
        expect(shift * sign).toBeGreaterThan(width * 0.08);
      }
    }
    expect(HEAD_TURN_ANGLE).toEqual({ FaceAngleX: 12, FaceAngleY: 6 });
  });

  it('migrates both previous automatic modes without stacking face and head surface bindings', () => {
    for (const faceTurn of ['surface', 'depth'] as const) {
      const initial = base();
      const before = createAutoSetup({ faceTurn }).plan(initial).command.apply(initial);
      const oldBindings = before.model.bindings.filter(
        (b) =>
          !faceTurnBindings(before).includes(b) &&
          !(b.channel === 'transform' && (b.parameterIds[0] === 'FaceAngleX' || b.parameterIds[0] === 'FaceAngleY')),
      );
      const p = run(before);
      expect(faceTurnBindings(p)).toHaveLength(0);
      for (const b of oldBindings) expect(p.model.bindings.find((v) => v.id === b.id)).toEqual(b);
      expect(p.model.bindings.filter((b) => b.target.id === headWarpOf(p)!.id)).toHaveLength(3);
      expect(p.model.drawOrder).toEqual(before.model.drawOrder);
      expect(
        p.model.bindings.some(
          (b) => b.channel === 'transform' && b.parameterIds.some((id) => id === 'FaceAngleX' || id === 'FaceAngleY'),
        ),
      ).toBe(false);
      expect(run(p)).toBe(p);
    }
  });

  it.each(['manual', 'locked'] as const)(
    'keeps the entire old face turn when any %s key prevents migration',
    (protection) => {
      const initial = base();
      const before = createAutoSetup().plan(initial).command.apply(initial);
      const old = faceTurnBindings(before);
      const k = old[0]!.keys.at(-1)!;
      if (protection === 'manual') k.source = 'manual';
      else k.locked = true;
      const plan = setup.plan(before);
      expect(plan.warnings.some((w) => w.includes('切り替えず'))).toBe(true);
      const after = plan.command.apply(before);
      expect(headWarpOf(after)).toBeNull();
      expect(faceTurnBindings(after)).toEqual(old);
    },
  );

  it('preserves customized head keys, rest points, and manual depth keys on rerun', () => {
    const initial = base();
    const headId = initial.model.parts.find((v) => v.standardType === 'frontHair')!.id;
    const depth = initial.model.bindings.find((b) => b.target.id === headId && b.parameterIds[0] === 'FaceAngleX')!;
    depth.keys[0]!.source = 'manual';
    const p = run(initial);
    const warp = headWarpOf(p)!;
    warp.points[0]!.x += 3;
    const b = p.model.bindings.find((b) => b.target.id === warp.id && b.parameterIds.length === 1)!;
    b.keys[0]!.source = 'manual';
    (b.keys[0]!.delta as Vec2[])[0]!.x -= 5;
    b.keys.at(-1)!.locked = true;
    const after = run(p);
    expect(headWarpOf(after)).toEqual(warp);
    const actual = after.model.bindings.find((v) => v.id === b.id)!;
    expect(actual.keys[0]).toEqual(b.keys[0]);
    expect(actual.keys.at(-1)).toEqual(b.keys.at(-1));
    expect(after.model.bindings.find((b) => b.id === depth.id)!.keys[0]).toEqual(depth.keys[0]);
  });

  it('produces finite, non-folded head grids in 49 directions', () => {
    const p = run(base());
    const warp = headWarpOf(p)!;
    const evaluator = createBindingEvaluator();
    for (const x of [-30, -20, -10, 0, 10, 20, 30]) {
      for (const y of [-30, -20, -10, 0, 10, 20, 30]) {
        const delta = evaluator.evaluate(p.model, { FaceAngleX: x, FaceAngleY: y }).warpPoints[warp.id]!;
        const points = warp.points.map((v, i) => ({ x: v.x + delta[i * 2]!, y: v.y + delta[i * 2 + 1]! }));
        for (let row = 0; row < warp.rows; row++)
          for (let col = 0; col < warp.columns; col++) {
            const a = points[row * (warp.columns + 1) + col]!;
            const b = points[row * (warp.columns + 1) + col + 1]!;
            const c = points[(row + 1) * (warp.columns + 1) + col]!;
            expect((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)).toBeGreaterThan(0);
          }
        expect(deform(p, x, y).items.every((v) => v.positions.every(Number.isFinite))).toBe(true);
      }
    }
  });

  it('keeps an invalid existing head warp and the old face motion, with a warning', () => {
    const initial = base();
    const p = createAutoSetup().plan(initial).command.apply(initial);
    const head = p.model.parts.find((v) => v.standardType === 'headRoot')!;
    p.model.warps.push({ ...p.model.warps[0]!, id: 'bad-head', partId: head.id, rows: 0 });
    const plan = setup.plan(p);
    expect(plan.warnings.some((w) => w.includes('頭の変形'))).toBe(true);
    const after = plan.command.apply(p);
    expect(after.model.warps).toEqual(p.model.warps);
    expect(faceTurnBindings(after)).toEqual(faceTurnBindings(p));
  });

  it('supports undo/redo and JSON round trips without altering the input', () => {
    const before = base();
    const snapshot = structuredClone(before);
    const store = createProjectStore(before);
    store.dispatch(setup.plan(before).command);
    const after = store.get();
    expect(before).toEqual(snapshot);
    expect(validateProject(JSON.parse(JSON.stringify(after)))).toEqual(after);
    store.undo();
    expect(store.get()).toEqual(before);
    store.redo();
    expect(store.get()).toEqual(after);
    expect(run(after)).toBe(after);
  });
});
