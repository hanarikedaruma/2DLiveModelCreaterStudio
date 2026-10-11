import { describe, expect, it } from 'vitest';
import { RANGE_MARGIN, nearPolygon, nearRect, nearTriangles } from './targetRange';

describe('I-069: 操作範囲と余白の判定', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];

  it('多角形: 中・縁から余白以内は範囲、それより外は範囲の外。回した四角でも同じ', () => {
    expect(RANGE_MARGIN).toBe(24);
    expect(nearPolygon(square, { x: 50, y: 50 })).toBe(true);
    expect(nearPolygon(square, { x: 120, y: 50 })).toBe(true);
    expect(nearPolygon(square, { x: 124, y: 50 })).toBe(true);
    expect(nearPolygon(square, { x: 125, y: 50 })).toBe(false);
    expect(nearPolygon(square, { x: 116, y: 116 })).toBe(true); // 角から約 22.6px
    expect(nearPolygon(square, { x: 118, y: 118 })).toBe(false); // 角から約 25.5px
    const diamond = [
      { x: 50, y: 0 },
      { x: 100, y: 50 },
      { x: 50, y: 100 },
      { x: 0, y: 50 },
    ];
    expect(nearPolygon(diamond, { x: 50, y: 50 })).toBe(true);
    expect(nearPolygon(diamond, { x: 95, y: 95 })).toBe(false);
    expect(nearPolygon(diamond, { x: 85, y: 85 })).toBe(true);
    expect(nearPolygon([], { x: 0, y: 0 })).toBe(false);
  });

  it('三角形の集まり: 中・どれかの三角形の縁から余白以内', () => {
    const tris: [number, number, number][] = [
      [0, 1, 2],
      [0, 2, 3],
    ];
    expect(nearTriangles(square, tris, { x: 10, y: 90 })).toBe(true);
    expect(nearTriangles(square, tris, { x: -20, y: 50 })).toBe(true);
    expect(nearTriangles(square, tris, { x: -30, y: 50 })).toBe(false);
    expect(nearTriangles(square, tris, { x: 50, y: 150 }, 60)).toBe(true);
  });

  it('矩形と余白', () => {
    expect(nearRect({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 34, y: 5 })).toBe(true);
    expect(nearRect({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 35, y: 5 })).toBe(false);
  });
});
