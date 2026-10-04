import {
  createEmptyProject,
  type Binding,
  type Model,
  type ParameterKey,
  type Part,
  type TransformDelta,
  type Vec2,
} from '@app/schema';
import { describe, expect, it } from 'vitest';
import { createKeyGenerator } from './keyGenerator';
import { transformDelta } from './keys';
import { generateRotateKeys, rotateFrame } from './rotate';

const deg = (d: number) => (d / 180) * Math.PI;
const dist = (p: Vec2, q: Vec2) => Math.hypot(p.x - q.x, p.y - q.y);
const add = (p: Vec2, d: Vec2) => ({ x: p.x + d.x, y: p.y + d.y });

// pivot を中心に angle 度だけ回した点の、元の点からの差分（y 下向きで正の角度は時計回り）
function rotatedDelta(p: Vec2, pivot: Vec2, angle: number): Vec2 {
  const c = Math.cos(deg(angle));
  const s = Math.sin(deg(angle));
  const x = p.x - pivot.x;
  const y = p.y - pivot.y;
  return { x: pivot.x + c * x - s * y - p.x, y: pivot.y + s * x + c * y - p.y };
}

const pivot = { x: 100, y: 100 };
const base: Vec2[] = [
  { x: 150, y: 100 },
  { x: 100, y: 40 },
  { x: 70, y: 140 },
];
const zero = base.map(() => ({ x: 0, y: 0 }));
const quarter = base.map((p) => rotatedDelta(p, pivot, 90));

describe('generateRotateKeys', () => {
  it('円弧上を通り、途中で縮まない', () => {
    const ts = [0.1, 0.25, 0.5, 0.75, 0.9];
    const out = generateRotateKeys(base, pivot, zero, quarter, ts);
    expect(out).toHaveLength(ts.length);
    out.forEach((deltas, j) => {
      deltas.forEach((d, i) => {
        const p = add(base[i]!, d);
        // pivot からの距離は元のまま（円弧の上）
        expect(dist(p, pivot)).toBeCloseTo(dist(base[i]!, pivot), 9);
        // 角度は t に比例して回る
        const expected = add(base[i]!, rotatedDelta(base[i]!, pivot, 90 * ts[j]!));
        expect(p.x).toBeCloseTo(expected.x, 9);
        expect(p.y).toBeCloseTo(expected.y, 9);
      });
    });
    // 線形に補間すると真ん中で縮む（回転ではそうならないことの対照）
    const linearMid = add(base[0]!, { x: quarter[0]!.x / 2, y: quarter[0]!.y / 2 });
    expect(dist(linearMid, pivot)).toBeLessThan(dist(base[0]!, pivot) * 0.75);
  });

  it('t = 0 と t = 1 は代表状態そのもの', () => {
    const a = base.map((p) => rotatedDelta(p, pivot, -30));
    const [first, last] = generateRotateKeys(base, pivot, a, quarter, [0, 1]);
    first!.forEach((d, i) => {
      expect(d.x).toBeCloseTo(a[i]!.x, 9);
      expect(d.y).toBeCloseTo(a[i]!.y, 9);
    });
    last!.forEach((d, i) => {
      expect(d.x).toBeCloseTo(quarter[i]!.x, 9);
      expect(d.y).toBeCloseTo(quarter[i]!.y, 9);
    });
  });

  it('距離が変わるときは距離も線形に補間し、両端の距離より短くならない', () => {
    // 1つ目の点を 50 → 100 の距離に伸ばしながら 60 度回す
    const target = add(pivot, { x: 100 * Math.cos(deg(60)), y: 100 * Math.sin(deg(60)) });
    const b = [{ x: target.x - base[0]!.x, y: target.y - base[0]!.y }];
    const ts = [0.25, 0.5, 0.75];
    const out = generateRotateKeys([base[0]!], pivot, [{ x: 0, y: 0 }], b, ts);
    out.forEach((deltas, j) => {
      const p = add(base[0]!, deltas[0]!);
      expect(dist(p, pivot)).toBeCloseTo(50 + 50 * ts[j]!, 9);
      expect(Math.atan2(p.y - pivot.y, p.x - pivot.x)).toBeCloseTo(deg(60 * ts[j]!), 9);
      expect(dist(p, pivot)).toBeGreaterThanOrEqual(50);
    });
  });

  it('近いほうの向きに回す（170° → -170° は 180° を通る）', () => {
    const p = add(pivot, { x: 50 * Math.cos(deg(170)), y: 50 * Math.sin(deg(170)) });
    const b = [rotatedDelta(p, pivot, 20)];
    const [mid] = generateRotateKeys([p], pivot, [{ x: 0, y: 0 }], b, [0.5]);
    const q = add(p, mid![0]!);
    expect(q.x).toBeCloseTo(pivot.x - 50, 9);
    expect(q.y).toBeCloseTo(pivot.y, 9);
  });

  it('pivot に重なる点は線形に補間する', () => {
    const [mid] = generateRotateKeys([pivot], pivot, [{ x: 0, y: 0 }], [{ x: 10, y: -4 }], [0.5]);
    expect(mid).toEqual([{ x: 5, y: -2 }]);
  });
});

function part(id: string, patch: Partial<Part> = {}): Part {
  return {
    id,
    name: id,
    kind: 'image',
    standardType: null,
    assetId: null,
    meshId: null,
    parentId: null,
    position: { x: 0, y: 0 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    pivot: { x: 0, y: 0 },
    opacity: 1,
    blendMode: 'normal',
    depth: 0,
    mask: null,
    physicsId: null,
    visible: true,
    locked: false,
    ...patch,
  };
}

function modelWith(patch: Partial<Model>): Model {
  return { ...createEmptyProject('回転のテスト').model, ...patch };
}

const meshModel = modelWith({
  parts: [part('arm', { meshId: 'm-arm', pivot })],
  meshes: [{ id: 'm-arm', vertices: base, uvs: [], triangles: [], density: 'custom', edited: true }],
});

function pointsKey(
  coord: number,
  delta: Vec2[],
  source: ParameterKey['source'] = 'auto',
  locked = false,
): ParameterKey {
  return { coords: [coord], delta, source, locked };
}

function pointsBinding(
  target: Binding['target'],
  channel: Binding['channel'],
  parameterId: string,
  keys: ParameterKey[],
): Binding {
  return {
    id: 'b',
    target,
    channel,
    parameterIds: [parameterId],
    keyValues: [keys.map((k) => k.coords[0]!)],
    keys,
    generation: 'linear',
    divisions: null,
  };
}

const generator = createKeyGenerator();

describe('KeyGenerator.rotate', () => {
  it('頂点のバインディングの中間キーを、メッシュを使うパーツの pivot を中心に円弧で作る', () => {
    const b = pointsBinding({ type: 'mesh', id: 'm-arm' }, 'vertices', 'BodyAngleZ', [
      pointsKey(0, zero),
      pointsKey(10, quarter, 'manual'),
    ]);
    // BodyAngleZ（-10..10）は 10 刻みなので、自動では 0〜10 の間に作らない（方式だけ変わる）
    const out = generator.rotate(b, meshModel);
    expect(out.generation).toBe('rotate');
    expect(out.keys).toHaveLength(2);
    // divisions 4 なら 2.5 刻み
    const four = generator.rotate({ ...b, divisions: 4 }, meshModel);
    expect(four.keys.map((k) => [k.coords[0], k.source])).toEqual([
      [0, 'auto'],
      [2.5, 'generated'],
      [5, 'generated'],
      [7.5, 'generated'],
      [10, 'manual'],
    ]);
    expect(four.keyValues).toEqual([[0, 2.5, 5, 7.5, 10]]);
    const mid = four.keys[2]!.delta as Vec2[];
    mid.forEach((d, i) => {
      expect(dist(add(base[i]!, d), pivot)).toBeCloseTo(dist(base[i]!, pivot), 9);
      const expected = rotatedDelta(base[i]!, pivot, 45);
      expect(d.x).toBeCloseTo(expected.x, 9);
      expect(d.y).toBeCloseTo(expected.y, 9);
    });
    // 2回掛けても同じ
    expect(generator.rotate(four, meshModel)).toBe(four);
  });

  it('ワープの制御点は、ワープを持つグループの pivot を中心にする', () => {
    const groupPivot = { x: 0, y: 0 };
    const points = [
      { x: 40, y: 0 },
      { x: 0, y: 40 },
    ];
    const model = modelWith({
      parts: [part('head', { kind: 'group', pivot: groupPivot })],
      warps: [{ id: 'w', partId: 'head', columns: 1, rows: 0, bounds: { x: 0, y: 0, width: 40, height: 40 }, points }],
    });
    const b = {
      ...pointsBinding({ type: 'warp', id: 'w' }, 'warpPoints', 'FaceAngleZ', [
        pointsKey(
          0,
          points.map(() => ({ x: 0, y: 0 })),
        ),
        pointsKey(
          30,
          points.map((p) => rotatedDelta(p, groupPivot, 60)),
        ),
      ]),
      divisions: 2,
    };
    expect(rotateFrame(b, model)).toEqual({ base: points, pivot: groupPivot });
    const out = generator.rotate(b, model);
    const mid = out.keys.find((k) => k.coords[0] === 15)!.delta as Vec2[];
    mid.forEach((d, i) => {
      const expected = rotatedDelta(points[i]!, groupPivot, 30);
      expect(d.x).toBeCloseTo(expected.x, 9);
      expect(d.y).toBeCloseTo(expected.y, 9);
    });
  });

  it('ロックされたキーは残して代表状態に使い、未ロックの generated だけ作り直す', () => {
    const locked = pointsKey(
      5,
      base.map((p) => rotatedDelta(p, pivot, 20)),
      'generated',
      true,
    );
    const stale = pointsKey(2.5, zero, 'generated');
    const b = {
      ...pointsBinding({ type: 'mesh', id: 'm-arm' }, 'vertices', 'BodyAngleZ', [
        pointsKey(0, zero),
        stale,
        locked,
        pointsKey(10, quarter),
      ]),
      divisions: 2,
    };
    const out = generator.rotate(b, meshModel);
    expect(out.keys.map((k) => k.coords[0])).toEqual([0, 2.5, 5, 7.5, 10]);
    expect(out.keys[2]).toBe(locked);
    // 0 → 20° の真ん中は 10°、20° → 90° の真ん中は 55°
    const at = (c: number) => out.keys.find((k) => k.coords[0] === c)!.delta as Vec2[];
    expect(at(2.5)[0]!.x).toBeCloseTo(rotatedDelta(base[0]!, pivot, 10).x, 9);
    expect(at(7.5)[0]!.y).toBeCloseTo(rotatedDelta(base[0]!, pivot, 55).y, 9);
  });

  it('transform のバインディング（回転角そのものを補間する）や基準が分からないときは線形にする', () => {
    const t: Binding = {
      ...pointsBinding({ type: 'part', id: 'arm' }, 'transform', 'BodyAngleZ', []),
      keys: [
        { coords: [0], delta: transformDelta(), source: 'auto', locked: false },
        { coords: [10], delta: transformDelta({ x: 8, rotation: 40 }), source: 'manual', locked: false },
      ],
      keyValues: [[0, 10]],
      divisions: 2,
    };
    const out = generator.rotate(t, meshModel);
    expect(out.generation).toBe('rotate');
    expect(out.keys[1]!.delta as TransformDelta).toEqual(transformDelta({ x: 4, rotation: 20 }));

    const unknown = pointsBinding({ type: 'mesh', id: 'missing' }, 'vertices', 'BodyAngleZ', [
      pointsKey(0, [{ x: 0, y: 0 }]),
      pointsKey(10, [{ x: 10, y: 0 }]),
    ]);
    const lin = generator.rotate({ ...unknown, divisions: 2 }, meshModel);
    expect(lin.keys[1]!.delta).toEqual([{ x: 5, y: 0 }]);
  });

  it('2パラメータのバインディングはそのまま返す', () => {
    const two: Binding = {
      ...pointsBinding({ type: 'mesh', id: 'm-arm' }, 'vertices', 'FaceAngleX', [
        { coords: [0, 0], delta: zero, source: 'auto', locked: false },
      ]),
      parameterIds: ['FaceAngleX', 'FaceAngleY'],
      keyValues: [[0], [0]],
    };
    expect(generator.rotate(two, meshModel)).toBe(two);
  });
});
