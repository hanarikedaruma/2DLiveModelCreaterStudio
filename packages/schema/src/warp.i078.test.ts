import { describe, expect, it } from 'vitest';
import { createEmptyProject } from './defaults';
import { loadProjectJson, migrateWith, MIGRATIONS, ProjectVersionError } from './migrate';
import { validateProject } from './validate';

const project = () => {
  const p = createEmptyProject('warp');
  p.model.warps = [
    {
      id: 'w',
      partId: 'p',
      columns: 1,
      rows: 1,
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 0, y: 100 },
        { x: 100, y: 100 },
      ],
    },
  ];
  return p;
};
describe('向きのあるワープの保存（I-078/I-079）', () => {
  it('7→8では既存格子・キーを変えず、角度の省略をそのまま保つ', () => {
    const p = { ...project(), schemaVersion: 7 },
      loaded = loadProjectJson(JSON.stringify(p));
    expect(loaded.schemaVersion).toBe(12);
    expect(loaded.model.warps).toEqual(p.model.warps);
    expect(Object.hasOwn(loaded.model.warps[0]!, 'angle')).toBe(false);
  });
  it('角度を保存して読み直せ、7の読み込みでは8を拒否する', () => {
    const p = project();
    p.model.warps[0]!.angle = -0.14;
    expect(loadProjectJson(JSON.stringify(p)).model.warps[0]!.angle).toBe(-0.14);
    expect(() => migrateWith(p, MIGRATIONS, 7)).toThrow(ProjectVersionError);
    p.model.warps[0]!.angle = Number.NaN;
    expect(() => validateProject(p)).toThrow();
  });
});
