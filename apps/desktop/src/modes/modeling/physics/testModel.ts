// テスト用のモデルの部品（テストからだけ使う）
import { createEmptyProject, type Mesh, type Part, type Project, type Vec2 } from '@app/schema';
import { testAsset } from '../warp/testProject';

// 根元 (100, 0) から下へ垂れる 40×200 の帯（左右2列 × 5段の頂点）。頂点の番号は段ごとに 左・右
export const STRIP_PIVOT: Vec2 = { x: 100, y: 0 };
export const STRIP_ROWS = [0, 50, 100, 150, 200];

export function stripMesh(id = 'mesh-hair'): Mesh {
  const vertices: Vec2[] = STRIP_ROWS.flatMap((y) => [
    { x: 80, y },
    { x: 120, y },
  ]);
  const triangles: [number, number, number][] = [];
  for (let r = 0; r + 1 < STRIP_ROWS.length; r++) {
    const a = r * 2;
    triangles.push([a, a + 1, a + 3], [a, a + 3, a + 2]);
  }
  return {
    id,
    vertices,
    uvs: vertices.map((v) => ({ x: (v.x - 80) / 40, y: v.y / 200 })),
    triangles,
    density: 'custom',
    edited: false,
  };
}

export function testPart(id: string, patch: Partial<Part> = {}): Part {
  return {
    id,
    name: id,
    kind: 'image',
    standardType: null,
    assetId: null,
    meshId: null,
    parentId: null,
    position: { x: 0, y: 0 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    pivot: { x: 0, y: 0 },
    opacity: 1,
    blendMode: 'normal',
    depth: 0,
    mask: null,
    physicsId: null,
    visible: true,
    locked: false,
    ...patch,
  };
}

// 帯の画像パーツ hair（メッシュ付き）、メッシュの無い画像パーツ plain、hair と plain をまとめたグループ g、
// 標準の前髪 front・横髪 side・後ろ髪 back（素材だけ）
export function physicsProject(): Project {
  const p = createEmptyProject('物理のテスト');
  return {
    ...p,
    assets: [
      testAsset('asset-hair', { x: 80, y: 0 }, 40, 200),
      testAsset('asset-plain', { x: 300, y: 100 }, 60, 120),
      testAsset('asset-front', { x: 400, y: 50 }, 200, 80),
    ],
    model: {
      ...p.model,
      parts: [
        testPart('g', { kind: 'group', name: 'まとめ', pivot: { x: 100, y: 0 } }),
        testPart('hair', {
          name: 'しっぽ',
          assetId: 'asset-hair',
          meshId: 'mesh-hair',
          parentId: 'g',
          pivot: STRIP_PIVOT,
        }),
        testPart('plain', { name: 'リボン', assetId: 'asset-plain', parentId: 'g', pivot: { x: 330, y: 100 } }),
        testPart('front', {
          name: '前髪',
          standardType: 'frontHair',
          assetId: 'asset-front',
          pivot: { x: 500, y: 50 },
        }),
        testPart('side', { name: '横髪 L', standardType: 'sideHairL', assetId: 'asset-front' }),
        testPart('back', { name: '後ろ髪', standardType: 'backHair', assetId: 'asset-front' }),
      ],
      meshes: [stripMesh()],
      drawOrder: ['hair', 'plain', 'front', 'side', 'back'],
    },
  };
}
