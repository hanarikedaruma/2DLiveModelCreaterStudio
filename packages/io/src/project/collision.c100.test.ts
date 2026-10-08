import { describe, expect, it } from 'vitest';
import { createEmptyProject, type CurveGuide, type Part } from '@app/schema';
import { repairProject } from './repair';

describe('肩の参照の読込時修復', () => {
  it('消えた取付先と指定だけを修復し、失効した対応・各スイッチは保持する', () => {
    const p = createEmptyProject('髪');
    p.model.parts = [
      { id: 'hair', kind: 'image', meshId: 'm' },
      { id: 'body', kind: 'image', meshId: 'bodyMesh' },
    ] as Part[];
    p.model.meshes = ['m', 'bodyMesh'].map((id) => ({
      id,
      vertices: [],
      triangles: [],
      uvs: [],
      density: 'custom' as const,
      edited: false,
    }));
    const points: CurveGuide['points'] = [
      { x: 0, y: 0 },
      { x: 0, y: 50 },
      { x: 0, y: 100 },
    ];
    p.model.curveGuides = [
      {
        id: 'g',
        partId: 'hair',
        meshId: 'm',
        meshSignature: 'old',
        reference: points,
        points,
        radius: 50,
        rootFraction: 0.15,
        enabled: true,
        gravity: true,
        dynamics: { enabled: false, preset: 'normal', strength: 0.5, damping: 0.2 },
        collision: { enabled: true, colliderIds: ['s', 'gone', 'missing'], thickness: 1.2 },
      },
    ];
    const collider = {
      id: 's',
      name: '肩',
      partId: 'body',
      meshId: 'bodyMesh',
      meshSignature: 'old',
      points: [
        { x: 0, y: 90 },
        { x: 20, y: 90 },
      ],
      radius: 5,
      enabled: true,
    };
    p.model.shoulderColliders = [collider, { ...collider, id: 'gone', partId: 'missingBody' }];
    const result = repairProject(p);
    expect(result.project.model.shoulderColliders).toEqual([collider]);
    expect(result.project.model.curveGuides![0]!.collision).toEqual({
      enabled: true,
      colliderIds: ['s'],
      thickness: 1.2,
    });
    expect(result.project.model.curveGuides![0]!.dynamics!.enabled).toBe(false);
    expect(result.repairs).toHaveLength(2);
    expect(p.model.shoulderColliders).toHaveLength(2);
    expect(repairProject(result.project).project).toBe(result.project);
  });
});
