import type { Vec2 } from '@app/schema';
import { describe, expect, it } from 'vitest';
import { findCrossingContours, segmentsTouch } from './intersect';

const p = (x: number, y: number): Vec2 => ({ x, y });
const square = (x: number, y: number, s: number): Vec2[] => [p(x, y), p(x + s, y), p(x + s, y + s), p(x, y + s)];

describe('segmentsTouch', () => {
  it('交わる・端が触れる・一直線で重なるときは真', () => {
    expect(segmentsTouch(p(0, 0), p(4, 4), p(0, 4), p(4, 0))).toBe(true);
    expect(segmentsTouch(p(0, 0), p(4, 0), p(2, 0), p(2, 3))).toBe(true);
    expect(segmentsTouch(p(0, 0), p(4, 0), p(3, 0), p(6, 0))).toBe(true);
  });

  it('離れている・一直線でも重ならないときは偽', () => {
    expect(segmentsTouch(p(0, 0), p(4, 0), p(0, 1), p(4, 1))).toBe(false);
    expect(segmentsTouch(p(0, 0), p(4, 0), p(5, 0), p(8, 0))).toBe(false);
    expect(segmentsTouch(p(0, 0), p(4, 4), p(3, 0), p(9, 0.5))).toBe(false);
  });
});

describe('findCrossingContours', () => {
  it('離れた輪郭・入れ子の輪郭（穴）は問題なし', () => {
    expect(findCrossingContours([square(0, 0, 10), square(20, 0, 10)]).size).toBe(0);
    expect(findCrossingContours([square(0, 0, 30), square(10, 10, 10)]).size).toBe(0);
  });

  it('重なる2つの輪郭は両方を返す', () => {
    expect([...findCrossingContours([square(0, 0, 10), square(50, 50, 5), square(5, 5, 10)])].sort()).toEqual([0, 2]);
  });

  it('点が別の輪郭の辺に触れるのも交わりとみなす', () => {
    const touching = [p(10, 5), p(20, 0), p(20, 10)];
    expect([...findCrossingContours([square(0, 0, 10), touching])].sort()).toEqual([0, 1]);
  });

  it('自分と交わる輪郭（8 の字）と、真後ろに折り返す輪郭を返す', () => {
    const bowTie = [p(0, 0), p(10, 10), p(10, 0), p(0, 10)];
    const folded = [p(0, 0), p(10, 0), p(5, 0)];
    const twoPoints = [p(30, 30), p(40, 30)];
    expect([...findCrossingContours([bowTie, square(100, 100, 5), folded, twoPoints])].sort()).toEqual([0, 2, 3]);
  });

  it('辺の多い輪郭でも、交わる組だけを見つける', () => {
    // 細かい点の円を2つ。少しだけ重ねる
    const circle = (cx: number, r: number) =>
      Array.from({ length: 500 }, (_, i) =>
        p(cx + r * Math.cos((i * 2 * Math.PI) / 500), r * Math.sin((i * 2 * Math.PI) / 500)),
      );
    expect(findCrossingContours([circle(0, 100), circle(250, 100)]).size).toBe(0);
    expect(findCrossingContours([circle(0, 100), circle(199, 100)]).size).toBe(2);
  });
});
