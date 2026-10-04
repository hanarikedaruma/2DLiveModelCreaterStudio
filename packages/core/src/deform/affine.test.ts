import { describe, expect, it } from 'vitest';
import { IDENTITY, applyAffine, isIdentity, multiplyAffine, partAffine, transformVec } from './affine';

const base = { position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 }, pivot: { x: 0, y: 0 } };

describe('partAffine', () => {
  it('pivot を中心に拡縮・回転し、position だけ動かす（時計回りが正）', () => {
    const m = partAffine(
      { position: { x: 5, y: 0 }, rotation: 90, scale: { x: 2, y: 2 }, pivot: { x: 10, y: 10 } },
      undefined,
    );
    // pivot から右に 1 の点 → 2 倍で右に 2 → 時計回りに 90 度で下に 2 → x を 5 動かす
    const p = transformVec(m, { x: 11, y: 10 });
    expect(p.x).toBeCloseTo(15);
    expect(p.y).toBeCloseTo(12);
  });

  it('差分は position・rotation に足し、scale に掛ける', () => {
    const part = { position: { x: 1, y: 2 }, rotation: 30, scale: { x: 2, y: 3 }, pivot: { x: 4, y: 4 } };
    const withDelta = partAffine(part, {
      position: { x: 10, y: -2 },
      rotation: 60,
      scale: { x: 0.5, y: 2 },
      opacity: 0.1,
    });
    const direct = partAffine({ ...part, position: { x: 11, y: 0 }, rotation: 90, scale: { x: 1, y: 6 } }, undefined);
    for (const k of ['a', 'b', 'c', 'd', 'e', 'f'] as const) expect(withDelta[k]).toBeCloseTo(direct[k], 10);
  });

  it('変化なしなら単位行列', () => {
    expect(isIdentity(partAffine({ ...base, pivot: { x: 30, y: 40 } }, undefined))).toBe(true);
    expect(isIdentity(partAffine({ ...base, rotation: 1 }, undefined))).toBe(false);
  });
});

describe('multiplyAffine と applyAffine', () => {
  it('合成は inner を先に、outer を後に掛けたのと同じ', () => {
    const inner = partAffine({ ...base, rotation: 37, scale: { x: 1.5, y: 0.5 }, pivot: { x: 3, y: -2 } }, undefined);
    const outer = partAffine({ ...base, position: { x: 7, y: 1 }, rotation: -120, pivot: { x: 10, y: 5 } }, undefined);
    const p = { x: 4.5, y: -8 };
    const stepwise = transformVec(outer, transformVec(inner, p));
    const combined = transformVec(multiplyAffine(outer, inner), p);
    expect(combined.x).toBeCloseTo(stepwise.x, 10);
    expect(combined.y).toBeCloseTo(stepwise.y, 10);
    expect(multiplyAffine(IDENTITY, inner)).toEqual(inner);
  });

  it('applyAffine は [x0, y0, x1, y1, ...] をその場で動かす', () => {
    const points = new Float32Array([1, 0, 0, 1]);
    applyAffine(points, partAffine({ ...base, rotation: 90, position: { x: 10, y: 0 } }, undefined));
    expect(points[0]).toBeCloseTo(10);
    expect(points[1]).toBeCloseTo(1);
    expect(points[2]).toBeCloseTo(9);
    expect(points[3]).toBeCloseTo(0);
  });
});
