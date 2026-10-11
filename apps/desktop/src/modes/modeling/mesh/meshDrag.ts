import type { Mesh, Model, Vec2 } from '@app/schema';
import type { TargetDeltas } from '@app/contracts';
import { pointsToModelSpace } from '@app/core';
import { applyLinear, distance, invert } from '../canvas/geometry';

const TOLERANCE = 1e-6;
const ITERATIONS = 16;
const LINE_SEARCH_STEPS = 10;

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

export function createPointTargetMapper(
  forward: (points: Vec2[]) => Vec2[],
  initial: Vec2[],
): (targets: Vec2[]) => Vec2[] | null {
  const visible = forward(initial);
  const h = initial.reduce((extent, p) => Math.max(extent, Math.abs(p.x), Math.abs(p.y)), 1) * 1e-6;
  let previous = initial;

  const solve = (targets: Vec2[]): Vec2[] | null => {
    const guesses = previous.map((p) => ({ ...p }));
    for (let iteration = 0; iteration <= ITERATIONS; iteration++) {
      const mapped = forward(guesses);
      const errors = mapped.map((p, i) => distance(p, targets[i]!));
      if (errors.every((error) => error <= TOLERANCE)) return guesses;
      if (iteration === ITERATIONS || errors.some((error) => !Number.isFinite(error))) return null;

      const active = errors.flatMap((error, i) => (error > TOLERANCE ? [i] : []));
      const probes = forward(
        active.flatMap((i) => {
          const p = guesses[i]!;
          return [
            { x: p.x + h, y: p.y },
            { x: p.x, y: p.y + h },
          ];
        }),
      );
      const corrections: Vec2[] = [];
      for (let n = 0; n < active.length; n++) {
        const i = active[n]!;
        const origin = mapped[i]!;
        const x = probes[n * 2]!;
        const y = probes[n * 2 + 1]!;
        const inverse = invert({
          a: (x.x - origin.x) / h,
          b: (x.y - origin.y) / h,
          c: (y.x - origin.x) / h,
          d: (y.y - origin.y) / h,
          e: 0,
          f: 0,
        });
        if (!inverse) return null;
        const target = targets[i]!;
        const correction = applyLinear(inverse, { x: target.x - origin.x, y: target.y - origin.y });
        if (!Number.isFinite(correction.x) || !Number.isFinite(correction.y)) return null;
        corrections.push(correction);
      }

      // Backtracking keeps Newton steps from overshooting nonlinear cells.
      let pending = active.map((_, n) => n);
      for (let step = 0; step < LINE_SEARCH_STEPS && pending.length > 0; step++) {
        const factor = 2 ** -step;
        const candidates = pending.map((n) => {
          const guess = guesses[active[n]!]!;
          const correction = corrections[n]!;
          return { x: guess.x + factor * correction.x, y: guess.y + factor * correction.y };
        });
        const results = forward(candidates);
        pending = pending.filter((n, k) => {
          const i = active[n]!;
          const error = distance(results[k]!, targets[i]!);
          if (error <= TOLERANCE || error < errors[i]!) {
            guesses[i] = candidates[k]!;
            return false;
          }
          return true;
        });
      }
      if (pending.length > 0) return null;
    }
    return null;
  };

  return (targets) => {
    if (targets.length !== initial.length || targets.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)))
      return null;
    if (targets.every((p, i) => distance(p, visible[i]!) <= TOLERANCE)) {
      previous = initial;
      return initial;
    }
    const solved = solve(targets);
    if (!solved) return null;
    previous = solved;
    return solved;
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
