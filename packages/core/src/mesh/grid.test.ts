import type { Vec2 } from '@app/schema';
import { describe, expect, it } from 'vitest';
import { gridPositions, interiorGridPoints } from './grid';
import { segmentDistanceSq } from './simplify';

const square = (x: number, y: number, s: number): Vec2[] => [
  { x, y },
  { x: x + s, y },
  { x: x + s, y: y + s },
  { x, y: y + s },
];

describe('gridPositions', () => {
  it('間隔で並べ、両端の余りを同じにする', () => {
    expect(gridPositions(200, 48)).toEqual([28, 76, 124, 172]);
    expect(gridPositions(48, 48)).toEqual([24]);
    expect(gridPositions(40, 48)).toEqual([]);
  });
});

describe('interiorGridPoints', () => {
  it('内側で、どの辺からも間隔の半分より離れた格子点だけを返す', () => {
    const outer = square(10, 10, 380);
    const hole = square(150, 150, 100);
    const spacing = 28;
    const points = interiorGridPoints([outer, hole], 400, 400, spacing);
    expect(points.length).toBeGreaterThan(100);
    const xs = gridPositions(400, spacing);
    const ys = gridPositions(400, spacing);
    let expected = 0;
    for (const y of ys) {
      for (const x of xs) {
        const inOuter = x > 10 && x < 390 && y > 10 && y < 390;
        const inHole = x > 150 && x < 250 && y > 150 && y < 250;
        const far = [outer, hole].every((c) =>
          c.every((a, i) => segmentDistanceSq({ x, y }, a, c[(i + 1) % c.length]!) > (spacing / 2) ** 2),
        );
        const want = inOuter && !inHole && far;
        if (want) expected++;
        expect(points.some((p) => p.x === x && p.y === y)).toBe(want);
      }
    }
    expect(points).toHaveLength(expected);
  });

  it('間隔より小さな画像には点を足さない', () => {
    expect(interiorGridPoints([square(0, 0, 20)], 20, 20, 28)).toEqual([]);
  });
});
