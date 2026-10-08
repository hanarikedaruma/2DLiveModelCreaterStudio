import { createEmptyProject, standardParametersFor, type Mesh } from '@app/schema';
import { imagePart, groupPart } from '../deform/testParts';
import { transformBinding, delta } from '../eval/testModel';
import { withChestPhysics } from './bounce';
export function chestFixture() {
  const p = createEmptyProject('胸の見本');
  const vertices = Array.from({ length: 9 }, (_, i) => ({ x: (i % 3) * 50, y: Math.floor(i / 3) * 50 }));
  const triangles: Mesh['triangles'] = [];
  for (let y = 0; y < 2; y++)
    for (let x = 0; x < 2; x++) {
      const a = y * 3 + x;
      triangles.push([a, a + 1, a + 3], [a + 1, a + 4, a + 3]);
    }
  const mesh: Mesh = {
    id: 'chest-mesh',
    vertices,
    triangles,
    uvs: vertices.map((v) => ({ x: v.x / 100, y: v.y / 100 })),
    density: 'custom',
    edited: false,
  };
  p.model.parts = [
    groupPart('body'),
    imagePart('torso', { standardType: 'torso', parentId: 'body', meshId: 'torso-mesh' }),
    imagePart('chest', { standardType: 'chest', parentId: 'torso', meshId: mesh.id }),
  ];
  p.model.meshes = [{ ...mesh, id: 'torso-mesh' }, mesh];
  p.model.drawOrder = ['torso', 'chest'];
  p.model.parameters = standardParametersFor('step2').map((v) =>
    v.id === 'BodyAngleZ' ? { ...v, min: -90, max: 90 } : v,
  );
  p.model.bindings = [
    transformBinding(
      'tilt',
      'body',
      ['BodyAngleZ'],
      [[-90, 0, 90]],
      [
        [[-90], delta({ rot: -90 })],
        [[0], delta()],
        [[90], delta({ rot: 90 })],
      ],
    ),
  ];
  return withChestPhysics(p, 'chest', { physics: 'chest-physics', horizontal: 'bx', vertical: 'by' });
}
