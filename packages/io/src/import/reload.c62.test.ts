// カード62（PSD の再読み込みの描き足し・I-034）のテスト。テストの担当は CL（実装の担当は CO）
import { describe, expect, it } from 'vitest';
import { hasOpaquePixelsOutsideMesh } from './reload';

// width×height の画像。opaque の画素（x, y）だけ不透明
function image(width: number, height: number, opaque: [number, number][]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (const [x, y] of opaque) data[(y * width + x) * 4 + 3] = 255;
  return { width, height, data };
}

// キャンバス座標の矩形を2つの三角形で覆うメッシュ
function rectMesh(x: number, y: number, w: number, h: number) {
  return {
    vertices: [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ],
    triangles: [
      [0, 1, 2],
      [0, 2, 3],
    ] as [number, number, number][],
  };
}

describe('カード62: 前のメッシュの外に描き足した画素を見つける', () => {
  it('不透明な画素がすべてメッシュの中なら false', () => {
    const img = image(10, 10, [
      [0, 0],
      [9, 9],
      [5, 5],
    ]);
    expect(hasOpaquePixelsOutsideMesh(img, { x: 100, y: 200 }, rectMesh(100, 200, 10, 10))).toBe(false);
  });

  it('メッシュの外に不透明な画素が1つでもあれば true（右に描き足した）', () => {
    const img = image(10, 10, [
      [2, 2],
      [8, 5],
    ]);
    // メッシュは左半分（x 100〜105）だけを覆う
    expect(hasOpaquePixelsOutsideMesh(img, { x: 100, y: 200 }, rectMesh(100, 200, 5, 10))).toBe(true);
  });

  it('メッシュの外が透明だけなら false', () => {
    const img = image(10, 10, [
      [1, 1],
      [3, 8],
    ]);
    expect(hasOpaquePixelsOutsideMesh(img, { x: 0, y: 0 }, rectMesh(0, 0, 5, 10))).toBe(false);
  });

  it('素材の位置（offset）を考えてキャンバス座標で比べる', () => {
    const img = image(4, 4, [[3, 3]]);
    // 同じ形のメッシュでも、素材の位置からずれていれば外に出る
    expect(hasOpaquePixelsOutsideMesh(img, { x: 50, y: 50 }, rectMesh(50, 50, 4, 4))).toBe(false);
    expect(hasOpaquePixelsOutsideMesh(img, { x: 50, y: 50 }, rectMesh(40, 40, 4, 4))).toBe(true);
  });

  it('三角形がつぶれた（面積 0）メッシュは何も覆わない', () => {
    const img = image(4, 4, [[1, 1]]);
    const flat = {
      vertices: [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 8, y: 0 },
      ],
      triangles: [[0, 1, 2]] as [number, number, number][],
    };
    expect(hasOpaquePixelsOutsideMesh(img, { x: 0, y: 0 }, flat)).toBe(true);
  });
});
