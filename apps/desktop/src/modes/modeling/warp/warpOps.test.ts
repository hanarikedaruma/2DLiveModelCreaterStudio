import { describe, expect, it } from 'vitest';
import type { Binding, Warp } from '@app/schema';
import { deepFreeze, part, projectWith } from '../../../services/keyEditor/testing';
import { testAsset, rectMesh } from './testProject';
import {
  addWarpCommand,
  clampDivisions,
  createWarp,
  descendantImageBounds,
  removeWarpCommand,
  warpBoundsFor,
  warpKeyCount,
} from './warpOps';

// g（グループ）の子に a（メッシュ）と b（メッシュ無し。素材の矩形）、孫グループ h の下に c。外に o
function project() {
  const p = projectWith({
    parts: [
      part('root', { kind: 'group', position: { x: 1000, y: 0 }, rotation: 30 }),
      part('g', { kind: 'group', parentId: 'root', position: { x: 50, y: 50 }, scale: { x: 3, y: 3 } }),
      part('a', { parentId: 'g', assetId: 'asset-a', meshId: 'mesh-a' }),
      part('b', { parentId: 'g', assetId: 'asset-b' }),
      part('h', { kind: 'group', parentId: 'g', position: { x: 0, y: 100 }, pivot: { x: 0, y: 0 } }),
      part('c', { parentId: 'h', assetId: 'asset-c', meshId: 'mesh-c' }),
      part('o', { assetId: 'asset-o', meshId: 'mesh-o' }),
      part('empty', { kind: 'group' }),
    ],
    meshes: [
      rectMesh('mesh-a', 100, 100, 100, 50),
      rectMesh('mesh-c', 150, 400, 20, 20),
      rectMesh('mesh-o', -500, -500, 10, 10),
    ],
    drawOrder: ['a', 'b', 'c', 'o'],
  });
  return {
    ...p,
    assets: [
      testAsset('asset-a', { x: 0, y: 0 }, 400, 400),
      testAsset('asset-b', { x: 300, y: 120 }, 50, 30),
      testAsset('asset-c', { x: 0, y: 0 }, 1, 1),
      testAsset('asset-o', { x: 0, y: 0 }, 1, 1),
    ],
  };
}

function warpBinding(id: string, warpId: string, keys: number): Binding {
  return {
    id,
    target: { type: 'warp', id: warpId },
    channel: 'warpPoints',
    parameterIds: ['FaceAngleX'],
    keyValues: [[0, 30]],
    keys: Array.from({ length: keys }, (_, i) => ({ coords: [i * 30], delta: [], source: 'manual', locked: false })),
    generation: 'linear',
    divisions: null,
  };
}

describe('descendantImageBounds', () => {
  it('子孫の画像パーツの外接矩形。メッシュが無ければ素材の矩形。グループ自身と祖先の変形は含めず、間のグループの変形は含める', () => {
    // a: 100..200 × 100..150、b: 300..350 × 120..150、c: 150..170 × 400..420 を h で下へ 100 → 500..520
    expect(descendantImageBounds(project(), 'g')).toEqual({ x: 100, y: 100, width: 250, height: 420 });
  });

  it('間のグループのワープも掛ける', () => {
    const p = project();
    const hWarp: Warp = {
      id: 'wh',
      partId: 'h',
      columns: 1,
      rows: 1,
      bounds: { x: 100, y: 300, width: 100, height: 200 },
      points: [
        { x: 100, y: 300 },
        { x: 200, y: 300 },
        { x: 100, y: 500 },
        { x: 200, y: 500 },
      ].map((q) => ({ x: q.x + 40, y: q.y })),
    };
    const bounds = descendantImageBounds({ ...p, model: { ...p.model, warps: [hWarp] } }, 'g')!;
    // c は右へ 40: 190..210
    expect(bounds.x + bounds.width).toBeCloseTo(350);
    expect(bounds.y + bounds.height).toBeCloseTo(520);
    // h 自身のワープは、h の外接矩形には掛けない（ワープの入力の空間で測る）
    expect(descendantImageBounds({ ...p, model: { ...p.model, warps: [hWarp] } }, 'h')).toEqual({
      x: 150,
      y: 400,
      width: 20,
      height: 20,
    });
  });

  it('画像パーツが無ければ null', () => {
    expect(descendantImageBounds(project(), 'empty')).toBeNull();
    expect(descendantImageBounds(project(), 'none')).toBeNull();
  });
});

describe('warpBoundsFor', () => {
  it('幅・高さの 5% を各辺に足す', () => {
    expect(warpBoundsFor({ x: 100, y: 100, width: 200, height: 400 })).toEqual({
      x: 90,
      y: 80,
      width: 220,
      height: 440,
    });
  });

  it('幅や高さが 0 でも余白は最低 1px', () => {
    expect(warpBoundsFor({ x: 10, y: 20, width: 0, height: 0 })).toEqual({ x: 9, y: 19, width: 2, height: 2 });
  });
});

describe('createWarp', () => {
  it('分割の数の規則的な格子を、余白を足した範囲に作る', () => {
    const warp = createWarp(project(), 'g', 4, 2, 'w1')!;
    expect(warp).toMatchObject({ id: 'w1', partId: 'g', columns: 4, rows: 2 });
    expect(warp.bounds.x).toBeCloseTo(87.5);
    expect(warp.bounds.y).toBeCloseTo(79);
    expect(warp.bounds.width).toBeCloseTo(275);
    expect(warp.bounds.height).toBeCloseTo(462);
    expect(warp.points).toHaveLength(15);
    expect(warp.points[0]!.x).toBeCloseTo(87.5);
    expect(warp.points[0]!.y).toBeCloseTo(79);
    expect(warp.points[6]!.x).toBeCloseTo(87.5 + 275 / 4);
    expect(warp.points[6]!.y).toBeCloseTo(79 + 462 / 2);
    expect(warp.points[14]!.x).toBeCloseTo(362.5);
    expect(warp.points[14]!.y).toBeCloseTo(541);
  });

  it('分割は 2〜8 に丸める', () => {
    expect(createWarp(project(), 'g', 1, 20, 'w')).toMatchObject({ columns: 2, rows: 8 });
    expect(clampDivisions(Number.NaN)).toBe(4);
    expect(clampDivisions(5.4)).toBe(5);
  });

  it('グループでない・画像パーツが無いときは null', () => {
    expect(createWarp(project(), 'a', 4, 4, 'w')).toBeNull();
    expect(createWarp(project(), 'empty', 4, 4, 'w')).toBeNull();
  });
});

describe('addWarpCommand・removeWarpCommand', () => {
  it('ワープを足す。入力は書き換えず、すでにワープがあるグループには足さない', () => {
    const before = deepFreeze(project());
    const command = addWarpCommand('g', 4, 4, 'w1');
    expect(command.label).toBe('ワープの追加');
    const after = command.apply(before);
    expect(after.model.warps.map((w) => w.id)).toEqual(['w1']);
    expect(before.model.warps).toEqual([]);
    expect(addWarpCommand('g', 3, 3, 'w2').apply(after)).toBe(after);
    expect(addWarpCommand('empty', 3, 3, 'w3').apply(after)).toBe(after);
  });

  it('ワープと、そのワープのバインディングだけを消す', () => {
    const p = project();
    const w1 = createWarp(p, 'g', 4, 4, 'w1')!;
    const w2 = createWarp(p, 'h', 2, 2, 'w2')!;
    const other: Binding = {
      ...warpBinding('mesh-key', 'x', 1),
      target: { type: 'mesh', id: 'w1' },
      channel: 'vertices',
    };
    const withWarps = deepFreeze({
      ...p,
      model: {
        ...p.model,
        warps: [w1, w2],
        bindings: [warpBinding('k1', 'w1', 2), warpBinding('k2', 'w2', 1), other, warpBinding('k3', 'w1', 1)],
      },
    });
    expect(warpKeyCount(withWarps.model, 'w1')).toBe(3);
    const command = removeWarpCommand('w1');
    expect(command.label).toBe('ワープの削除');
    const after = command.apply(withWarps);
    expect(after.model.warps.map((w) => w.id)).toEqual(['w2']);
    expect(after.model.bindings.map((b) => b.id)).toEqual(['k2', 'mesh-key']);
    expect(removeWarpCommand('none').apply(withWarps)).toBe(withWarps);
  });
});
