// テスト用のモデルの部品（テストからだけ使う）
import {
  createEmptyProject,
  type Binding,
  type Mesh,
  type Model,
  type TransformDelta,
  type Vec2,
  type Warp,
} from '@app/schema';

export function testModel(patch: Partial<Model> = {}): Model {
  return { ...createEmptyProject('t').model, ...patch };
}

export function delta(
  patch: { px?: number; py?: number; rot?: number; sx?: number; sy?: number; op?: number } = {},
): TransformDelta {
  return {
    position: { x: patch.px ?? 0, y: patch.py ?? 0 },
    rotation: patch.rot ?? 0,
    scale: { x: patch.sx ?? 1, y: patch.sy ?? 1 },
    opacity: patch.op ?? 1,
  };
}

export function transformBinding(
  id: string,
  partId: string,
  parameterIds: string[],
  keyValues: number[][],
  keys: [number[], TransformDelta][],
): Binding {
  return {
    id,
    target: { type: 'part', id: partId },
    channel: 'transform',
    parameterIds,
    keyValues,
    keys: keys.map(([coords, d]) => ({ coords, delta: d, source: 'manual', locked: false })),
    generation: 'linear',
    divisions: null,
  };
}

export function pointsBinding(
  id: string,
  target: { type: 'mesh' | 'warp'; id: string },
  parameterIds: string[],
  keyValues: number[][],
  keys: [number[], Vec2[]][],
): Binding {
  return {
    id,
    target,
    channel: target.type === 'mesh' ? 'vertices' : 'warpPoints',
    parameterIds,
    keyValues,
    keys: keys.map(([coords, d]) => ({ coords, delta: d, source: 'manual', locked: false })),
    generation: 'linear',
    divisions: null,
  };
}

// n 個の頂点を横一列に並べたメッシュ（三角形は使わないので空）
export function lineMesh(id: string, n: number): Mesh {
  return {
    id,
    vertices: Array.from({ length: n }, (_, i) => ({ x: i, y: 0 })),
    uvs: Array.from({ length: n }, (_, i) => ({ x: n > 1 ? i / (n - 1) : 0, y: 0 })),
    triangles: [],
    density: 'custom',
    edited: false,
  };
}

export function gridWarp(id: string, partId: string, columns: number, rows: number): Warp {
  const points: Vec2[] = [];
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= columns; i++) points.push({ x: i * 10, y: j * 10 });
  return { id, partId, columns, rows, bounds: { x: 0, y: 0, width: columns * 10, height: rows * 10 }, points };
}

// すべての点を同じ量だけ動かす差分
export function shift(n: number, x: number, y: number): Vec2[] {
  return Array.from({ length: n }, () => ({ x, y }));
}

// 実行時間の中央値（ms）。最初に warmUp 回まわしてから、runs 回 × batch 回を測る
export function medianMs(fn: () => void, { warmUp = 30, runs = 15, batch = 10 } = {}): number {
  for (let i = 0; i < warmUp; i++) fn();
  const samples: number[] = [];
  for (let r = 0; r < runs; r++) {
    const start = performance.now();
    for (let b = 0; b < batch; b++) fn();
    samples.push((performance.now() - start) / batch);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)]!;
}
