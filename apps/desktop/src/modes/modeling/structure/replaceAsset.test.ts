import { describe, expect, it, vi } from 'vitest';
import type { Binding, Vec2 } from '@app/schema';
import { createMeshGenerator, createProjectStore } from '@app/core';
import { FakeMeshGenerator, type Services } from '@app/contracts';
import { alphaImage, deformedAt } from '../mesh/testAppearance';
import { REPLACE_CONFIRM_MESSAGE, replaceAsset, replaceAssetCommand, sameSize } from './replaceAsset';
import { counterIds, makeAsset, makeBinding, makeMesh, makePart, makeProject } from './testing';

// makeMesh の三角形 (0,0)・(10,0)・(0,10) の頂点ごとの差分
const KEY_DELTAS: Vec2[] = [
  { x: 1, y: 2 },
  { x: 11, y: 2 },
  { x: 1, y: -8 },
];
const keyed = (deltas: Vec2[] = KEY_DELTAS): Binding['keys'] => [
  { coords: [30], delta: deltas, source: 'manual', locked: false },
];

function project(keys: Binding['keys'] = []) {
  return makeProject({
    assets: [
      makeAsset('old', { width: 100, height: 50, offset: { x: 10, y: 10 } }),
      makeAsset('same', { width: 100, height: 50, offset: { x: 300, y: 300 } }),
      makeAsset('big', { width: 200, height: 80, offset: { x: 5, y: 6 } }),
    ],
    parts: [makePart('p', { assetId: 'old', meshId: 'm' }), makePart('q', { assetId: 'old', meshId: null })],
    meshes: [makeMesh('m', { density: 'smooth', edited: true })],
    bindings: [
      makeBinding('bv', { target: { type: 'mesh', id: 'm' }, channel: 'vertices', keys }),
      makeBinding('bt', { target: { type: 'part', id: 'p' } }),
    ],
  });
}

const rebuilt = {
  vertices: [
    { x: 0, y: 0 },
    { x: 5, y: 5 },
    { x: 20, y: 0 },
  ],
  uvs: [
    { x: 0, y: 0 },
    { x: 0.5, y: 0.5 },
    { x: 1, y: 0 },
  ],
  triangles: [[0, 1, 2]] as [number, number, number][],
  density: 'smooth' as const,
};

describe('replaceAssetCommand', () => {
  it('幅と高さが同じなら assetId だけを替える', () => {
    const p = project(keyed());
    const next = replaceAssetCommand('p', 'same', null).apply(p);
    expect(next.model.parts[0]).toEqual({ ...p.model.parts[0], assetId: 'same' });
    expect(next.model.meshes).toBe(p.model.meshes);
    expect(next.model.bindings).toBe(p.model.bindings);
  });

  it('違うならメッシュを作り直し、そのメッシュの頂点のキーを新しい頂点へ転写する（リセットしない）', () => {
    const p = project(keyed());
    const next = replaceAssetCommand('p', 'big', rebuilt).apply(p);
    expect(next.model.parts[0]).toMatchObject({ assetId: 'big', meshId: 'm' });
    expect(next.model.meshes).toEqual([{ id: 'm', ...rebuilt, edited: false }]);
    expect(next.model.bindings.map((b) => b.id)).toEqual(['bv', 'bt']);
    const deltas = next.model.bindings[0]!.keys[0]!.delta as Vec2[];
    // (0,0) は旧い頂点と同じ → そのまま。(5,5) は旧い三角形の中 → 補間。(20,0) は外 → いちばん近い点 (10,0) の差分
    expect(deltas[0]).toEqual(KEY_DELTAS[0]);
    expect(deltas[1]!.x).toBeCloseTo(6);
    expect(deltas[1]!.y).toBeCloseTo(-3);
    expect(deltas[2]).toEqual(KEY_DELTAS[1]);
    expect(next.model.bindings[1]).toBe(p.model.bindings[1]);
  });

  it('キーが無ければバインディングはそのまま', () => {
    const p = project();
    const next = replaceAssetCommand('p', 'big', rebuilt).apply(p);
    expect(next.model.bindings).toBe(p.model.bindings);
  });

  it('メッシュを作れなかった（null）ならメッシュを外し、そのメッシュのキーも消す', () => {
    const next = replaceAssetCommand('p', 'big', null).apply(project(keyed()));
    expect(next.model.parts[0]).toMatchObject({ assetId: 'big', meshId: null });
    expect(next.model.meshes).toEqual([]);
    expect(next.model.bindings.map((b) => b.id)).toEqual(['bt']);
  });

  it('メッシュの無いパーツには新しく作る', () => {
    const next = replaceAssetCommand('q', 'big', rebuilt, { newId: counterIds('mesh') }).apply(project());
    expect(next.model.parts[1]).toMatchObject({ assetId: 'big', meshId: 'mesh1' });
    expect(next.model.meshes.map((m) => m.id)).toEqual(['m', 'mesh1']);
  });

  it('同じ素材・無い素材・グループなら何もしない', () => {
    const p = project();
    expect(replaceAssetCommand('p', 'old', null).apply(p)).toBe(p);
    expect(replaceAssetCommand('p', 'nope', null).apply(p)).toBe(p);
    expect(replaceAssetCommand('nope', 'big', null).apply(p)).toBe(p);
  });

  it('sameSize', () => {
    const [a, b, c] = project().assets;
    expect(sameSize(a, b)).toBe(true);
    expect(sameSize(a, c)).toBe(false);
    expect(sameSize(undefined, a)).toBe(false);
  });
});

describe('replaceAsset（画面から）', () => {
  function services(keys: Binding['keys'] = keyed()) {
    const store = createProjectStore(project(keys));
    const imageData = { width: 200, height: 80 } as ImageData;
    const assets = { getImageData: (id: string) => (id === 'big' ? imageData : undefined) };
    return { store, assets, meshGenerator: new FakeMeshGenerator() } as unknown as Services;
  }

  it('同じ大きさなら確認せずに替える', async () => {
    const s = services();
    const confirm = vi.fn(async () => true);
    await expect(replaceAsset(s, { confirm, notify: vi.fn() }, 'p', 'same')).resolves.toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(s.store.get().model.parts[0]!.assetId).toBe('same');
  });

  it('違う大きさは「変形を新しいメッシュへ移します」と確認してから、新しい素材の位置でメッシュを作り直して転写する。Undo で戻る', async () => {
    const s = services();
    const before = s.store.get();
    const confirm = vi.fn(async () => true);
    await expect(replaceAsset(s, { confirm, notify: vi.fn() }, 'p', 'big')).resolves.toBe(true);
    expect(confirm).toHaveBeenCalledWith(REPLACE_CONFIRM_MESSAGE);
    expect(REPLACE_CONFIRM_MESSAGE).toBe('変形を新しいメッシュへ移します');
    const mesh = s.store.get().model.meshes.find((m) => m.id === 'm')!;
    expect(mesh.vertices[0]).toEqual({ x: 5, y: 6 });
    expect(mesh.vertices[2]).toEqual({ x: 205, y: 86 });
    expect(mesh.density).toBe('smooth');
    expect(s.store.get().model.bindings.map((b) => b.id)).toEqual(['bv', 'bt']);
    expect(s.store.get().model.bindings[0]!.keys[0]!.delta).toHaveLength(4);
    s.store.undo();
    expect(s.store.get()).toBe(before);
  });

  it('頂点のキーが無ければ確認しない', async () => {
    const s = services([]);
    const confirm = vi.fn(async () => true);
    await expect(replaceAsset(s, { confirm, notify: vi.fn() }, 'p', 'big')).resolves.toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(s.store.get().model.parts[0]!.assetId).toBe('big');
  });

  it('確認で断ったら何もしない。画像が無ければ知らせる', async () => {
    const s = services();
    const before = s.store.get();
    await expect(replaceAsset(s, { confirm: async () => false, notify: vi.fn() }, 'p', 'big')).resolves.toBe(false);
    expect(s.store.get()).toBe(before);
    const notify = vi.fn();
    const noImage = { ...s, assets: { getImageData: () => undefined } } as unknown as Services;
    await expect(replaceAsset(noImage, { confirm: async () => true, notify }, 'q', 'big')).resolves.toBe(false);
    expect(notify).toHaveBeenCalled();
  });
});

describe('差し替えの見た目', () => {
  // 同じ絵（楕円）を、余白を付けて書き出し直した素材に差し替える。キャンバス上の同じ所の変形がほぼ変わらない
  const ellipse = (cx: number, cy: number) => (x: number, y: number) =>
    ((x - cx) / 180) ** 2 + ((y - cy) / 120) ** 2 <= 1;
  const OLD = { offset: { x: 100, y: 100 }, width: 380, height: 260 };
  const NEW = { offset: { x: 60, y: 70 }, width: 470, height: 330 };
  const oldAlpha = alphaImage(OLD.width, OLD.height, ellipse(190, 130));
  const newAlpha = alphaImage(NEW.width, NEW.height, ellipse(230, 160));
  const field = (p: Vec2): Vec2 => {
    const nx = (p.x - 290) / 190;
    const ny = (p.y - 230) / 130;
    return { x: 25 * (1 - ny * ny) - 5 * ny, y: 8 * nx * nx + 4 * nx };
  };

  it('余白の違う素材へ差し替えても、変形後の見た目がほぼ変わらない', async () => {
    const generator = createMeshGenerator();
    const g = generator.generate(oldAlpha, OLD.offset, 'standard');
    const base = makeProject({
      assets: [
        makeAsset('old', { width: OLD.width, height: OLD.height, offset: OLD.offset }),
        makeAsset('padded', { width: NEW.width, height: NEW.height, offset: NEW.offset }),
      ],
      parts: [makePart('p', { assetId: 'old', meshId: 'm' })],
      meshes: [makeMesh('m', { ...g, density: 'standard' })],
      bindings: [
        makeBinding('bv', {
          target: { type: 'mesh', id: 'm' },
          channel: 'vertices',
          keys: keyed(g.vertices.map(field)),
        }),
      ],
    });
    const store = createProjectStore(base);
    const s = {
      store,
      assets: { getImageData: (id: string) => (id === 'padded' ? newAlpha : undefined) },
      meshGenerator: generator,
    } as unknown as Services;
    await expect(replaceAsset(s, { confirm: async () => true, notify: vi.fn() }, 'p', 'padded')).resolves.toBe(true);

    const oldMesh = base.model.meshes[0]!;
    const oldDeltas = base.model.bindings[0]!.keys[0]!.delta as Vec2[];
    const newMesh = store.get().model.meshes[0]!;
    const newDeltas = store.get().model.bindings[0]!.keys[0]!.delta as Vec2[];
    expect(newDeltas).toHaveLength(newMesh.vertices.length);
    // キャンバス上の点を、それぞれの素材の uv に直して、変形後の位置のずれの最大を比べる
    const errorOf = (deltas: Vec2[] | undefined) => {
      let max = 0;
      let samples = 0;
      for (let y = OLD.offset.y + 5; y < OLD.offset.y + OLD.height; y += 10) {
        for (let x = OLD.offset.x + 5; x < OLD.offset.x + OLD.width; x += 10) {
          const p = deformedAt(oldMesh, oldDeltas, {
            x: (x - OLD.offset.x) / OLD.width,
            y: (y - OLD.offset.y) / OLD.height,
          });
          const q = deformedAt(newMesh, deltas, {
            x: (x - NEW.offset.x) / NEW.width,
            y: (y - NEW.offset.y) / NEW.height,
          });
          if (!p || !q) continue;
          samples++;
          max = Math.max(max, Math.hypot(p.x - q.x, p.y - q.y));
        }
      }
      return { max, samples };
    };
    const error = errorOf(newDeltas);
    expect(error.samples).toBeGreaterThan(300);
    // 変形は最大 25px ほど。ずれは 1 割未満で、新しい頂点で元の変形（式）を直接測って付けた場合と同じくらい
    // （転写は旧いメッシュの区分線形の変形しか知らないので、補間を2回したぶん少し大きくなることがある）
    expect(error.max).toBeLessThan(2.5);
    expect(error.max).toBeLessThanOrEqual(errorOf(newMesh.vertices.map(field)).max * 1.5);
    // リセットなら変形がまるごと消える
    expect(errorOf(undefined).max).toBeGreaterThan(20);
  });
});
