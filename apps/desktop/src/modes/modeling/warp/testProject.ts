// テスト用のプロジェクトの部品（テストからだけ使う）
import type { Asset, Mesh, Vec2 } from '@app/schema';

export function testAsset(id: string, offset: Vec2, width: number, height: number): Asset {
  return {
    id,
    path: `assets/${id}.png`,
    hash: '0'.repeat(64),
    width,
    height,
    offset,
    canvasSize: { width: 1000, height: 1000 },
    source: { kind: 'png', file: `${id}.png` },
    sourceBlendMode: 'normal',
    sourceOpacity: 1,
  };
}

// 左上 (x, y)、幅 w・高さ h の四角形のメッシュ（頂点は左上から時計回り）
export function rectMesh(id: string, x: number, y: number, w: number, h: number): Mesh {
  return {
    id,
    vertices: [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ],
    uvs: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    triangles: [
      [0, 1, 2],
      [0, 2, 3],
    ],
    density: 'custom',
    edited: false,
  };
}
