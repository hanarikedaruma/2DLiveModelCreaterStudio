import { describe, expect, it } from 'vitest';
import { createEmptyProject } from './defaults';
import { loadProjectJson } from './migrate';
import { validateProject } from './validate';
import type { CurveGuide } from './types';

function project() {
  const p = createEmptyProject('流れ揺れ');
  const points: CurveGuide['points'] = [
    { x: 0, y: 0 },
    { x: 0, y: 50 },
    { x: 0, y: 100 },
  ];
  p.model.curveGuides = [
    {
      id: 'g',
      partId: 'p',
      meshId: 'm',
      meshSignature: 'signature',
      reference: points,
      points,
      radius: 20,
      rootFraction: 0.15,
      gravity: true,
      enabled: true,
    },
  ];
  return p;
}
describe('流れ揺れの保存', () => {
  it('4→5で線だけの旧データを揺らさず、キー・物理の保存済み状態を保持する', () => {
    const p = project();
    p.schemaVersion = 4;
    const next = loadProjectJson(JSON.stringify(p));
    expect(next.schemaVersion).toBe(7);
    expect(next.model).toEqual(p.model);
    expect(next.physics).toEqual(p.physics);
    expect(next.model.curveGuides![0]!.dynamics).toBeUndefined();
  });
  it.each([true, false])('対象ごとのenabled=%sと調整を往復し、速度/節点などの実行時状態は保存しない', (enabled) => {
    const p = project();
    p.model.curveGuides![0]!.dynamics = { enabled, preset: 'soft', strength: 0.7, damping: 0.4 };
    const next = loadProjectJson(JSON.stringify(p));
    expect(next).toEqual(p);
    expect(JSON.stringify(next)).not.toMatch(/velocity|simNow|frameId/);
  });
  it.each([-1, 2, NaN, Infinity])('範囲外/非有限の強さ/減衰 %s を拒否する', (value) => {
    for (const key of ['strength', 'damping'] as const) {
      const p = project();
      p.model.curveGuides![0]!.dynamics = {
        enabled: true,
        preset: 'normal',
        strength: 0.5,
        damping: 0.2,
        [key]: value,
      };
      expect(() => validateProject(p)).toThrow(/dynamics/);
    }
  });
  it('肩の保存は揺れのスイッチと独立し、旧版では衝突もOFF', () => {
    const p = project();
    expect(loadProjectJson(JSON.stringify(p)).model.curveGuides![0]!.collision).toBeUndefined();
    p.model.shoulderColliders = [
      {
        id: 's',
        name: '左肩',
        partId: 'body',
        meshId: 'bodyMesh',
        meshSignature: 'sig',
        points: [
          { x: 0, y: 1 },
          { x: 20, y: 1 },
        ],
        radius: 5,
        enabled: true,
      },
    ];
    p.model.curveGuides![0]!.collision = { enabled: true, colliderIds: ['s'], thickness: 1.2 };
    expect(loadProjectJson(JSON.stringify(p))).toEqual(p);
    for (const points of [
      [],
      [{ x: 0, y: 0 }],
      [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
      ],
      Array.from({ length: 9 }, (_, i) => ({ x: i, y: 0 })),
    ]) {
      expect(() =>
        validateProject({
          ...p,
          model: { ...p.model, shoulderColliders: [{ ...p.model.shoulderColliders![0]!, points }] },
        }),
      ).toThrow();
    }
    for (const thickness of [0, 3, NaN])
      expect(() =>
        validateProject({
          ...p,
          model: {
            ...p.model,
            curveGuides: [{ ...p.model.curveGuides![0]!, collision: { enabled: true, colliderIds: ['s'], thickness } }],
          },
        }),
      ).toThrow();
  });
});
