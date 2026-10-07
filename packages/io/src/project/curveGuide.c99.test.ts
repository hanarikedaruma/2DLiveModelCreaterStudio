import { describe, expect, it } from 'vitest';
import { createEmptyProject, type CurveGuide, type Part } from '@app/schema';
import { repairProject } from './repair';

describe('カード99: 読込時の流れ線の参照', () => {
  it('対象のない線だけを外し、対応の失効は描き直しのため保持する', () => {
    const project = createEmptyProject('髪');
    project.model.parts = [{ id: 'p', kind: 'image', meshId: 'm' } as Part];
    project.model.meshes = [{ id: 'm', vertices: [], triangles: [], uvs: [], density: 'custom', edited: false }];
    const guide: CurveGuide = {
      id: 'g',
      partId: 'p',
      meshId: 'm',
      meshSignature: 'old',
      reference: [
        { x: 0, y: 0 },
        { x: 0, y: 10 },
        { x: 0, y: 20 },
      ],
      points: [
        { x: 0, y: 0 },
        { x: 0, y: 10 },
        { x: 0, y: 20 },
      ],
      radius: 10,
      rootFraction: 0.15,
      gravity: true,
      enabled: true,
    };
    project.model.curveGuides = [
      guide,
      { ...guide, id: 'missing-part', partId: 'missing' },
      { ...guide, id: 'missing-mesh', meshId: 'missing' },
    ];
    const result = repairProject(project);
    expect(result.project.model.curveGuides).toEqual([guide]);
    expect(result.repairs).toEqual(['対象が無い流れ線 2 本を外した']);
    expect(project.model.curveGuides).toHaveLength(3);
    expect(repairProject(result.project).project).toBe(result.project);
  });
});
