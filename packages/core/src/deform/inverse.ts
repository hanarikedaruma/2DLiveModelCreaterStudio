import type { Vec2 } from '@app/schema';
const TOLERANCE = 1e-6;
const ITERATIONS = 16;
const LINE_SEARCH_STEPS = 10;
const distance = (p: Vec2, q: Vec2) => Math.hypot(p.x - q.x, p.y - q.y);
function invert(m: { a: number; b: number; c: number; d: number; e: number; f: number }) {
  const det = m.a * m.d - m.b * m.c;
  return Math.abs(det) < 1e-12 ? null : { a: m.d / det, b: -m.b / det, c: -m.c / det, d: m.a / det };
}
const applyLinear = (m: { a: number; b: number; c: number; d: number }, p: Vec2) => ({
  x: m.a * p.x + m.c * p.y,
  y: m.b * p.x + m.d * p.y,
});
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
