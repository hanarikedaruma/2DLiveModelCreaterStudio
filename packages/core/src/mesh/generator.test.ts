import type { Vec2 } from '@app/schema';
import { FakeMeshGenerator } from '@app/contracts';
import { describe, expect, it } from 'vitest';
import { MESH_DENSITY_SETTINGS, createMeshGenerator, generateMesh } from './generator';
import {
  countCoverage,
  disc,
  makeAlpha,
  makeSoftDisc,
  minus,
  opaqueCoverage,
  rect,
  union,
  type Shape,
} from './testImages';

const DENSITIES = ['light', 'standard', 'smooth'] as const;
const OFFSET: Vec2 = { x: 120, y: -35 };

// 完了条件を調べる画像
const cases: { name: string; image: ImageData }[] = [
  { name: '円', image: makeAlpha(300, 260, disc(150, 130, 110)) },
  { name: '縁がなめらかな円', image: makeSoftDisc(240, 240, 120, 120, 100) },
  { name: '穴のある輪', image: makeAlpha(300, 300, minus(disc(150, 150, 140), disc(150, 150, 60))) },
  {
    name: '離れた島（穴の中の島も）',
    image: makeAlpha(
      400,
      300,
      union(
        minus(disc(110, 150, 100), disc(110, 150, 55)),
        disc(110, 150, 20),
        rect(260, 40, 380, 120),
        disc(320, 230, 50),
      ),
    ),
  },
  // トリミングした素材のように、不透明部分が画像の4辺に触れる
  { name: '画像の縁に触れる形', image: makeAlpha(220, 180, union(disc(110, 90, 100), rect(0, 60, 220, 120))) },
  { name: '細い線（1px）', image: makeAlpha(260, 200, (x, y) => Math.abs(y - 100 - 60 * Math.sin(x / 30)) < 0.5) },
  {
    name: 'ぎざぎざの輪郭',
    image: makeAlpha(300, 300, (x, y) => {
      const a = Math.atan2(y - 150, x - 150);
      return Math.hypot(x - 150, y - 150) < 110 + 25 * Math.sin(9 * a) + 8 * Math.sin(37 * a);
    }),
  },
  { name: '散らばった点', image: makeAlpha(200, 200, (x, y) => (Math.floor(x) * 7 + Math.floor(y) * 13) % 97 === 0) },
];

function triangleArea(vertices: Vec2[], [i, j, k]: [number, number, number]): number {
  const a = vertices[i]!;
  const b = vertices[j]!;
  const c = vertices[k]!;
  return ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
}

describe('createMeshGenerator', () => {
  it('不透明なピクセルが無い画像は、画像全体の四角形を返す', () => {
    const image = makeAlpha(50, 30, () => false);
    // alpha 7 は不透明に数えない
    image.data[3] = 7;
    const mesh = createMeshGenerator().generate(image, OFFSET, 'standard');
    expect(mesh).toEqual(new FakeMeshGenerator().generate(image, OFFSET, 'standard'));
  });

  it('すべて不透明な画像は、画像全体の四角形（四隅を含む）を覆う', () => {
    const image = makeAlpha(64, 40, () => true);
    // 辺が間隔より短い light は、四隅だけの四角形になる
    const light = generateMesh(image, OFFSET, 'light');
    expect(light.uvs.map((uv) => `${uv.x},${uv.y}`).sort()).toEqual(['0,0', '0,1', '1,0', '1,1']);
    expect(light.triangles).toHaveLength(2);
    for (const density of DENSITIES) {
      const mesh = generateMesh(image, OFFSET, density);
      const keys = new Set(mesh.uvs.map((uv) => `${uv.x},${uv.y}`));
      for (const corner of ['0,0', '0,1', '1,0', '1,1']) expect(keys.has(corner)).toBe(true);
      const area = mesh.triangles.reduce((sum, t) => sum + triangleArea(mesh.vertices, t), 0);
      expect(area).toBeCloseTo(64 * 40, 6);
    }
  });

  it('1px の不透明なピクセルだけでもそのピクセルを覆う', () => {
    const image = makeAlpha(1, 1, () => true);
    const mesh = generateMesh(image, { x: 0, y: 0 }, 'light');
    expect(opaqueCoverage(mesh, image, { x: 0, y: 0 }).ratio).toBe(1);
  });

  it('頂点はキャンバス座標（画像の中の位置 + offset）、uvs は画像の中の位置 ÷ 画像サイズ', () => {
    const image = cases[2]!.image;
    const mesh = generateMesh(image, OFFSET, 'standard');
    expect(mesh.uvs).toHaveLength(mesh.vertices.length);
    mesh.vertices.forEach((v, i) => {
      const uv = mesh.uvs[i]!;
      expect(uv.x * image.width + OFFSET.x).toBeCloseTo(v.x, 9);
      expect(uv.y * image.height + OFFSET.y).toBeCloseTo(v.y, 9);
    });
  });

  for (const { name, image } of cases) {
    describe(name, () => {
      for (const density of DENSITIES) {
        it(`${density}: 不透明なピクセルの 99% 以上が三角形に入り、uvs は 0..1、三角形は重ならない`, () => {
          const mesh = generateMesh(image, OFFSET, density);
          const { ratio } = opaqueCoverage(mesh, image, OFFSET);
          expect(ratio).toBeGreaterThanOrEqual(0.99);
          // 外へ広げてから単純化するので、実際はすべて入る
          expect(ratio).toBe(1);

          for (const uv of mesh.uvs) {
            expect(uv.x).toBeGreaterThanOrEqual(0);
            expect(uv.x).toBeLessThanOrEqual(1);
            expect(uv.y).toBeGreaterThanOrEqual(0);
            expect(uv.y).toBeLessThanOrEqual(1);
          }

          // 向きがそろい、面積0が無く、すべての頂点が使われる
          const used = new Set<number>();
          for (const t of mesh.triangles) {
            expect(triangleArea(mesh.vertices, t)).toBeGreaterThan(0);
            t.forEach((i) => used.add(i));
          }
          expect(used.size).toBe(mesh.vertices.length);

          // 辺に乗らない位置の点で数えて、2枚以上の三角形に入る点が無い
          const counts = countCoverage(mesh, image.width, image.height, OFFSET, 0.50123, 0.49871, true);
          expect(counts.every((c) => c <= 1)).toBe(true);

          // 不透明なピクセルは四隅まで三角形に入る（描くときに縁が欠けない）
          const w = image.width;
          const corners = countCoverage(mesh, w + 1, image.height + 1, OFFSET, 0, 0);
          let missing = 0;
          for (let y = 0; y < image.height; y++) {
            for (let x = 0; x < w; x++) {
              if ((image.data[(y * w + x) * 4 + 3] ?? 0) < 8) continue;
              for (const i of [
                y * (w + 1) + x,
                y * (w + 1) + x + 1,
                (y + 1) * (w + 1) + x,
                (y + 1) * (w + 1) + x + 1,
              ]) {
                if (!corners[i]) missing++;
              }
            }
          }
          expect(missing).toBe(0);
        });
      }

      it('light < standard < smooth の順に頂点が増える（散らばった点の画像以外）', () => {
        if (name === '散らばった点') return;
        const counts = DENSITIES.map((d) => generateMesh(image, OFFSET, d).vertices.length);
        expect(counts[0]).toBeLessThan(counts[1]!);
        expect(counts[1]).toBeLessThan(counts[2]!);
      });
    });
  }

  it('穴は三角形で覆わない（穴の中の島は覆う）', () => {
    // 半径 70 の穴の中に、半径 20 の島がある
    const shape: Shape = union(minus(disc(150, 150, 140), disc(150, 150, 70)), disc(150, 150, 20));
    const image = makeAlpha(300, 300, shape);
    for (const density of DENSITIES) {
      const mesh = generateMesh(image, OFFSET, density);
      const counts = countCoverage(mesh, 300, 300, OFFSET, 0.5, 0.5);
      const { margin, tolerance } = MESH_DENSITY_SETTINGS[density];
      // 広げるのは正方形なので、斜めには margin×√2 まで広がる
      const slack = margin * Math.SQRT2 + tolerance + 1;
      let checked = 0;
      for (let y = 0; y < 300; y++) {
        for (let x = 0; x < 300; x++) {
          const r = Math.hypot(x + 0.5 - 150, y + 0.5 - 150);
          // 広げる幅と許容誤差を引いても穴の中に残る所
          if (r > 20 + slack && r < 70 - slack) {
            expect(counts[y * 300 + x]).toBe(0);
            checked++;
          }
          // 辺の上の点は2枚に数えるので、1 以上で見る
          if (r <= 20) expect(counts[y * 300 + x]).toBeGreaterThan(0);
        }
      }
      expect(checked).toBeGreaterThan(1000);
    }
  });

  it('離れた島はそれぞれ覆い、島のあいだは覆わない', () => {
    const image = makeAlpha(400, 200, union(disc(80, 100, 60), disc(320, 100, 60), disc(200, 30, 12)));
    for (const density of DENSITIES) {
      const mesh = generateMesh(image, OFFSET, density);
      const counts = countCoverage(mesh, 400, 200, OFFSET, 0.5, 0.5);
      const at = (x: number, y: number) => counts[y * 400 + x];
      expect(at(80, 100)).toBeGreaterThan(0);
      expect(at(320, 100)).toBeGreaterThan(0);
      expect(at(200, 30)).toBeGreaterThan(0);
      // 島のあいだ
      expect(at(200, 100)).toBe(0);
      expect(at(200, 170)).toBe(0);
    }
  });

  it('2000×2000px の画像で 200ms 未満（中央値）', () => {
    const size = 2000;
    const a = (x: number, y: number) => Math.atan2(y - 1000, x - 1000);
    const shape = union(
      minus(
        (x, y) => Math.hypot(x - 1000, y - 1000) < 880 + 40 * Math.sin(7 * a(x, y)),
        disc(700, 800, 120),
        disc(1300, 800, 120),
        rect(800, 1250, 1200, 1350),
      ),
      disc(150, 150, 100),
      disc(1850, 150, 100),
      disc(1850, 1850, 100),
    );
    const image = makeAlpha(size, size, shape);
    const generator = createMeshGenerator();
    for (const density of DENSITIES) {
      // 最初の数回は JIT の準備。ほかの処理と重なってぶれるので、7 回の中央値で見る
      for (let i = 0; i < 2; i++) generator.generate(image, OFFSET, density);
      const times: number[] = [];
      for (let i = 0; i < 7; i++) {
        const t0 = performance.now();
        generator.generate(image, OFFSET, density);
        times.push(performance.now() - t0);
      }
      times.sort((p, q) => p - q);
      expect(times[3]).toBeLessThan(200);
    }
  }, 60_000);
});
