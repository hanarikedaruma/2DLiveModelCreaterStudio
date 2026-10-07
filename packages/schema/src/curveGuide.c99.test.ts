import { describe, expect, it } from 'vitest';
import { createEmptyProject } from './defaults';
import { loadProjectJson, migrate } from './migrate';
import { validateProject } from './validate';
import type { CurveGuide } from './types';

const guide = (): CurveGuide => ({
  id: 'g',
  partId: 'p',
  meshId: 'm',
  meshSignature: '63:80:hash',
  reference: [
    { x: 0, y: 0 },
    { x: 0, y: 100 },
    { x: 0, y: 200 },
  ],
  points: [
    { x: 0, y: 0 },
    { x: 20, y: 100 },
    { x: 0, y: 200 },
  ],
  radius: 40,
  rootFraction: 0.15,
  gravity: true,
  enabled: true,
});

describe('カード99: 流れ線の保存と移行', () => {
  it('3→4では既存のキーと形を保持し、流れ線だけを空にする', () => {
    const p = createEmptyProject('旧版');
    delete p.model.curveGuides;
    p.schemaVersion = 3;
    const before = JSON.stringify(p);
    const next = migrate(p) as typeof p;
    expect(next.schemaVersion).toBe(4);
    expect(next.model.curveGuides).toEqual([]);
    expect({ ...next.model, curveGuides: undefined }).toEqual(p.model);
    expect(JSON.stringify(p)).toBe(before);
  });
  it('編集した3点・根元・幅・重力の設定をJSONの往復で保持する', () => {
    const p = createEmptyProject('髪');
    p.model.curveGuides = [guide()];
    expect(loadProjectJson(JSON.stringify(p)).model.curveGuides).toEqual(p.model.curveGuides);
  });
  it.each([0, -1, Infinity, NaN])('無効な影響幅 %s を拒否する', (radius) => {
    const p = createEmptyProject('髪');
    p.model.curveGuides = [{ ...guide(), radius }];
    expect(() => validateProject(p)).toThrow(/radius/);
  });
  it('根元と毛先の一致、区間の範囲外、同じ対象の2本目を拒否する', () => {
    const p = createEmptyProject('髪');
    const g = guide();
    p.model.curveGuides = [{ ...g, reference: [g.reference[0], g.reference[1], g.reference[0]] }];
    expect(() => validateProject(p)).toThrow(/reference/);
    p.model.curveGuides = [{ ...g, rootFraction: 0.9 }];
    expect(() => validateProject(p)).toThrow(/rootFraction/);
    p.model.curveGuides = [g, { ...g, id: 'other' }];
    expect(() => validateProject(p)).toThrow(/1本まで/);
  });
});
