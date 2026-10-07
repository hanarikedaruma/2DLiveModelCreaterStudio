import type { CurveGuide, Mesh, Model, Vec2 } from '@app/schema';
import type { CurveGuideResult, TargetDeltas } from '@app/contracts';
import { pointsToModelSpace } from './space';

const STEPS = 48;
const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const mix = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
const signatures = new WeakMap<Mesh, string>();

// Geometry only: a copy with a new mesh id retains correspondence; remeshing/moving base vertices does not.
export function curveMeshSignature(mesh: Mesh): string {
  const known = signatures.get(mesh);
  if (known) return known;
  const text = JSON.stringify([mesh.vertices, mesh.triangles]);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  const value = `${mesh.vertices.length}:${mesh.triangles.length}:${(hash >>> 0).toString(16)}`;
  signatures.set(mesh, value);
  return value;
}

// Interpolating quadratic: the visible middle handle lies on the line, not on a hidden Bézier tangent.
export function sampleFlowLine(points: readonly Vec2[]): Vec2[] {
  const [a, m, b] = points;
  if (!a || !m || !b) return [];
  const c = { x: 2 * m.x - (a.x + b.x) / 2, y: 2 * m.y - (a.y + b.y) / 2 };
  return Array.from({ length: STEPS + 1 }, (_, i) => {
    const t = i / STEPS,
      s = 1 - t;
    return { x: s * s * a.x + 2 * s * t * c.x + t * t * b.x, y: s * s * a.y + 2 * s * t * c.y + t * t * b.y };
  });
}

type Attachment = { indices: [number, number, number]; weights: [number, number, number] };
type Location = { segment: number; t: number; distance: number; component: number };
interface Prepared {
  reference: Vec2[];
  along: number[];
  attachments: Attachment[];
  vertices: Location[];
  component: number;
}
const preparedCache = new WeakMap<Mesh, WeakMap<object, Prepared>>();

function barycentric(p: Vec2, a: Vec2, b: Vec2, c: Vec2): [number, number, number] | null {
  const determinant = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
  if (Math.abs(determinant) < 1e-10) return null;
  const u = ((b.y - c.y) * (p.x - c.x) + (c.x - b.x) * (p.y - c.y)) / determinant;
  const v = ((c.y - a.y) * (p.x - c.x) + (a.x - c.x) * (p.y - c.y)) / determinant;
  return [u, v, 1 - u - v];
}

function attachmentAt(mesh: Mesh, p: Vec2): Attachment {
  let best: Attachment | null = null,
    bestScore = Infinity;
  for (const indices of mesh.triangles) {
    const [a, b, c] = indices.map((i) => mesh.vertices[i]!) as [Vec2, Vec2, Vec2];
    const weights = barycentric(p, a, b, c);
    if (!weights) continue;
    if (weights.every((w) => w >= -1e-8)) return { indices, weights };
    const near = weights.map((w) => Math.max(0, w));
    const sum = near.reduce((s, w) => s + w, 0);
    const q = {
      x: (a.x * near[0]! + b.x * near[1]! + c.x * near[2]!) / sum,
      y: (a.y * near[0]! + b.y * near[1]! + c.y * near[2]!) / sum,
    };
    const score = dist(p, q);
    if (score < bestScore) {
      bestScore = score;
      best = { indices, weights };
    }
  }
  return best ?? { indices: [0, 0, 0], weights: [1, 0, 0] };
}

function closest(curve: Vec2[], p: Vec2): Omit<Location, 'component'> {
  let best = { segment: 0, t: 0, distance: Infinity };
  for (let i = 0; i < curve.length - 1; i++) {
    const a = curve[i]!,
      b = curve[i + 1]!;
    const dx = b.x - a.x,
      dy = b.y - a.y,
      len = dx * dx + dy * dy;
    const t = len > 1e-12 ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len) : 0;
    const distance = dist(p, mix(a, b, t));
    if (distance < best.distance) best = { segment: i, t, distance };
  }
  return best;
}

function prepare(mesh: Mesh, guide: CurveGuide): Prepared {
  let byReference = preparedCache.get(mesh);
  if (!byReference) preparedCache.set(mesh, (byReference = new WeakMap()));
  const known = byReference.get(guide.reference);
  if (known) return known;
  const reference = sampleFlowLine(guide.reference);
  const along = [0];
  for (let i = 1; i < reference.length; i++) along.push(along[i - 1]! + dist(reference[i - 1]!, reference[i]!));
  const length = along.at(-1)!;
  for (let i = 0; i < along.length; i++) along[i] = length > 1e-8 ? along[i]! / length : 0;
  const components = mesh.vertices.map((_, i) => i);
  const find = (i: number): number => {
    while (components[i] !== i) {
      components[i] = components[components[i]!]!;
      i = components[i]!;
    }
    return i;
  };
  for (const [a, b, c] of mesh.triangles) {
    components[find(b)] = find(a);
    components[find(c)] = find(a);
  }
  const attachments = reference.map((p) => attachmentAt(mesh, p));
  const component = find(attachments[0]!.indices[0]);
  const vertices = mesh.vertices.map((p, i) => ({ ...closest(reference, p), component: find(i) }));
  const result = { reference, along, attachments, vertices, component };
  byReference.set(guide.reference, result);
  return result;
}

function fromAttachment(a: Attachment, positions: Float32Array): Vec2 {
  return a.indices.reduce(
    (p, index, i) => ({
      x: p.x + positions[index * 2]! * a.weights[i]!,
      y: p.y + positions[index * 2 + 1]! * a.weights[i]!,
    }),
    { x: 0, y: 0 },
  );
}

export function meshPointsToDisplay(mesh: Mesh, positions: Float32Array, points: Vec2[]): Vec2[] {
  return points.map((p) => fromAttachment(attachmentAt(mesh, p), positions));
}

function angle(a: Vec2, b: Vec2): number {
  return Math.atan2(b.y - a.y, b.x - a.x);
}
function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
function area(p: Float32Array, a: number, b: number, c: number): number {
  return (
    (p[b * 2]! - p[a * 2]!) * (p[c * 2 + 1]! - p[a * 2 + 1]!) -
    (p[b * 2 + 1]! - p[a * 2 + 1]!) * (p[c * 2]! - p[a * 2]!)
  );
}
function valid(mesh: Mesh, before: Float32Array, after: Float32Array): boolean {
  if (after.some((v) => !Number.isFinite(v))) return false;
  return mesh.triangles.every(([a, b, c]) => {
    const original = area(before, a, b, c),
      next = area(after, a, b, c);
    return Math.abs(original) < 1e-8
      ? Math.abs(next - original) < 1e-6
      : original * next > 0 && Math.abs(next) >= Math.abs(original) * 0.02;
  });
}

export function evaluateCurveGuide(
  model: Model,
  deltas: TargetDeltas,
  guide: CurveGuide,
  mesh: Mesh,
  positions: Float32Array,
): { positions: Float32Array; result: CurveGuideResult } {
  const fallback = pointsToModelSpace(model, deltas, guide.partId, guide.points);
  const unused = (status: CurveGuideResult['status']) => ({
    positions,
    result: { curve: sampleFlowLine(fallback), handles: fallback, status, strength: 0 },
  });
  if (guide.meshSignature !== curveMeshSignature(mesh) || mesh.vertices.length < 3 || mesh.triangles.length === 0)
    return unused('stale');
  const data = prepare(mesh, guide);
  const source = data.attachments.map((a) => fromAttachment(a, positions));
  if (!guide.enabled)
    return {
      positions,
      result: {
        curve: source,
        handles: [source[0]!, source[STEPS / 2]!, source[STEPS]!],
        status: 'disabled',
        strength: 0,
      },
    };
  const edited = sampleFlowLine(guide.points);
  const vertexDelta = deltas.vertices[mesh.id];
  const local = [...data.reference, ...edited].map((p, i) => {
    const attachment = data.attachments[i % data.reference.length]!;
    const delta =
      vertexDelta?.length === positions.length
        ? attachment.indices.reduce(
            (d, index, k) => ({
              x: d.x + vertexDelta[index * 2]! * attachment.weights[k]!,
              y: d.y + vertexDelta[index * 2 + 1]! * attachment.weights[k]!,
            }),
            { x: 0, y: 0 },
          )
        : { x: 0, y: 0 };
    return { x: p.x + delta.x, y: p.y + delta.y };
  });
  const lifted = pointsToModelSpace(model, deltas, guide.partId, local);
  let target = source.map((p, i) => {
    const weight = smooth(clamp((data.along[i]! - guide.rootFraction) / 0.15));
    return {
      x: p.x + (lifted[i + source.length]!.x - lifted[i]!.x) * weight,
      y: p.y + (lifted[i + source.length]!.y - lifted[i]!.y) * weight,
    };
  });
  if (guide.gravity) {
    const roll = wrap(angle(data.reference[0]!, data.reference[1]!) - angle(source[0]!, source[1]!));
    const hanging = [{ ...target[0]! }];
    for (let i = 0; i < STEPS; i++) {
      const a = target[i]!,
        b = target[i + 1]!,
        length = dist(a, b);
      const follow = smooth(
        clamp(((data.along[i]! + data.along[i + 1]!) / 2 - guide.rootFraction) / (1 - guide.rootFraction)),
      );
      const theta = angle(a, b) + roll * follow;
      hanging.push({ x: hanging[i]!.x + Math.cos(theta) * length, y: hanging[i]!.y + Math.sin(theta) * length });
    }
    target = hanging;
  }

  if (target.every((p, i) => dist(p, source[i]!) < 1e-8)) {
    return {
      positions,
      result: { curve: source, handles: [source[0]!, source[STEPS / 2]!, source[STEPS]!], status: 'ok', strength: 1 },
    };
  }

  const candidate = positions.slice();
  data.vertices.forEach((location, index) => {
    if (location.component !== data.component || location.distance >= guide.radius) return;
    const { segment, t } = location;
    const sourcePoint = mix(source[segment]!, source[segment + 1]!, t);
    const targetPoint = mix(target[segment]!, target[segment + 1]!, t);
    const theta = wrap(angle(target[segment]!, target[segment + 1]!) - angle(source[segment]!, source[segment + 1]!));
    const x = positions[index * 2]! - sourcePoint.x,
      y = positions[index * 2 + 1]! - sourcePoint.y;
    const moved = {
      x: targetPoint.x + Math.cos(theta) * x - Math.sin(theta) * y,
      y: targetPoint.y + Math.sin(theta) * x + Math.cos(theta) * y,
    };
    const weight = 1 - smooth(clamp((location.distance / guide.radius - 0.5) * 2));
    candidate[index * 2] = positions[index * 2]! + (moved.x - positions[index * 2]!) * weight;
    candidate[index * 2 + 1] = positions[index * 2 + 1]! + (moved.y - positions[index * 2 + 1]!) * weight;
  });
  let strength = 1,
    output = candidate;
  for (let step = 0; !valid(mesh, positions, output) && step < 10; step++) {
    strength *= 0.5;
    output = positions.map((v, i) => v + (candidate[i]! - v) * strength);
  }
  if (!valid(mesh, positions, output)) {
    strength = 0;
    output = positions;
  }
  const curve = target.map((p, i) => mix(source[i]!, p, strength));
  return {
    positions: output,
    result: {
      curve,
      handles: [curve[0]!, curve[STEPS / 2]!, curve[STEPS]!],
      status: strength < 1 ? 'limited' : 'ok',
      strength,
    },
  };
}
