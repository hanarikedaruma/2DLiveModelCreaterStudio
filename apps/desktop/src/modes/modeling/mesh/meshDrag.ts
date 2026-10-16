import type { Mesh, Model, Vec2 } from '@app/schema';
import type { TargetDeltas } from '@app/contracts';
import { pointsToModelSpace, createPointTargetMapper } from '@app/core';
export { createPointTargetMapper } from '@app/core';
export function meshLocalPositions(mesh: Mesh, deltas: TargetDeltas): Vec2[] {
  const delta = Object.hasOwn(deltas.vertices, mesh.id) ? deltas.vertices[mesh.id] : undefined;
  const useDelta = delta !== undefined && delta.length === mesh.vertices.length * 2;
  return mesh.vertices.map((point, i) => ({
    x: point.x + (useDelta ? delta[i * 2]! : 0),
    y: point.y + (useDelta ? delta[i * 2 + 1]! : 0),
  }));
}

export type MeshMove = { index: number; d: Vec2 };

// Seed each solve from the last accepted positions to prefer the local inverse
// of a folded warp. Solve all selected vertices together; failure changes none.
export function createMeshTargetMapper(
  model: Model,
  deltas: TargetDeltas,
  partId: string,
  mesh: Mesh,
  indices: number[],
): (targets: Vec2[]) => MeshMove[] | null {
  const local = meshLocalPositions(mesh, deltas);
  const initial = indices.map((i) => local[i]!);
  const forward = (points: Vec2[]) => pointsToModelSpace(model, deltas, partId, points);
  const solve = createPointTargetMapper(forward, initial);
  return (targets) => {
    const solved = solve(targets);
    return solved
      ? indices.map((index, i) => ({ index, d: { x: solved[i]!.x - initial[i]!.x, y: solved[i]!.y - initial[i]!.y } }))
      : null;
  };
}

// weights（頂点ごとの 0..1）を渡すと、見た目の移動量にその割合を掛ける（「まわりも動かす」。I-068 の D6）
export function createMeshDragMapper(
  model: Model,
  deltas: TargetDeltas,
  partId: string,
  mesh: Mesh,
  indices: number[],
  weights?: readonly number[],
): (delta: Vec2) => MeshMove[] | null {
  const local = meshLocalPositions(mesh, deltas);
  const visible = pointsToModelSpace(
    model,
    deltas,
    partId,
    indices.map((i) => local[i]!),
  );
  const mapper = createMeshTargetMapper(model, deltas, partId, mesh, indices);
  return (delta) =>
    mapper(
      visible.map((p, k) => {
        const w = weights?.[k] ?? 1;
        return { x: p.x + delta.x * w, y: p.y + delta.y * w };
      }),
    );
}
