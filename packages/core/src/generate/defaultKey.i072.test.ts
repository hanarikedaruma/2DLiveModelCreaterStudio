import { describe, expect, it } from 'vitest';
import { createEmptyProject, type Binding, type Model, type ParameterKey, type Warp } from '@app/schema';
import { rebuildTransformBinding, transformDelta } from './keys';
import { depthBindings, depthKeyDelta } from './depth';
import { generateSurfaceKeys, surfaceBinding } from './surface';
import { createKeyGenerator } from './keyGenerator';
import { applyMotionPlans } from '../setup/motions';
import { applyPointPlans } from '../setup/step1';
import { newGroupPart } from '../setup/hierarchy';
import { regularWarpPoints } from '../deform/warp';

const key = (coord: number, x: number, source: ParameterKey['source'] = 'auto', locked = false): ParameterKey => ({
  coords: [coord],
  delta: transformDelta({ x }),
  source,
  locked,
});
const binding = (): Binding => ({
  id: 'b',
  target: { type: 'part', id: 'p' },
  channel: 'transform',
  parameterIds: ['FaceAngleX'],
  keyValues: [[-30, 0, 30]],
  keys: [key(-30, -9), key(0, 12, 'manual', true), key(30, 99, 'manual', true)],
  generation: 'depth',
  divisions: null,
});
const model = (b = binding()): Model => ({
  ...createEmptyProject('t').model,
  parts: [
    { ...newGroupPart('g', 'headRoot') },
    { ...newGroupPart('p', 'faceGroup'), kind: 'image', standardType: 'face', parentId: 'g', depth: 0.4 },
  ],
  bindings: [b],
});

describe('既定値の補正を再生成で保つ（I-072）', () => {
  it('奥行きの再生成で新しいキーに補正を重ね、保護キーには二重に加えない。再実行も同じ', () => {
    const m = model();
    const options = { faceWidth: 400, keep: (k: ParameterKey) => k.locked, newId: () => 'new' };
    const b = depthBindings(m, 'FaceAngleX', options)[0]!;
    const fresh = depthKeyDelta(m.parts[1]!, 'FaceAngleX', -30, 400);
    expect(b.keys[0]!.delta).toEqual({ ...fresh, position: { x: fresh.position.x + 12, y: 0 } });
    expect(b.keys[1]).toBe(m.bindings[0]!.keys[1]);
    expect(b.keys[2]).toBe(m.bindings[0]!.keys[2]);
    expect(depthBindings({ ...m, bindings: [b] }, 'FaceAngleX', options)[0]).toBe(b);
  });

  it('ロック解除した手動の既定値も保持し、位置・回転・拡縮を新しいキーへ重ねる', () => {
    const origin = {
      ...key(0, 12, 'manual'),
      delta: transformDelta({ x: 12, y: 3, rotation: 5, scaleX: 1.2, scaleY: 0.8, opacity: 0.4 }),
    };
    const b = { ...binding(), keys: [origin] };
    const out = rebuildTransformBinding({
      existing: b,
      partId: 'p',
      parameterId: 'FaceAngleX',
      defaultCoord: 0,
      keys: [
        { coord: 0, delta: transformDelta() },
        { coord: 30, delta: transformDelta({ x: 20, scaleX: 0.9 }) },
      ],
      keep: (k) => k.locked,
      generation: 'depth',
      newId: () => 'new',
    });
    expect(out.keys[0]).toBe(origin);
    expect(out.keys[1]!.delta).toEqual(transformDelta({ x: 32, y: 3, rotation: 5, scaleX: 1.08, scaleY: 0.8 }));
  });

  it('自動セットアップの transform と、軸順が逆の2軸の頂点計画も既定値の補正を保つ', () => {
    const m = model();
    const out = applyMotionPlans(
      m,
      [
        {
          partId: 'p',
          parameterId: 'FaceAngleX',
          generation: 'linear',
          keys: [
            { coord: -30, delta: transformDelta({ x: -20 }) },
            { coord: 0, delta: transformDelta() },
            { coord: 30, delta: transformDelta({ x: 20 }) },
          ],
        },
      ],
      () => 'new',
    );
    expect(out.bindings[0]!.keys[0]!.delta).toEqual(transformDelta({ x: -8 }));
    const origin: ParameterKey = { coords: [0, 0], delta: [{ x: 4, y: 6 }], source: 'manual', locked: true };
    const points: Binding = {
      ...binding(),
      target: { type: 'mesh', id: 'mesh' },
      channel: 'vertices',
      parameterIds: ['FaceAngleY', 'FaceAngleX'],
      keyValues: [[0], [0]],
      keys: [origin],
    };
    const run = (m: Model) =>
      applyPointPlans(
        m,
        [
          {
            target: { type: 'mesh', id: 'mesh' },
            parameterIds: ['FaceAngleX', 'FaceAngleY'],
            generation: 'linear',
            keys: [
              { coords: [0, 0], delta: [{ x: 0, y: 0 }] },
              { coords: [30, -30], delta: [{ x: 8, y: -2 }] },
            ],
          },
        ],
        () => true,
        () => 'new',
      );
    const next = run({ ...m, bindings: [points] });
    expect(next.bindings[0]!.keys[0]).toMatchObject({ coords: [-30, 30], delta: [{ x: 12, y: 4 }] });
    expect(next.bindings[0]!.keys[1]).toBe(origin);
    expect(run(next)).toBe(next);
  });

  it('曲面を作り直しても既定値の制御点の補正を保持し、再補間では既定値と端を固定する', () => {
    const bounds = { x: 0, y: 0, width: 100, height: 100 };
    const warp: Warp = { id: 'w', partId: 'g', columns: 1, rows: 1, bounds, points: regularWarpPoints(bounds, 1, 1) };
    const origin: ParameterKey = {
      coords: [0],
      delta: warp.points.map(() => ({ x: 5, y: 7 })),
      source: 'manual',
      locked: true,
    };
    const b: Binding = {
      ...binding(),
      target: { type: 'warp', id: 'w' },
      channel: 'warpPoints',
      keys: [origin],
      keyValues: [[0]],
      generation: 'surface',
    };
    const m = { ...model(b), warps: [warp] };
    const next = surfaceBinding(b, m);
    const expected = generateSurfaceKeys(warp, 'FaceAngleX', [-30])[0]!.map((d) => ({ x: d.x + 5, y: d.y + 7 }));
    expect(next.keys[0]!.delta).toEqual(expected);
    expect(next.keys.find((k) => k.coords[0] === 0)).toBe(origin);
    const generator = createKeyGenerator();
    for (const generation of ['linear', 'rotate', 'surface'] as const) {
      const seeded = { ...next, generation };
      const out = generator.regenerate(seeded, m);
      expect(out.keys.find((k) => k.coords[0] === 0)).toBe(origin);
      expect(out.keys[0]).toBe(next.keys[0]);
      expect(out.keys.at(-1)).toBe(next.keys.at(-1));
    }
    expect(surfaceBinding(next, m)).toBe(next);
  });
});
