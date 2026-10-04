import { describe, expect, it } from 'vitest';
import type { Binding, TransformDelta, Vec2 } from '@app/schema';
import {
  SWAY_BEND,
  SWAY_ROTATION,
  bendDeltas,
  bendWeights,
  isAutoSwayBinding,
  swayTransformBinding,
  swayVertexBinding,
  withSwayBindings,
} from './sway';
import { STRIP_PIVOT, STRIP_ROWS, physicsProject, stripMesh, testPart } from './testModel';

const deg = (rad: number) => (rad * 180) / Math.PI;
// 頂点の、ピボットから見た角度の変化（度。時計回りが正）と距離
function turnOf(base: Vec2, d: Vec2, pivot: Vec2) {
  const a0 = Math.atan2(base.y - pivot.y, base.x - pivot.x);
  const a1 = Math.atan2(base.y + d.y - pivot.y, base.x + d.x - pivot.x);
  const r0 = Math.hypot(base.x - pivot.x, base.y - pivot.y);
  const r1 = Math.hypot(base.x + d.x - pivot.x, base.y + d.y - pivot.y);
  return { angle: deg(Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0))), r0, r1 };
}
const size = (d: Vec2) => Math.hypot(d.x, d.y);

describe('transform のバインディング', () => {
  it('値 ±1 で Δrotation が ±12。キーは −1・0・1 で source auto', () => {
    const b = swayTransformBinding('bt', 'hair', 'Sway_hair');
    expect(b.target).toEqual({ type: 'part', id: 'hair' });
    expect(b.channel).toBe('transform');
    expect(b.parameterIds).toEqual(['Sway_hair']);
    expect(b.keyValues).toEqual([[-1, 0, 1]]);
    expect(b.keys.map((k) => (k.delta as TransformDelta).rotation)).toEqual([-SWAY_ROTATION, 0, SWAY_ROTATION]);
    expect(SWAY_ROTATION).toBe(12);
    expect(b.keys.every((k) => k.source === 'auto' && !k.locked)).toBe(true);
    const d = b.keys[2]!.delta as TransformDelta;
    expect(d.position).toEqual({ x: 0, y: 0 });
    expect(d.scale).toEqual({ x: 1, y: 1 });
    expect(d.opacity).toBe(1);
  });
});

describe('曲げの重み', () => {
  it('根元からの距離の割合の2乗（根元 0・半分 0.25・先端 1）', () => {
    const mesh = stripMesh();
    const w = bendWeights(mesh.vertices, STRIP_PIVOT);
    // 段ごと（左右は同じ）
    const rows = STRIP_ROWS.map((_, r) => w[r * 2]!);
    expect(rows.map((v) => Number(v.toFixed(6)))).toEqual([0, 0.0625, 0.25, 0.5625, 1]);
    STRIP_ROWS.forEach((_, r) => expect(w[r * 2 + 1]).toBeCloseTo(w[r * 2]!, 9));
  });

  it('根元より後ろの頂点は曲げない。重心の向きを先端とする（横に伸びるパーツも）', () => {
    // ピボットが真ん中の帯: 下半分だけ曲がる
    const mesh = stripMesh();
    const mid = bendWeights(mesh.vertices, { x: 100, y: 100 });
    expect(mid.slice(0, 6).every((v) => v === 0)).toBe(true);
    expect(mid[8]).toBeCloseTo(1, 9);
    // 左端が根元で右へ伸びる帯
    const horizontal = [0, 50, 100].flatMap((x) => [
      { x, y: -10 },
      { x, y: 10 },
    ]);
    const h = bendWeights(horizontal, { x: 0, y: 0 });
    expect(h.map((v) => Number(v.toFixed(6)))).toEqual([0, 0, 0.25, 0.25, 1, 1]);
  });
});

describe('vertices のバインディング（先端ほど大きく曲がる）', () => {
  const mesh = stripMesh();
  const b = swayVertexBinding('bv', mesh, STRIP_PIVOT, 'Sway_hair');
  const keyAt = (v: number) => b.keys.find((k) => Math.abs(k.coords[0]! - v) < 1e-9)!;
  const deltas = (v: number) => keyAt(v).delta as Vec2[];

  it('キーは −1..1 を 0.25 ごと。±1 と 0 は auto、間は generated、方式は rotate', () => {
    expect(b.target).toEqual({ type: 'mesh', id: mesh.id });
    expect(b.channel).toBe('vertices');
    expect(b.generation).toBe('rotate');
    expect(b.keyValues).toEqual([[-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1]]);
    expect(b.keys.map((k) => k.coords[0])).toEqual(b.keyValues[0]);
    expect(b.keys.map((k) => k.source)).toEqual([
      'auto',
      'generated',
      'generated',
      'generated',
      'auto',
      'generated',
      'generated',
      'generated',
      'auto',
    ]);
    expect(deltas(0).every((d) => d.x === 0 && d.y === 0)).toBe(true);
    expect(b.keys.every((k) => (k.delta as Vec2[]).length === mesh.vertices.length)).toBe(true);
  });

  it('値 1 で、頂点はピボットのまわりに 12° × 重み だけ回る（距離は変わらない）。根元は動かない', () => {
    const w = bendWeights(mesh.vertices, STRIP_PIVOT);
    mesh.vertices.forEach((v, i) => {
      const t = turnOf(v, deltas(1)[i]!, STRIP_PIVOT);
      expect(t.angle).toBeCloseTo(SWAY_BEND * w[i]!, 6);
      expect(t.r1).toBeCloseTo(t.r0, 6);
    });
    expect(size(deltas(1)[0]!)).toBeLessThan(1e-9);
    expect(size(deltas(1)[1]!)).toBeLessThan(1e-9);
  });

  it('動く量は根元から先端へ大きくなり、先端は真ん中の数倍動く', () => {
    const moves = STRIP_ROWS.map((_, r) => size(deltas(1)[r * 2]!));
    for (let r = 1; r < moves.length; r++) expect(moves[r]!).toBeGreaterThan(moves[r - 1]!);
    expect(moves[4]! / moves[2]!).toBeGreaterThan(4); // 先端（距離 2 倍・重み 4 倍）
  });

  it('−1 は +1 の左右反対に曲がる', () => {
    mesh.vertices.forEach((v, i) => {
      expect(turnOf(v, deltas(-1)[i]!, STRIP_PIVOT).angle).toBeCloseTo(-turnOf(v, deltas(1)[i]!, STRIP_PIVOT).angle, 6);
    });
  });

  it('間のキーは円弧の上で、角度は値に比例する（generateRotateKeys）', () => {
    const tip = mesh.vertices.length - 1;
    const full = turnOf(mesh.vertices[tip]!, deltas(1)[tip]!, STRIP_PIVOT).angle;
    for (const v of [0.25, 0.5, 0.75, -0.5]) {
      const t = turnOf(mesh.vertices[tip]!, deltas(v)[tip]!, STRIP_PIVOT);
      expect(t.angle).toBeCloseTo(full * v, 6);
      expect(t.r1).toBeCloseTo(t.r0, 6);
    }
  });

  it('bendDeltas は重みが 0 なら動かさない', () => {
    expect(
      bendDeltas(
        mesh.vertices,
        STRIP_PIVOT,
        mesh.vertices.map(() => 0),
        1,
      ).every((d) => size(d) === 0),
    ).toBe(true);
  });
});

describe('自動で作ったバインディングの見分けと作り直し', () => {
  const project = physicsProject();
  const hair = project.model.parts.find((p) => p.id === 'hair')!;
  const ids = { transform: 'bt', vertices: 'bv' };

  it('このパーツ（とメッシュ）の、揺れパラメータだけを使う、手で直したキーの無いバインディング', () => {
    const t = swayTransformBinding('bt', 'hair', 'P');
    const v = swayVertexBinding('bv', stripMesh(), STRIP_PIVOT, 'P');
    expect(isAutoSwayBinding(t, hair, 'P')).toBe(true);
    expect(isAutoSwayBinding(v, hair, 'P')).toBe(true);
    expect(isAutoSwayBinding(t, hair, 'Q')).toBe(false);
    expect(isAutoSwayBinding(t, testPart('other'), 'P')).toBe(false);
    const edited: Binding = { ...t, keys: t.keys.map((k, i) => (i === 2 ? { ...k, source: 'manual' } : k)) };
    expect(isAutoSwayBinding(edited, hair, 'P')).toBe(false);
  });

  it('メッシュのある画像パーツは transform と vertices、グループとメッシュの無いパーツは transform だけ', () => {
    const model = withSwayBindings(project.model, hair, 'P', ids);
    expect(model.bindings.map((b) => [b.id, b.channel, b.target.id])).toEqual([
      ['bt', 'transform', 'hair'],
      ['bv', 'vertices', 'mesh-hair'],
    ]);
    const g = project.model.parts.find((p) => p.id === 'g')!;
    expect(withSwayBindings(project.model, g, 'P', ids).bindings.map((b) => b.channel)).toEqual(['transform']);
    const plain = project.model.parts.find((p) => p.id === 'plain')!;
    expect(withSwayBindings(project.model, plain, 'P', ids).bindings.map((b) => b.channel)).toEqual(['transform']);
  });

  it('自動で作ったものは同じ id のまま作り直し、手で直したものは残す', () => {
    const first = withSwayBindings(project.model, hair, 'P', ids);
    const moved = { ...hair, pivot: { x: 100, y: 100 } };
    const second = withSwayBindings(first, moved, 'P', { transform: 'x1', vertices: 'x2' });
    expect(second.bindings.map((b) => b.id)).toEqual(['bt', 'bv']);
    expect(second.bindings[1]).not.toEqual(first.bindings[1]); // ピボットが変わったので曲げ方が変わる

    const manual: Binding = {
      ...first.bindings[1]!,
      keys: first.bindings[1]!.keys.map((k) => ({ ...k, source: 'manual' as const })),
    };
    const withManual = { ...first, bindings: [first.bindings[0]!, manual] };
    const third = withSwayBindings(withManual, moved, 'P', ids);
    expect(third.bindings[1]).toBe(manual);
  });
});
