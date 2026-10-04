// テスト用のプロジェクトを組み立てる道具（カード17・20のテストで使う）
import { createEmptyProject } from '@app/schema';
import type { Asset, Binding, Mesh, Model, Part, Project } from '@app/schema';
import { basePart } from './modelOps';

export function makeAsset(id: string, fields: Partial<Asset> = {}): Asset {
  return {
    id,
    path: `assets/${id}.png`,
    hash: '0'.repeat(64),
    width: 100,
    height: 50,
    offset: { x: 0, y: 0 },
    canvasSize: { width: 1000, height: 1000 },
    source: { kind: 'png', file: `${id}.png` },
    sourceBlendMode: 'normal',
    sourceOpacity: 1,
    ...fields,
  };
}

export function makePart(id: string, fields: Partial<Part> = {}): Part {
  return basePart({ id, name: id, kind: 'image', ...fields });
}

export function makeMesh(id: string, fields: Partial<Mesh> = {}): Mesh {
  return {
    id,
    vertices: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ],
    uvs: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ],
    triangles: [[0, 1, 2]],
    density: 'standard',
    edited: false,
    ...fields,
  };
}

export function makeBinding(id: string, fields: Partial<Binding> = {}): Binding {
  return {
    id,
    target: { type: 'part', id: 'p' },
    channel: 'transform',
    parameterIds: ['FaceAngleX'],
    keyValues: [[-30, 0, 30]],
    keys: [],
    generation: 'linear',
    divisions: null,
    ...fields,
  };
}

// drawOrder を省略すると、画像パーツを parts の順に並べる
export function makeProject(
  fields: { assets?: Asset[]; parts?: Part[] } & Partial<Omit<Model, 'parts'>> & Partial<Pick<Project, 'physics'>> = {},
): Project {
  const base = createEmptyProject('テスト');
  const { assets = [], parts = [], physics = [], ...model } = fields;
  return {
    ...base,
    assets,
    physics,
    model: {
      ...base.model,
      parts,
      drawOrder: model.drawOrder ?? parts.filter((p) => p.kind === 'image').map((p) => p.id),
      ...model,
    },
  };
}

// 'id1', 'id2', … を順に返す
export function counterIds(prefix = 'new'): () => string {
  let n = 0;
  return () => `${prefix}${++n}`;
}
