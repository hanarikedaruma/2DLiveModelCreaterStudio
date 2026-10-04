import { createEmptyProject, type Binding, type Mesh, type Model, type Vec2 } from '@app/schema';
import { describe, expect, it } from 'vitest';
import { generateMesh, type MeshDensityLevel } from './generator';
import { disc, makeAlpha, minus, rect, union } from './testImages';
import { transferMeshKeys, transferPointDeltas } from './transfer';

type Triangle = [number, number, number];
interface Shape {
  vertices: Vec2[];
  uvs: Vec2[];
  triangles: Triangle[];
}

const OFFSET: Vec2 = { x: 40, y: 25 };
const IMAGE = makeAlpha(300, 260, union(disc(150, 130, 110), rect(20, 110, 280, 150)));
const meshOf = (density: MeshDensityLevel, image = IMAGE, offset = OFFSET): Shape =>
  generateMesh(image, offset, density);

// 正方形 (0,0)-(10,10) を三角形2枚で
const SQUARE: Shape = {
  vertices: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
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
};
const SQUARE_DELTAS: Vec2[] = [
  { x: 1, y: 0 },
  { x: 3, y: -2 },
  { x: 5, y: 4 },
  { x: -1, y: 6 },
];

const near = (a: Vec2, b: Vec2, digits = 9) => {
  expect(a.x).toBeCloseTo(b.x, digits);
  expect(a.y).toBeCloseTo(b.y, digits);
};

// なめらかな変形（顔を横へ向けたような、中央ほど大きく動く横の移動と、少しの回転）
const CENTER: Vec2 = { x: OFFSET.x + 150, y: OFFSET.y + 130 };
function smoothField(p: Vec2): Vec2 {
  const ny = (p.y - CENTER.y) / 150;
  const nx = (p.x - CENTER.x) / 150;
  return { x: 20 * (1 - ny * ny) - 4 * ny, y: 6 * nx * nx + 3 * nx };
}

// 描いたときの見た目: 素材の中の位置 uv が、変形後にキャンバスのどこへ行くか（uv で三角形を探して重心座標で補間）
function deformedAt(mesh: Shape, deltas: Vec2[], uv: Vec2): Vec2 | null {
  for (const [i, j, k] of mesh.triangles) {
    const a = mesh.uvs[i]!;
    const b = mesh.uvs[j]!;
    const c = mesh.uvs[k]!;
    const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (Math.abs(area) < 1e-12) continue;
    const u = ((b.x - uv.x) * (c.y - uv.y) - (b.y - uv.y) * (c.x - uv.x)) / area;
    const v = ((c.x - uv.x) * (a.y - uv.y) - (c.y - uv.y) * (a.x - uv.x)) / area;
    const w = 1 - u - v;
    if (u < -1e-9 || v < -1e-9 || w < -1e-9) continue;
    const at = (n: number) => {
      const p = mesh.vertices[n]!;
      const d = deltas[n] ?? { x: 0, y: 0 };
      return { x: p.x + d.x, y: p.y + d.y };
    };
    const [pa, pb, pc] = [at(i), at(j), at(k)];
    return { x: u * pa.x + v * pb.x + w * pc.x, y: u * pa.y + v * pb.y + w * pc.y };
  }
  return null;
}

// 両方のメッシュが覆う不透明なピクセル（8px おき）で、変形後の位置のずれの最大
function appearanceError(
  before: { mesh: Shape; deltas: Vec2[] },
  after: { mesh: Shape; deltas: Vec2[] },
  image: ImageData,
): { max: number; samples: number } {
  let max = 0;
  let samples = 0;
  for (let y = 4; y < image.height; y += 8) {
    for (let x = 4; x < image.width; x += 8) {
      if ((image.data[(y * image.width + x) * 4 + 3] ?? 0) < 8) continue;
      const uv = { x: (x + 0.5) / image.width, y: (y + 0.5) / image.height };
      const p = deformedAt(before.mesh, before.deltas, uv);
      const q = deformedAt(after.mesh, after.deltas, uv);
      if (!p || !q) continue;
      samples++;
      max = Math.max(max, Math.hypot(p.x - q.x, p.y - q.y));
    }
  }
  return { max, samples };
}

describe('transferPointDeltas', () => {
  it('同じメッシュへの転写で差分が変わらない', () => {
    for (const density of ['light', 'standard', 'smooth'] as const) {
      const mesh = meshOf(density);
      const deltas = mesh.vertices.map((_, i) => ({ x: Math.sin(i * 1.7) * 9, y: Math.cos(i * 0.3) * 4 }));
      expect(transferPointDeltas(mesh.vertices, mesh.triangles, mesh.vertices, deltas)).toEqual(deltas);
    }
  });

  it('一様な平行移動の差分が、より細かいメッシュへ正しく移る（外側の点も）', () => {
    const from = meshOf('standard');
    const to = meshOf('smooth');
    expect(to.vertices.length).toBeGreaterThan(from.vertices.length);
    const move = { x: 12.5, y: -7.25 };
    const out = transferPointDeltas(
      from.vertices,
      from.triangles,
      to.vertices,
      from.vertices.map(() => move),
    );
    expect(out).toHaveLength(to.vertices.length);
    for (const d of out) near(d, move);
  });

  it('線形な差分（位置の1次式）は、旧いメッシュの中の点でそのまま再現する', () => {
    const from = meshOf('light');
    const to = meshOf('smooth');
    const linear = (p: Vec2) => ({ x: 0.1 * p.x - 0.05 * p.y + 3, y: 0.02 * p.x + 0.2 * p.y - 1 });
    const out = transferPointDeltas(from.vertices, from.triangles, to.vertices, from.vertices.map(linear));
    let inside = 0;
    to.vertices.forEach((p, i) => {
      if (!containedIn(from, p)) return;
      inside++;
      near(out[i]!, linear(p), 6);
    });
    expect(inside).toBeGreaterThan(to.vertices.length / 2);
  });

  it('外側の点: いちばん近い三角形の重心座標（0..1 に丸める）を使う', () => {
    const t = (p: Vec2) => transferPointDeltas(SQUARE.vertices, SQUARE.triangles, [p], SQUARE_DELTAS)[0]!;
    const avg = (a: Vec2, b: Vec2, s = 0.5) => ({ x: a.x * (1 - s) + b.x * s, y: a.y * (1 - s) + b.y * s });
    const [d0, d1, d2, d3] = SQUARE_DELTAS as [Vec2, Vec2, Vec2, Vec2];
    // 右の辺の外 → 右の辺の上の点
    near(t({ x: 15, y: 5 }), avg(d1, d2));
    near(t({ x: 30, y: 2.5 }), avg(d1, d2, 0.25));
    // 上の辺の外
    near(t({ x: 4, y: -3 }), avg(d0, d1, 0.4));
    // 角の外 → 角の頂点の差分
    near(t({ x: -5, y: -5 }), d0);
    near(t({ x: 20, y: 25 }), d2);
    near(t({ x: -1, y: 100 }), d3);
    // 中の点はふつうの補間（(0,1,2) の三角形の中）
    near(t({ x: 6, y: 2 }), { x: 0.4 * d0.x + 0.4 * d1.x + 0.2 * d2.x, y: 0.4 * d0.y + 0.4 * d1.y + 0.2 * d2.y });
  });

  it('外側の点の差分は、旧い差分の範囲を超えない（外へ延ばさない）', () => {
    const from = meshOf('standard');
    const deltas = from.vertices.map(smoothField);
    const far = [
      { x: -500, y: -500 },
      { x: 2000, y: 130 },
      { x: 190, y: 1500 },
    ];
    const out = transferPointDeltas(from.vertices, from.triangles, far, deltas);
    const xs = deltas.map((d) => d.x);
    const ys = deltas.map((d) => d.y);
    for (const d of out) {
      expect(d.x).toBeGreaterThanOrEqual(Math.min(...xs) - 1e-9);
      expect(d.x).toBeLessThanOrEqual(Math.max(...xs) + 1e-9);
      expect(d.y).toBeGreaterThanOrEqual(Math.min(...ys) - 1e-9);
      expect(d.y).toBeLessThanOrEqual(Math.max(...ys) + 1e-9);
    }
  });

  it('三角形が無ければいちばん近い頂点、頂点も無ければ 0。足りない差分は 0 とみなす', () => {
    const p = [{ x: 9, y: 1 }];
    expect(transferPointDeltas(SQUARE.vertices, [], p, SQUARE_DELTAS)).toEqual([SQUARE_DELTAS[1]]);
    // つぶれた三角形だけ
    expect(transferPointDeltas(SQUARE.vertices, [[0, 0, 1]], p, SQUARE_DELTAS)).toEqual([SQUARE_DELTAS[1]]);
    expect(transferPointDeltas([], [], p, [])).toEqual([{ x: 0, y: 0 }]);
    const out = transferPointDeltas(
      SQUARE.vertices,
      SQUARE.triangles,
      [
        { x: 10, y: 10 },
        { x: 5, y: 5 },
      ],
      [{ x: 2, y: 2 }],
    );
    expect(out[0]).toEqual({ x: 0, y: 0 });
    near(out[1]!, { x: 1, y: 1 }); // (0,0)-(10,10) の対角線の中点: d0 と d2（0）の平均
  });

  it('大きなメッシュでも速い（なめらか → 標準、1500×1500 の素材）', () => {
    const big = makeAlpha(1500, 1500, minus(disc(750, 750, 740), disc(750, 750, 200)));
    const from = generateMesh(big, OFFSET, 'smooth');
    const to = generateMesh(big, { x: OFFSET.x + 7, y: OFFSET.y - 5 }, 'standard');
    const deltas = from.vertices.map(smoothField);
    const start = performance.now();
    const out = transferPointDeltas(from.vertices, from.triangles, to.vertices, deltas);
    const ms = performance.now() - start;
    expect(out).toHaveLength(to.vertices.length);
    expect(from.vertices.length).toBeGreaterThan(2000);
    expect(ms).toBeLessThan(500);
  });
});

function containedIn(mesh: Shape, p: Vec2): boolean {
  return mesh.triangles.some(([i, j, k]) => {
    const a = mesh.vertices[i]!;
    const b = mesh.vertices[j]!;
    const c = mesh.vertices[k]!;
    const s = (q: Vec2, r: Vec2) => (r.x - q.x) * (p.y - q.y) - (r.y - q.y) * (p.x - q.x);
    const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const [u, v, w] = [s(b, c) / area, s(c, a) / area, s(a, b) / area];
    return u > 1e-6 && v > 1e-6 && w > 1e-6;
  });
}

describe('transferMeshKeys', () => {
  const key = (coords: number[], delta: Binding['keys'][number]['delta']) => ({
    coords,
    delta,
    source: 'manual' as const,
    locked: false,
  });
  const binding = (id: string, fields: Partial<Binding>): Binding => ({
    id,
    target: { type: 'mesh', id: 'm' },
    channel: 'vertices',
    parameterIds: ['FaceAngleX'],
    keyValues: [[-30, 0, 30]],
    keys: [],
    generation: 'linear',
    divisions: null,
    ...fields,
  });
  const mesh = (id: string, shape: Shape): Mesh => ({ id, ...shape, density: 'standard', edited: false });

  function model(): Model {
    const base = createEmptyProject('テスト').model;
    const zeros = SQUARE.vertices.map(() => ({ x: 0, y: 0 }));
    return {
      ...base,
      meshes: [mesh('m', SQUARE), mesh('other', SQUARE)],
      bindings: [
        binding('v1', { keys: [key([0], zeros), key([30], SQUARE_DELTAS)] }),
        binding('v2', {
          parameterIds: ['FaceAngleX', 'FaceAngleY'],
          keyValues: [
            [-30, 0, 30],
            [-30, 0, 30],
          ],
          keys: [
            key(
              [30, 30],
              SQUARE_DELTAS.map((d) => ({ x: d.x * 2, y: d.y * 2 })),
            ),
          ],
        }),
        binding('vo', { target: { type: 'mesh', id: 'other' }, keys: [key([30], SQUARE_DELTAS)] }),
        binding('w', { target: { type: 'warp', id: 'm' }, channel: 'warpPoints', keys: [key([30], SQUARE_DELTAS)] }),
        binding('t', {
          target: { type: 'part', id: 'p' },
          channel: 'transform',
          keys: [key([30], { position: { x: 1, y: 2 }, rotation: 3, scale: { x: 1, y: 1 }, opacity: 1 })],
        }),
      ],
    };
  }

  // 正方形の中心と右の辺の中点を足したメッシュ
  const refined: Pick<Mesh, 'vertices'> = {
    vertices: [...SQUARE.vertices, { x: 5, y: 5 }, { x: 10, y: 5 }],
  };

  it('そのメッシュを対象にする vertices バインディングの全キーを転写する', () => {
    const before = model();
    const after = transferMeshKeys(before, 'm', refined);
    const deltas = (id: string, n = 0) => after.bindings.find((b) => b.id === id)!.keys[n]!.delta as Vec2[];
    const [d0, d1, d2] = SQUARE_DELTAS as [Vec2, Vec2, Vec2];
    expect(deltas('v1', 0)).toEqual(Array.from({ length: 6 }, () => ({ x: 0, y: 0 })));
    const v1 = deltas('v1', 1);
    expect(v1.slice(0, 4)).toEqual(SQUARE_DELTAS);
    near(v1[4]!, { x: (d0.x + d2.x) / 2, y: (d0.y + d2.y) / 2 });
    near(v1[5]!, { x: (d1.x + d2.x) / 2, y: (d1.y + d2.y) / 2 });
    const v2 = deltas('v2');
    expect(v2).toHaveLength(6);
    near(v2[5]!, { x: d1.x + d2.x, y: d1.y + d2.y });
    // キーの位置・source・locked などはそのまま
    const k = after.bindings.find((b) => b.id === 'v1')!.keys[1]!;
    expect(k).toMatchObject({ coords: [30], source: 'manual', locked: false });
    // ほかのメッシュ・ワープの制御点・Transform のバインディングは変えない
    for (const id of ['vo', 'w', 't']) {
      expect(after.bindings.find((b) => b.id === id)).toBe(before.bindings.find((b) => b.id === id));
    }
    // メッシュ自体は置き換えない
    expect(after.meshes).toBe(before.meshes);
  });

  it('メッシュが無い・キーが無いなら model をそのまま返す', () => {
    const m = model();
    expect(transferMeshKeys(m, 'nope', refined)).toBe(m);
    const noKeys: Model = { ...m, bindings: m.bindings.filter((b) => b.target.id !== 'm' || b.channel !== 'vertices') };
    expect(transferMeshKeys(noKeys, 'm', refined)).toBe(noKeys);
  });

  it('同じ頂点のメッシュへの転写でキーが変わらない', () => {
    const m = model();
    const after = transferMeshKeys(m, 'm', SQUARE);
    expect(after.bindings).toEqual(m.bindings);
  });
});

describe('見た目（密度の変更）', () => {
  // 標準のメッシュに付けたなめらかな変形を、ほかの密度で作り直したメッシュへ移す
  const images: { name: string; image: ImageData }[] = [
    { name: '円と横長の四角', image: IMAGE },
    { name: '穴のある輪', image: makeAlpha(300, 300, minus(disc(150, 150, 140), disc(150, 150, 60))) },
  ];
  for (const { name, image } of images) {
    for (const density of ['light', 'smooth'] as const) {
      it(`${name}: 標準 → ${density === 'light' ? '軽い' : 'なめらか'}で、見た目がほぼ変わらない`, () => {
        const from = meshOf('standard', image);
        const to = meshOf(density, image);
        const deltas = from.vertices.map(smoothField);
        const moved = transferPointDeltas(from.vertices, from.triangles, to.vertices, deltas);
        const error = appearanceError({ mesh: from, deltas }, { mesh: to, deltas: moved }, image);
        expect(error.samples).toBeGreaterThan(300);
        // 変形の大きさは 20px ほど。ずれは なめらか で 1px、軽い（頂点が 20 個ほど）で 3px 未満
        expect(error.max).toBeLessThan(density === 'light' ? 3 : 1);
        // 新しい頂点で元の変形（式）を直接測って付けた場合と同じくらい（転写は旧いメッシュの区分線形の変形しか知らない）
        const sampled = appearanceError(
          { mesh: from, deltas },
          { mesh: to, deltas: to.vertices.map(smoothField) },
          image,
        );
        expect(error.max).toBeLessThanOrEqual(sampled.max * 1.5);
        // リセットすると変形がまるごと消える
        const reset = appearanceError(
          { mesh: from, deltas },
          { mesh: to, deltas: to.vertices.map(() => ({ x: 0, y: 0 })) },
          image,
        );
        expect(reset.max).toBeGreaterThan(15);
      });
    }
  }
});
