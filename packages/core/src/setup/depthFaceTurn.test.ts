import reference from '@app/fixtures/reference-model/project.json';
import { loadProjectJson, type Binding, type Project } from '@app/schema';
import { describe, expect, it } from 'vitest';
import { createDeformPipeline } from '../deform';
import { createBindingEvaluator } from '../eval';
import { depthKeyDelta } from '../generate/depth';
import { createProjectStore } from '../store';
import { createAutoSetup } from './autoSetup';

const base = () => loadProjectJson(JSON.stringify(reference));
const setup = createAutoSetup({ faceTurn: 'depth' });
const run = (p: Project) => setup.plan(p).command.apply(p);
const surface = (p: Project) => createAutoSetup({ faceTurn: 'surface' }).plan(p).command.apply(p);
const turns = (p: Project): Binding[] => {
  const face = p.model.parts.find((q) => q.standardType === 'faceGroup')!;
  const ids = new Set(p.model.warps.filter((w) => w.partId === face.id).map((w) => w.id));
  return p.model.bindings.filter(
    (b) =>
      b.channel === 'warpPoints' &&
      ids.has(b.target.id) &&
      b.parameterIds.every((id) => ['FaceAngleX', 'FaceAngleY'].includes(id)),
  );
};
function deform(p: Project, x = 0, y = 0) {
  const params = Object.fromEntries(p.model.parameters.map((q) => [q.id, q.default]));
  params.FaceAngleX = x;
  params.FaceAngleY = y;
  return createDeformPipeline().deform(p.model, createBindingEvaluator().evaluate(p.model, params));
}

describe('I-039 temporary depth-based face turn', () => {
  it('uses the same depth formula for face and hair, without creating a face warp', () => {
    const before = base();
    const p = run(before);
    expect(p.model.warps).toEqual(before.model.warps);
    expect(turns(p)).toHaveLength(0);
    const face = p.model.parts.find((q) => q.standardType === 'face')!;
    const width = p.assets.find((a) => a.id === face.assetId)!.width;
    for (const type of ['face', 'frontHair', 'sideHairL', 'backHair']) {
      const part = p.model.parts.find((q) => q.standardType === type)!;
      expect(part).toBeDefined();
      for (const id of ['FaceAngleX', 'FaceAngleY'] as const) {
        const b = p.model.bindings.find(
          (b) => b.channel === 'transform' && b.target.id === part.id && b.parameterIds[0] === id,
        )!;
        expect(b.generation).toBe('depth');
        for (const k of b.keys) expect(k.delta).toEqual(depthKeyDelta(part, id, k.coords[0]!, width));
      }
    }
  });

  it('removes only automatic face surface bindings, preserving rest points and other motions', () => {
    const before = surface(base());
    const oldTurns = new Set(turns(before).map((b) => b.id));
    expect(oldTurns.size).toBe(3);
    const p = run(before);
    expect(turns(p)).toHaveLength(0);
    expect(p.model.warps).toEqual(before.model.warps);
    expect(p.model.bindings).toEqual(before.model.bindings.filter((b) => !oldTurns.has(b.id)));
    const neutralBefore = deform(before);
    const neutralAfter = deform(p);
    for (const [id, part] of Object.entries(neutralBefore.byPartId)) {
      const actual = neutralAfter.byPartId[id]!;
      expect(part.positions.every((v, i) => Math.abs(actual.positions[i]! - v) < 0.001)).toBe(true);
    }
    const expected = {
      ...before,
      model: { ...before.model, bindings: before.model.bindings.filter((b) => !oldTurns.has(b.id)) },
    };
    for (const x of [-30, -20, -10, 0, 10, 20, 30]) {
      for (const y of [-30, -20, -10, 0, 10, 20, 30]) {
        const actual = deform(p, x, y);
        const wanted = deform(expected, x, y);
        expect(
          actual.items.every((item) => {
            const other = wanted.byPartId[item.partId]!;
            return item.opacity === other.opacity && item.positions.every((v, i) => v === other.positions[i]);
          }),
        ).toBe(true);
      }
    }
  });

  it.each(['manual', 'locked'] as const)(
    'preserves complete bindings containing a %s key, including diagonal turns',
    (protection) => {
      const before = surface(base());
      for (const b of turns(before)) {
        const k = b.keys.at(-1)!;
        if (protection === 'manual') k.source = 'manual';
        else k.locked = true;
      }
      const plan = setup.plan(before);
      expect(plan.warnings.some((w) => w.includes('完全にそろいません'))).toBe(true);
      const p = plan.command.apply(before);
      expect(turns(p)).toEqual(turns(before));
      expect(run(p)).toBe(p);
    },
  );

  it('does not remove an unrelated head warp or manually customized depth keys', () => {
    const before = surface(base());
    const w = before.model.warps[0]!;
    const head = before.model.parts.find((q) => q.standardType === 'headRoot')!;
    before.model.warps.push({ ...w, id: 'custom-head-warp', partId: head.id });
    const custom = {
      ...turns(before)[0]!,
      id: 'custom-head-turn',
      target: { type: 'warp' as const, id: 'custom-head-warp' },
    };
    before.model.bindings.push(custom);
    const face = before.model.parts.find((q) => q.standardType === 'face')!;
    const depth = before.model.bindings.find((b) => b.target.id === face.id && b.parameterIds[0] === 'FaceAngleX')!;
    depth.keys[0]!.source = 'manual';
    depth.keys[0]!.delta = { position: { x: -11, y: 2 }, rotation: 1, scale: { x: 0.98, y: 1 }, opacity: 1 };
    const p = run(before);
    expect(p.model.bindings.find((b) => b.id === custom.id)).toEqual(custom);
    expect(p.model.bindings.find((b) => b.id === depth.id)!.keys[0]).toEqual(depth.keys[0]);
    expect(setup.plan(before).warnings.some((w) => w.includes('完全にそろいません'))).toBe(false);
  });

  it('is pure, idempotent, and undoable in one command', () => {
    const before = surface(base());
    const snapshot = structuredClone(before);
    const plan = setup.plan(before);
    const after = plan.command.apply(before);
    expect(before).toEqual(snapshot);
    expect(plan.command.apply(before)).toEqual(after);
    expect(run(after)).toBe(after);
    const store = createProjectStore(before);
    store.dispatch(plan.command);
    expect(store.get()).toEqual(after);
    store.undo();
    expect(store.get()).toEqual(before);
    store.redo();
    expect(store.get()).toEqual(after);
  });
});
