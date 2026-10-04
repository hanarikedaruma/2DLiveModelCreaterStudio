import type { Vec2 } from '@app/schema';
import { describe, expect, it } from 'vitest';
import { fillImageCorners, removeCollinear, traceContours } from './contour';
import type { BinaryMask } from './mask';

// 文字の図（# が 1）から 0/1 の配列を作る
function maskOf(rows: string[]): BinaryMask {
  const width = rows[0]!.length;
  const height = rows.length;
  const stride = (width + 3) & ~3;
  const data = new Uint8Array(height * stride);
  rows.forEach((row, y) => [...row].forEach((c, x) => (data[y * stride + x] = c === '#' ? 1 : 0)));
  return { data, width, height, stride };
}

const key = (p: Vec2) => `${p.x},${p.y}`;
const keys = (points: Vec2[]) => points.map(key).sort();

// 符号付き面積（y 下向きの座標の式のまま）
function signedArea(points: Vec2[]): number {
  let s = 0;
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length]!;
    s += p.x * q.y - q.x * p.y;
  });
  return s / 2;
}

// 点が多角形（偶奇）の内側か
function inside(contours: Vec2[][], x: number, y: number): boolean {
  let odd = false;
  for (const c of contours) {
    c.forEach((a, i) => {
      const b = c[(i + 1) % c.length]!;
      if (a.y <= y !== b.y <= y && x < a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y)) odd = !odd;
    });
  }
  return odd;
}

describe('traceContours', () => {
  it('1 ピクセルのまわりは、辺の中点を結ぶひし形になる', () => {
    const [contour, ...rest] = traceContours(maskOf(['...', '.#.', '...']));
    expect(rest).toHaveLength(0);
    expect(keys(contour!)).toEqual(
      keys([
        { x: 1.5, y: 1 },
        { x: 2, y: 1.5 },
        { x: 1.5, y: 2 },
        { x: 1, y: 1.5 },
      ]),
    );
  });

  it('真っすぐ続く移動は1本の辺にまとめる（4×4 の四角は角を切った八角形）', () => {
    const [contour] = traceContours(maskOf(['......', '.####.', '.####.', '.####.', '.####.', '......']));
    const simplified = removeCollinear(contour!);
    expect(simplified).toHaveLength(8);
    expect(Math.abs(signedArea(simplified))).toBe(16 - 0.5);
  });

  it('穴は別の輪郭になり、外側と逆向きに回る', () => {
    const contours = traceContours(maskOf(['#####', '#####', '##.##', '#####', '#####']));
    expect(contours).toHaveLength(2);
    const areas = contours.map((c) => signedArea(c));
    expect(Math.sign(areas[0]!)).toBe(-Math.sign(areas[1]!));
  });

  it('斜めに接するピクセルは別々の輪郭にする（4 連結）', () => {
    expect(traceContours(maskOf(['#.', '.#']))).toHaveLength(2);
    expect(traceContours(maskOf(['.#', '#.']))).toHaveLength(2);
  });

  it('点は 0..width × 0..height に収まり、輪郭どうしで重ならず、すべてのピクセルの内外が合う', () => {
    const rows = ['##..#.##', '#..##..#', '.#.#.#..', '####.###', '#.#..#.#', '..###...'];
    const mask = maskOf(rows);
    const contours = traceContours(mask);
    const all = contours.flat();
    expect(new Set(all.map(key)).size).toBe(all.length);
    for (const p of all) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(mask.width);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(mask.height);
    }
    rows.forEach((row, y) => [...row].forEach((c, x) => expect(inside(contours, x + 0.5, y + 0.5)).toBe(c === '#')));
  });
});

describe('fillImageCorners', () => {
  it('画像の角のピクセルが内側なら、切った角を画像の角の点で埋める', () => {
    const [contour] = traceContours(maskOf(['#']));
    const filled = removeCollinear(fillImageCorners(contour!, 1, 1));
    expect(keys(filled)).toEqual(['0,0', '0,1', '1,0', '1,1']);
  });

  it('すべて内側なら画像の四角形になる', () => {
    const [contour] = traceContours(maskOf(['####', '####', '####']));
    const filled = removeCollinear(fillImageCorners(contour!, 4, 3));
    expect(keys(filled)).toEqual(['0,0', '0,3', '4,0', '4,3']);
  });

  it('角に触れない輪郭は変えない', () => {
    const [contour] = traceContours(maskOf(['...', '.#.', '...']));
    expect(fillImageCorners(contour!, 3, 3)).toEqual(contour);
  });
});

describe('removeCollinear', () => {
  it('一直線の途中の点を、始点・終点のつなぎ目も含めて除く', () => {
    const square = [
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
      { x: 2, y: 2 },
      { x: 1, y: 2 },
      { x: 0, y: 2 },
      { x: 0, y: 1 },
      { x: 0, y: 0 },
    ];
    expect(keys(removeCollinear(square))).toEqual(['0,0', '0,2', '2,0', '2,2']);
  });
});
