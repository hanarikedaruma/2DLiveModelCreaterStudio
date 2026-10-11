import { describe, expect, it } from 'vitest';
import type { Mesh, Vec2 } from '@app/schema';
import { contourBasis, contourSamples } from './spline';
import { attachPoint, attachedPoint, contourOnMesh } from './attach';
import { contourFalloff, contourShapeValid, distanceToLine, spreadAlongLine } from './field';
import { fitLineMotion } from './fit';

const P: Vec2[] = [
  { x: 0, y: 0 },
  { x: 60, y: 20 },
  { x: 120, y: 10 },
  { x: 180, y: 60 },
  { x: 240, y: 70 },
  { x: 300, y: 40 },
];

// 格子のメッシュ（size × size のマスを cols × rows 個）。UV は 0..1
function gridMesh(cols: number, rows: number, size: number, origin: Vec2 = { x: 0, y: 0 }): Mesh {
  const vertices: Vec2[] = [];
  const uvs: Vec2[] = [];
  for (let r = 0; r <= rows; r++)
    for (let c = 0; c <= cols; c++) {
      vertices.push({ x: origin.x + c * size, y: origin.y + r * size });
      uvs.push({ x: c / cols, y: r / rows });
    }
  const triangles: Mesh['triangles'] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const a = r * (cols + 1) + c;
      triangles.push([a, a + 1, a + cols + 1], [a + 1, a + cols + 2, a + cols + 1]);
    }
  return { id: 'm', vertices, uvs, triangles, density: 'custom', edited: false };
}

describe('I-068: 輪郭線の曲線', () => {
  it('点を通り、点の位置の足し算になっている', () => {
    const basis = contourBasis(P);
    const samples = contourSamples(basis, P);
    // 各区間の最初のサンプルと最後のサンプルが点に一致する
    for (let k = 0; k < P.length - 1; k++) {
      const first = basis.segments.indexOf(k);
      expect(samples[first]!.x).toBeCloseTo(P[k]!.x, 9);
      expect(samples[first]!.y).toBeCloseTo(P[k]!.y, 9);
    }
    expect(samples.at(-1)!.x).toBeCloseTo(P.at(-1)!.x, 9);
    // 重みの合計は 1（平行移動で全体が同じだけ動く）
    for (const w of basis.weights) expect(w.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 12);
    // 足し算: 点 A + 点 B の曲線 = A の曲線 + B の曲線
    const B = P.map((p, i) => ({ x: i * 7, y: -p.x / 3 }));
    const a = contourSamples(basis, P);
    const b = contourSamples(basis, B);
    const ab = contourSamples(
      basis,
      P.map((p, i) => ({ x: p.x + B[i]!.x, y: p.y + B[i]!.y })),
    );
    ab.forEach((q, j) => {
      expect(q.x).toBeCloseTo(a[j]!.x + b[j]!.x, 9);
      expect(q.y).toBeCloseTo(a[j]!.y + b[j]!.y, 9);
    });
  });

  it('1つの点を動かすと、変わるのはその点の両側2区間ずつだけ', () => {
    const basis = contourBasis(P);
    const before = contourSamples(basis, P);
    const moved = P.map((p, i) => (i === 1 ? { x: p.x, y: p.y + 30 } : p));
    const after = contourSamples(basis, moved);
    before.forEach((p, j) => {
      const s = basis.segments[j]!;
      const changed = Math.hypot(after[j]!.x - p.x, after[j]!.y - p.y) > 1e-9;
      // 点 1 が効く区間は 0..2（両側2区間ずつ。左は端なので1区間）
      if (s > 2) expect(changed).toBe(false);
    });
    expect(after.some((p, j) => basis.segments[j] === 2 && Math.abs(p.y - before[j]!.y) > 1e-6)).toBe(true);
  });

  it('2点なら直線になる', () => {
    const basis = contourBasis([
      { x: 0, y: 0 },
      { x: 100, y: 50 },
    ]);
    const samples = contourSamples(basis, [
      { x: 0, y: 0 },
      { x: 100, y: 50 },
    ]);
    for (const s of samples) expect(Math.abs(s.y - s.x / 2)).toBeLessThan(1e-9);
  });
});

describe('I-068: 動きを頂点へ広げる', () => {
  const samples = contourSamples(contourBasis(P), P);

  it('弱め方: 影響幅の1/4までは1、影響幅で0、その間は滑らかに下がる', () => {
    expect(contourFalloff(0, 40)).toBe(1);
    expect(contourFalloff(10, 40)).toBe(1);
    expect(contourFalloff(40, 40)).toBe(0);
    expect(contourFalloff(25, 40)).toBeCloseTo(0.5, 9);
    let prev = 1;
    for (let d = 10; d <= 40; d += 0.5) {
      const f = contourFalloff(d, 40);
      expect(f).toBeLessThanOrEqual(prev + 1e-12);
      prev = f;
    }
  });

  it('線の上では線の動きとほぼ一致し、影響幅の外では0', () => {
    // 線の真ん中が上へ 12px ふくらむ動き
    const values = samples.flatMap((_, j) => [0, -12 * Math.sin((Math.PI * j) / (samples.length - 1)) ** 2]);
    const out = spreadAlongLine(samples, samples, values, 2, 40);
    samples.forEach((_, j) => {
      expect(Math.abs(out[j * 2 + 1]! - values[j * 2 + 1]!)).toBeLessThan(12 * 0.005);
    });
    const far = spreadAlongLine([{ x: 150, y: 200 }], samples, values, 2, 40);
    expect(Array.from(far)).toEqual([0, 0]);
    expect(distanceToLine({ x: 150, y: 200 }, samples)).toBeGreaterThan(40);
  });

  it('U 字の線の内側でも、隣り合う点の動きが途切れない', () => {
    // 左右で逆向きに動く U 字。真ん中の縦の線の上で、一番近い位置が左右で入れ替わる
    const u: Vec2[] = [
      { x: -40, y: 0 },
      { x: -40, y: 60 },
      { x: 0, y: 90 },
      { x: 40, y: 60 },
      { x: 40, y: 0 },
    ];
    const s = contourSamples(contourBasis(u), u);
    const values = s.flatMap((p) => [p.x < 0 ? 6 : -6, 0]);
    const column = Array.from({ length: 81 }, (_, i) => ({ x: (i - 40) * 0.05, y: 30 }));
    const out = spreadAlongLine(column, s, values, 2, 80);
    for (let i = 1; i < column.length; i++) expect(Math.abs(out[i * 2]! - out[i * 2 - 2]!)).toBeLessThan(0.2);
  });

  it('三角形が裏返る・潰れる形を見分ける', () => {
    const before = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ];
    const t: [number, number, number][] = [[0, 1, 2]];
    expect(contourShapeValid(t, before, before)).toBe(true);
    expect(contourShapeValid(t, before, [before[0]!, before[1]!, { x: 0, y: -10 }])).toBe(false);
    expect(contourShapeValid(t, before, [before[0]!, before[1]!, { x: 5, y: 0.01 }])).toBe(false);
    expect(contourShapeValid(t, before, [before[0]!, before[1]!, { x: NaN, y: 1 }])).toBe(false);
  });
});

describe('I-068: 線を絵につける', () => {
  it('UV の上で三角形を探し、その姿勢の頂点の位置で表示の位置を出す', () => {
    const mesh = gridMesh(4, 4, 25, { x: 100, y: 200 });
    const a = attachPoint(mesh.uvs, mesh.triangles, { x: 0.3, y: 0.6 })!;
    expect(a.weights.reduce((s, w) => s + w, 0)).toBeCloseTo(1, 12);
    const p = attachedPoint(a, mesh.vertices);
    expect(p.x).toBeCloseTo(130, 9);
    expect(p.y).toBeCloseTo(260, 9);
    // 頂点を平行移動すると、同じだけ動く（[x0, y0, …] の形でも同じ）
    const flat = new Float32Array(mesh.vertices.flatMap((v) => [v.x + 7, v.y - 3]));
    const q = attachedPoint(a, flat);
    expect(q.x).toBeCloseTo(137, 4);
    expect(q.y).toBeCloseTo(257, 4);
    // 外の点は、いちばん近い三角形を外へ延ばした位置
    const out = attachPoint(mesh.uvs, mesh.triangles, { x: 1.1, y: 0.5 })!;
    expect(attachedPoint(out, mesh.vertices).x).toBeCloseTo(210, 9);
  });

  it('メッシュと点の配列が同じなら前の結果を使い、メッシュが変われば作り直す', () => {
    const mesh = gridMesh(4, 4, 25);
    const points = [
      { x: 0.1, y: 0.1 },
      { x: 0.5, y: 0.4 },
      { x: 0.9, y: 0.2 },
    ];
    const first = contourOnMesh(mesh, points, { width: 100, height: 100 })!;
    expect(first.handles).toHaveLength(3);
    expect(first.samples.length).toBeGreaterThan(20);
    expect(contourOnMesh(mesh, points, { width: 100, height: 100 })).toBe(first);
    expect(contourOnMesh({ ...mesh }, points, { width: 100, height: 100 })).not.toBe(first);
    expect(contourOnMesh({ ...mesh, triangles: [] }, points, { width: 100, height: 100 })).toBeNull();
  });
});

describe('I-068: 線が目標に届くように、線のそばの頂点を直す', () => {
  it('線の上に頂点があれば、サンプルの動きが目標と一致する。直せない頂点は prior のまま', () => {
    const mesh = gridMesh(4, 4, 25);
    // x = 50（頂点の列）の縦の線。サンプルは列の上にある
    const points = [
      { x: 0.5, y: 0 },
      { x: 0.5, y: 0.5 },
      { x: 0.5, y: 1 },
    ];
    const on = contourOnMesh(mesh, points, { width: 100, height: 100 })!;
    const target = Float64Array.from(on.samples.flatMap((_, j) => [3 + j * 0.01, 0]));
    const prior = new Float64Array(mesh.vertices.length * 2);
    const out = fitLineMotion(on.samples, target, prior, 2);
    on.samples.forEach((a, j) => {
      const x = a.indices.reduce((s, v, k) => s + a.weights[k]! * out[v * 2]!, 0);
      expect(Math.abs(x - target[j * 2]!)).toBeLessThan(0.05);
    });
    // 直してよい頂点を列の外に限ると、列の頂点は prior のまま
    const column = new Set(mesh.vertices.flatMap((v, i) => (Math.abs(v.x - 50) < 1e-9 ? [i] : [])));
    const kept = fitLineMotion(on.samples, target, prior, 2, (v) => !column.has(v));
    for (const v of column) expect(kept[v * 2]).toBe(0);
  });

  it('prior がすでに目標どおりなら変えない', () => {
    const mesh = gridMesh(4, 4, 25);
    const on = contourOnMesh(
      mesh,
      [
        { x: 0.1, y: 0.1 },
        { x: 0.9, y: 0.7 },
      ],
      { width: 100, height: 100 },
    )!;
    const prior = new Float64Array(mesh.vertices.length).fill(2);
    const target = new Float64Array(on.samples.length).fill(2);
    const out = fitLineMotion(on.samples, target, prior, 1);
    for (let i = 0; i < out.length; i++) expect(out[i]).toBeCloseTo(2, 9);
  });
});
