import type { Mesh, Project, TransformDelta } from '@app/schema';
import { makeAsset, makeBinding, makePart, makeProject } from '../structure/testing';

export function hairProject(): Project {
  const vertices = Array.from({ length: 21 }, (_, r) =>
    [-10, 0, 10].map((x) => ({ x: x + 300, y: r * 10 + 200 })),
  ).flat();
  const triangles: Mesh['triangles'] = [];
  for (let r = 0; r < 20; r++)
    for (let c = 0; c < 2; c++) {
      const a = r * 3 + c;
      triangles.push([a, a + 1, a + 3], [a + 1, a + 4, a + 3]);
    }
  const mesh: Mesh = {
    id: 'm',
    vertices,
    triangles,
    uvs: vertices.map((p) => ({ x: (p.x - 290) / 20, y: (p.y - 200) / 200 })),
    density: 'custom',
    edited: false,
  };
  const delta = (rotation: number): TransformDelta => ({
    position: { x: 0, y: 0 },
    rotation,
    scale: { x: 1, y: 1 },
    opacity: 1,
  });
  return makeProject({
    assets: [makeAsset('a', { width: 20, height: 200, offset: { x: 290, y: 200 } })],
    parts: [
      makePart('head', { kind: 'group', pivot: { x: 300, y: 200 } }),
      makePart('hair', { assetId: 'a', meshId: 'm', parentId: 'head', name: '長い髪' }),
    ],
    meshes: [mesh],
    bindings: [
      makeBinding('head-roll', {
        target: { type: 'part', id: 'head' },
        parameterIds: ['FaceAngleZ'],
        keys: [-30, 0, 30].map((n) => ({ coords: [n], delta: delta(n), source: 'manual', locked: false })),
      }),
    ],
  });
}
