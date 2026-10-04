import { describe, expect, it } from 'vitest';
import { createEmptyProject, type Binding, type Mesh, type Project, type Vec2 } from '@app/schema';
import {
  addVertex,
  boundaryEdges,
  markEditedIfChanged,
  remeshCommand,
  removeVertices,
  segmentsCross,
  triangulate,
  uvAt,
  vertexKeyCount,
  type MeshShape,
} from './meshOps';

// 100×100 の四角形（三角形2枚）。UV は素材の矩形と同じ
const square = (): MeshShape => ({
  vertices: [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ],
  uvs: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ],
  triangles: [
    [0, 1, 2],
    [0, 2, 3],
  ],
});

// L 字（凹んだ輪郭）。右上の 50×50 が無い
const lShape = (): MeshShape => {
  const vertices = [
    { x: 0, y: 0 },
    { x: 50, y: 0 },
    { x: 50, y: 50 },
    { x: 100, y: 50 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];
  return {
    vertices,
    uvs: vertices.map((v) => ({ x: v.x / 100, y: v.y / 100 })),
    triangles: triangulate(vertices, [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 0],
    ]),
  };
};

const area = (s: MeshShape) =>
  s.triangles.reduce((sum, [a, b, c]) => {
    const p = s.vertices[a]!;
    const q = s.vertices[b]!;
    const r = s.vertices[c]!;
    return sum + Math.abs((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)) / 2;
  }, 0);

const ccw = (s: MeshShape) =>
  s.triangles.every(([a, b, c]) => {
    const p = s.vertices[a]!;
    const q = s.vertices[b]!;
    const r = s.vertices[c]!;
    return (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x) > 0;
  });

const valid = (s: MeshShape) =>
  s.uvs.length === s.vertices.length && s.triangles.every((t) => t.every((i) => i >= 0 && i < s.vertices.length));

function ok(result: ReturnType<typeof addVertex>) {
  if (!result.ok) throw new Error(result.error);
  return result;
}

describe('三角形分割', () => {
  it('輪郭は1つの三角形にだけ使われる辺', () => {
    const edges = boundaryEdges(square().triangles).map(([a, b]) => [Math.min(a, b), Math.max(a, b)]);
    expect(edges.sort()).toEqual([
      [0, 1],
      [0, 3],
      [1, 2],
      [2, 3],
    ]);
  });

  it('制約の内側だけを埋め、凹みは埋めない。向きはそろえる', () => {
    const l = lShape();
    expect(area(l)).toBeCloseTo(7500);
    expect(ccw(l)).toBe(true);
    // 制約が無ければ凸包
    expect(area({ ...l, triangles: triangulate(l.vertices, []) })).toBeCloseTo(10000 - 1250);
  });

  it('線分の交差', () => {
    const p = (x: number, y: number): Vec2 => ({ x, y });
    expect(segmentsCross(p(0, 0), p(10, 10), p(0, 10), p(10, 0))).toBe(true);
    expect(segmentsCross(p(0, 0), p(10, 0), p(0, 5), p(10, 5))).toBe(false);
    expect(segmentsCross(p(0, 0), p(10, 0), p(5, 0), p(5, 5))).toBe(true); // T 字
  });

  it('UV は含む三角形の重心座標で求め、外では近い三角形から延ばす', () => {
    const inside = uvAt(square(), { x: 25, y: 75 })!;
    expect(inside.inside).toBe(true);
    expect(inside.uv.x).toBeCloseTo(0.25);
    expect(inside.uv.y).toBeCloseTo(0.75);
    const out = uvAt(square(), { x: 110, y: 50 })!;
    expect(out.inside).toBe(false);
    expect(out.uv.x).toBeCloseTo(1.1);
  });
});

describe('頂点の追加', () => {
  it('内側に足すと、面積はそのままで三角形が作り直され、UV は周りから求める', () => {
    const r = ok(addVertex(square(), { x: 30, y: 60 }));
    expect(r.added).toBe(4);
    expect(r.shape.vertices).toHaveLength(5);
    expect(r.shape.uvs[4]!.x).toBeCloseTo(0.3);
    expect(r.shape.uvs[4]!.y).toBeCloseTo(0.6);
    expect(r.shape.triangles).toHaveLength(4);
    expect(r.shape.triangles.filter((t) => t.includes(4))).toHaveLength(4);
    expect(area(r.shape)).toBeCloseTo(10000);
    expect(ccw(r.shape) && valid(r.shape)).toBe(true);
  });

  it('凹んだ輪郭の内側に足しても、凹みは埋めない', () => {
    const r = ok(addVertex(lShape(), { x: 20, y: 70 }));
    expect(area(r.shape)).toBeCloseTo(7500);
    expect(r.shape.triangles.some((t) => t.includes(6))).toBe(true);
  });

  it('輪郭の辺の上なら辺を分け、外ならいちばん近い辺をその点まで広げる', () => {
    const onEdge = ok(addVertex(square(), { x: 50, y: 0 }));
    expect(area(onEdge.shape)).toBeCloseTo(10000);
    expect(onEdge.shape.triangles).toHaveLength(3);

    // UV の範囲（0..1）の中の外側: 素材の矩形より小さいメッシュを広げる
    const small: MeshShape = {
      vertices: square().vertices.map((v) => ({ x: v.x / 2, y: v.y / 2 })),
      uvs: square().uvs.map((v) => ({ x: v.x / 2, y: v.y / 2 })),
      triangles: square().triangles,
    };
    const grown = ok(addVertex(small, { x: 70, y: 25 }));
    // 右の辺 (50,0)-(50,50) を (70,25) まで広げた三角形の分だけ増える
    expect(area(grown.shape)).toBeCloseTo(2500 + (50 * 20) / 2);
    expect(grown.shape.uvs[4]!.x).toBeCloseTo(0.7);
  });

  it('画像の外・近すぎる所・三角形の無いメッシュには足せない', () => {
    expect(addVertex(square(), { x: 120, y: 50 })).toEqual({ ok: false, error: '画像の外には頂点を追加できない' });
    expect(addVertex(square(), { x: 0, y: 0 }).ok).toBe(false);
    expect(addVertex({ vertices: [], uvs: [], triangles: [] }, { x: 1, y: 1 }).ok).toBe(false);
  });
});

describe('頂点の削除', () => {
  it('内側の頂点を消すと、面積はそのままで三角形が作り直される', () => {
    const added = ok(addVertex(square(), { x: 30, y: 60 })).shape;
    const r = removeVertices(added, [4]);
    if (!r.ok) throw new Error(r.error);
    expect(r.shape.vertices).toHaveLength(4);
    expect(r.shape.triangles).toHaveLength(2);
    expect(area(r.shape)).toBeCloseTo(10000);
  });

  it('輪郭の頂点を消すと両隣をつなぎ、番号を詰める', () => {
    const r = removeVertices(square(), [1]);
    if (!r.ok) throw new Error(r.error);
    expect(r.shape.vertices).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ]);
    expect(r.shape.uvs).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ]);
    expect(area(r.shape)).toBeCloseTo(5000);
    expect(valid(r.shape) && ccw(r.shape)).toBe(true);

    // L 字の凹みの角を消すと、その分だけ埋まる
    const l = removeVertices(lShape(), [2]);
    if (!l.ok) throw new Error(l.error);
    expect(area(l.shape)).toBeCloseTo(7500 + 1250);
  });

  it('並んだ輪郭の頂点をまとめて消せる', () => {
    const big = ok(addVertex(ok(addVertex(square(), { x: 30, y: 0 })).shape, { x: 60, y: 0 })).shape;
    const r = removeVertices(big, [4, 5]);
    if (!r.ok) throw new Error(r.error);
    expect(r.shape.vertices).toHaveLength(4);
    expect(area(r.shape)).toBeCloseTo(10000);
  });

  it('3つより少なくはできない', () => {
    expect(removeVertices(square(), [0, 1])).toEqual({ ok: false, error: '頂点は3つより少なくできない' });
    expect(removeVertices(square(), []).ok).toBe(false);
  });
});

describe('コマンド', () => {
  const mesh: Mesh = { id: 'm1', ...square(), density: 'standard', edited: false };
  const binding = (id: string, meshId: string, keys: number): Binding => ({
    id,
    target: { type: 'mesh', id: meshId },
    channel: 'vertices',
    parameterIds: ['P'],
    keyValues: [[0, 1]],
    keys: Array.from({ length: keys }, (_, i) => ({
      coords: [i],
      delta: mesh.vertices.map(() => ({ x: 0, y: 0 })),
      source: 'manual' as const,
      locked: false,
    })),
    generation: 'linear',
    divisions: null,
  });
  const project = (): Project => {
    const p = createEmptyProject('t');
    return {
      ...p,
      model: {
        ...p.model,
        meshes: [mesh],
        bindings: [binding('b1', 'm1', 2), binding('b2', 'm1', 1), binding('b3', 'other', 4)],
      },
    };
  };

  it('このメッシュの vertices バインディングのキーを数える', () => {
    expect(vertexKeyCount(project().model, 'm1')).toBe(3);
    expect(vertexKeyCount(project().model, 'none')).toBe(0);
  });

  it('remeshCommand: 形を置き換え、このメッシュの頂点のキーを新しい頂点へ転写する（リセットしない）', () => {
    const moved = mesh.vertices.map((v) => ({ x: v.x * 0.1, y: 3 }));
    const p = project();
    const keyed: Project = {
      ...p,
      model: {
        ...p.model,
        bindings: p.model.bindings.map((b) =>
          b.id === 'b1' ? { ...b, keys: b.keys.map((k) => ({ ...k, delta: moved })) } : b,
        ),
      },
    };
    const added = addVertex(square(), { x: 50, y: 50 });
    if (!added.ok) throw new Error(added.error);
    const after = remeshCommand('頂点の追加', 'm1', added.shape, { edited: true }).apply(keyed);
    const m = after.model.meshes[0]!;
    expect(m).toMatchObject({ id: 'm1', edited: true, density: 'standard' });
    expect(m.vertices).toEqual(added.shape.vertices);
    expect(m.triangles).toEqual(added.shape.triangles);
    // キーは残り、頂点の数に合う。旧い頂点の差分はそのまま、足した頂点は補間（中心なので (5,3)）
    expect(after.model.bindings.map((b) => b.id)).toEqual(['b1', 'b2', 'b3']);
    const b1 = after.model.bindings[0]!.keys[0]!.delta as Vec2[];
    expect(b1.slice(0, 4)).toEqual(moved);
    expect(b1[4]!.x).toBeCloseTo(5);
    expect(b1[4]!.y).toBeCloseTo(3);
    expect(after.model.bindings[1]!.keys[0]!.delta).toHaveLength(5);
    // ほかのメッシュのキーは変えない
    expect(after.model.bindings[2]).toBe(keyed.model.bindings[2]);
    // メッシュが無ければ何もしない
    expect(remeshCommand('x', 'none', added.shape, {}).apply(keyed)).toBe(keyed);
  });

  it('基準の頂点が変わったときだけ edited を true にする', () => {
    const p = project();
    const moveVertices = {
      label: '頂点の移動',
      apply: (q: Project) => ({
        ...q,
        model: { ...q.model, meshes: q.model.meshes.map((m) => ({ ...m, vertices: m.vertices.slice() })) },
      }),
    };
    expect(markEditedIfChanged('m1', moveVertices).apply(p).model.meshes[0]!.edited).toBe(true);
    const keyOnly = { label: 'キー', apply: (q: Project) => ({ ...q, name: 'x' }) };
    expect(markEditedIfChanged('m1', keyOnly).apply(p).model.meshes[0]!.edited).toBe(false);
  });
});
