// カード30 のテスト用のモデル。顔は FaceAngleX・FaceAngleY の1パラメータのバインディングで動き（transform と頂点）、
// 目は EyeOpenL・EyeSmileL の1パラメータのバインディングで動く（頂点）
import {
  createEmptyProject,
  standardParametersFor,
  type Binding,
  type Mesh,
  type ParameterKey,
  type Part,
  type Project,
  type TransformDelta,
  type Vec2,
} from '@app/schema';

export const td = (x: number, y: number, rotation = 0, sy = 1): TransformDelta => ({
  position: { x, y },
  rotation,
  scale: { x: 1, y: sy },
  opacity: 1,
});

const key = (
  value: number,
  delta: TransformDelta | Vec2[],
  source: ParameterKey['source'] = 'manual',
): ParameterKey => ({
  coords: [value],
  delta,
  source,
  locked: false,
});

const zeros = (n: number): Vec2[] => Array.from({ length: n }, () => ({ x: 0, y: 0 }));

function binding(
  id: string,
  target: Binding['target'],
  channel: Binding['channel'],
  parameterId: string,
  keys: ParameterKey[],
): Binding {
  return {
    id,
    target,
    channel,
    parameterIds: [parameterId],
    keyValues: [keys.map((k) => k.coords[0]!)],
    keys,
    generation: 'linear',
    divisions: null,
  };
}

function part(id: string, meshId: string): Part {
  return {
    id,
    name: id,
    kind: 'image',
    standardType: null,
    assetId: null,
    meshId,
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
  };
}

function mesh(id: string, n: number): Mesh {
  return {
    id,
    vertices: Array.from({ length: n }, (_, i) => ({ x: i * 10, y: 0 })),
    uvs: Array.from({ length: n }, () => ({ x: 0, y: 0 })),
    triangles: [],
    density: 'standard',
    edited: false,
  };
}

export function gridTestProject(): Project {
  const p = createEmptyProject('組み合わせキーのテスト');
  const bindings: Binding[] = [
    binding('b-face-x', { type: 'part', id: 'face' }, 'transform', 'FaceAngleX', [
      key(-30, td(-10, 0, -5)),
      key(0, td(0, 0), 'auto'),
      key(30, td(10, 0, 5)),
    ]),
    binding('b-face-y', { type: 'part', id: 'face' }, 'transform', 'FaceAngleY', [
      key(-30, td(0, 6, 0, 0.9)),
      key(0, td(0, 0), 'auto'),
      key(30, td(0, -6, 0, 1.1)),
    ]),
    binding('b-mesh-x', { type: 'mesh', id: 'm-face' }, 'vertices', 'FaceAngleX', [
      key(-30, [
        { x: -3, y: 0 },
        { x: -2, y: 0 },
        { x: -1, y: 0 },
      ]),
      key(0, zeros(3), 'auto'),
      key(30, [
        { x: 3, y: 0 },
        { x: 2, y: 0 },
        { x: 1, y: 0 },
      ]),
    ]),
    binding('b-mesh-y', { type: 'mesh', id: 'm-face' }, 'vertices', 'FaceAngleY', [
      key(0, zeros(3), 'auto'),
      key(30, [
        { x: 0, y: -2 },
        { x: 0, y: -2 },
        { x: 0, y: -1 },
      ]),
    ]),
    binding('b-eye-open', { type: 'mesh', id: 'm-eye' }, 'vertices', 'EyeOpenL', [
      key(0, [
        { x: 0, y: 5 },
        { x: 0, y: 5 },
      ]),
      key(1, zeros(2), 'auto'),
    ]),
    binding('b-eye-smile', { type: 'mesh', id: 'm-eye' }, 'vertices', 'EyeSmileL', [
      key(0, zeros(2), 'auto'),
      key(1, [
        { x: 1, y: -1 },
        { x: -1, y: -1 },
      ]),
    ]),
  ];
  return {
    ...p,
    model: {
      ...p.model,
      parameters: standardParametersFor('step1').map((x) => ({ ...x })),
      parts: [part('face', 'm-face'), part('eye', 'm-eye')],
      meshes: [mesh('m-face', 3), mesh('m-eye', 2)],
      drawOrder: ['face', 'eye'],
      bindings,
    },
  };
}
