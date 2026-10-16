import { describe, expect, it } from 'vitest';
import { createEmptyProject } from './defaults';
import { loadProjectJson, migrate } from './migrate';
import { validateProject } from './validate';
import type { ContourLine } from './types';

const line = (): ContourLine => ({
  id: 'l',
  partId: 'face',
  name: '線 1',
  points: [
    { x: 0.9, y: 0.5 },
    { x: 0.8, y: 0.8 },
    { x: 0.5, y: 0.95 },
  ],
  radius: 48,
  withPartIds: ['lineArt'],
});

describe('I-068: 輪郭線の保存と移行', () => {
  it('6→7 では何も足さず、既存のメッシュ・キーを変えない', () => {
    const p = createEmptyProject('旧版');
    p.schemaVersion = 6;
    const before = JSON.stringify(p);
    const next = migrate(p) as typeof p;
    expect(next.schemaVersion).toBe(11);
    expect(next.model.contourLines).toBeUndefined();
    expect(next.model).toEqual(p.model);
    expect(JSON.stringify(p)).toBe(before);
  });

  it('点・影響幅・一緒に動かすパーツを JSON の往復で保持する', () => {
    const p = createEmptyProject('顔');
    p.model.contourLines = [line(), { ...line(), id: 'l2', name: 'あご 右', withPartIds: [] }];
    expect(loadProjectJson(JSON.stringify(p)).model.contourLines).toEqual(p.model.contourLines);
  });

  it.each([3, 401, NaN, Infinity])('範囲の外の影響幅 %s を拒否する', (radius) => {
    const p = createEmptyProject('顔');
    p.model.contourLines = [{ ...line(), radius }];
    expect(() => validateProject(p)).toThrow(/radius/);
  });

  it('点が1つ・隣の点が同じ・数でない点を拒否する', () => {
    const p = createEmptyProject('顔');
    p.model.contourLines = [{ ...line(), points: [{ x: 0.5, y: 0.5 }] }];
    expect(() => validateProject(p)).toThrow(/points/);
    p.model.contourLines = [{ ...line(), points: [line().points[0]!, line().points[0]!] }];
    expect(() => validateProject(p)).toThrow(/隣の点/);
    p.model.contourLines = [{ ...line(), points: [line().points[0]!, { x: NaN, y: 0 }] }];
    expect(() => validateProject(p)).toThrow(/points/);
  });

  it('一緒に動かすパーツの重複・線を引いたパーツ自身・線の id の重複を拒否する', () => {
    const p = createEmptyProject('顔');
    p.model.contourLines = [{ ...line(), withPartIds: ['a', 'a'] }];
    expect(() => validateProject(p)).toThrow(/重複/);
    p.model.contourLines = [{ ...line(), withPartIds: ['face'] }];
    expect(() => validateProject(p)).toThrow(/線を引いたパーツ/);
    p.model.contourLines = [line(), line()];
    expect(() => validateProject(p)).toThrow(/id が重複/);
  });
});
