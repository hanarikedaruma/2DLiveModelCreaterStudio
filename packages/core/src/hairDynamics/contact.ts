import type { Vec2 } from '@app/schema';
import type { HairContacts } from '@app/contracts';

const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y;
const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const length = (v: Vec2) => Math.hypot(v.x, v.y);
const clamp = (v: number) => Math.max(0, Math.min(1, v));
export const mixPoint = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

// Includes segment interiors and rounded endpoints, including parallel/degenerate pairs.
export function closestSegments(a: Vec2, b: Vec2, c: Vec2, d: Vec2) {
  const u = sub(b, a),
    v = sub(d, c),
    w = sub(a, c);
  const aa = dot(u, u),
    bb = dot(u, v),
    cc = dot(v, v),
    dd = dot(u, w),
    ee = dot(v, w);
  let s = 0,
    t = 0;
  if (aa < 1e-16) t = cc > 1e-16 ? clamp(ee / cc) : 0;
  else if (cc < 1e-16) s = clamp(-dd / aa);
  else {
    const det = aa * cc - bb * bb;
    s = det > 1e-16 ? clamp((bb * ee - cc * dd) / det) : 0;
    t = (bb * s + ee) / cc;
    if (t < 0) {
      t = 0;
      s = clamp(-dd / aa);
    } else if (t > 1) {
      t = 1;
      s = clamp((bb - dd) / aa);
    }
  }
  const p = mixPoint(a, b, s),
    q = mixPoint(c, d, t);
  return { s, t, p, q, distance: length(sub(p, q)) };
}

export function interpolateContacts(before: HairContacts, after: HairContacts, t: number): HairContacts {
  return {
    radius: before.radius + (after.radius - before.radius) * t,
    colliders: after.colliders.map((c, i) => ({
      ...c,
      radius: before.colliders[i]!.radius + (c.radius - before.colliders[i]!.radius) * t,
      points: c.points.map((p, k) => mixPoint(before.colliders[i]!.points[k]!, p, t)),
    })),
  };
}
export function contactKey(contacts?: HairContacts): string {
  return contacts?.colliders.map((c) => `${c.id}:${c.points.length}`).join('|') ?? '';
}
export function contactMotion(before?: HairContacts, after?: HairContacts): number {
  if (contactKey(before) !== contactKey(after)) return Infinity;
  let maximum = Math.abs((after?.radius ?? 0) - (before?.radius ?? 0));
  after?.colliders.forEach((c, i) => {
    maximum = Math.max(maximum, Math.abs(c.radius - before!.colliders[i]!.radius));
    c.points.forEach((p, k) => {
      maximum = Math.max(maximum, length(sub(p, before!.colliders[i]!.points[k]!)));
    });
  });
  return maximum;
}
export function contactsFit(curve: Vec2[], fixed: number, contacts: HairContacts): boolean {
  return contacts.colliders.every((c) =>
    c.points.slice(1).every((d, k) =>
      curve.slice(Math.max(1, fixed)).every((b, j) => {
        const i = j + Math.max(1, fixed);
        return closestSegments(curve[i - 1]!, b, c.points[k]!, d).distance >= c.radius + contacts.radius - 1e-4;
      }),
    ),
  );
}

// Both moving segments stay in these convex hulls. Disjoint expanded hulls
// prove that the remaining sweep is empty, including near-tangential motion.
function hull(points: Vec2[]): Vec2[] {
  const sorted = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const half = (items: Vec2[]) => {
    const result: Vec2[] = [];
    for (const p of items) {
      while (result.length >= 2) {
        const a = result.at(-2)!,
          b = result.at(-1)!;
        if ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) > 0) break;
        result.pop();
      }
      result.push(p);
    }
    return result;
  };
  const lower = half(sorted),
    upper = half(sorted.slice().reverse());
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}
function hullDistance(a: Vec2[], b: Vec2[]): number {
  const contains = (polygon: Vec2[], p: Vec2) =>
    polygon.length >= 3 &&
    polygon.every((q, i) => {
      const r = polygon[(i + 1) % polygon.length]!;
      return (r.x - q.x) * (p.y - q.y) - (r.y - q.y) * (p.x - q.x) >= -1e-12;
    });
  if (a.some((p) => contains(b, p)) || b.some((p) => contains(a, p))) return 0;
  let distance = Infinity;
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b.length; j++)
      distance = Math.min(
        distance,
        closestSegments(a[i]!, a[(i + 1) % a.length]!, b[j]!, b[(j + 1) % b.length]!).distance,
      );
  return distance;
}

// Conservative advancement. The sum of endpoint speed bounds also bounds separation speed.
// An exhausted budget is an unresolved contact, never a claim of an empty sweep.
function sweep(a0: Vec2, b0: Vec2, c0: Vec2, d0: Vec2, a: Vec2, b: Vec2, c: Vec2, d: Vec2, radius: number) {
  const speed = Math.max(length(sub(a, a0)), length(sub(b, b0))) + Math.max(length(sub(c, c0)), length(sub(d, d0)));
  let time = 0;
  for (let step = 0; step < 16; step++) {
    const hit = closestSegments(
      mixPoint(a0, a, time),
      mixPoint(b0, b, time),
      mixPoint(c0, c, time),
      mixPoint(d0, d, time),
    );
    if (hit.distance <= radius + 1e-5) return { ...hit, time, exhausted: false };
    if (speed < 1e-12) return null;
    const next = time + (hit.distance - radius) / speed;
    if (next > 1) return null;
    if (next - time < 1e-7) return { ...hit, time, exhausted: false };
    time = next;
  }
  if (
    hullDistance(
      hull([mixPoint(a0, a, time), mixPoint(b0, b, time), a, b]),
      hull([mixPoint(c0, c, time), mixPoint(d0, d, time), c, d]),
    ) >
    radius + 1e-5
  )
    return null;
  return {
    ...closestSegments(mixPoint(a0, a, time), mixPoint(b0, b, time), mixPoint(c0, c, time), mixPoint(d0, d, time)),
    time,
    exhausted: true,
  };
}

export function projectContacts(
  curve: Vec2[],
  fixed: number,
  contacts: HairContacts,
  previous?: { curve: Vec2[]; contacts: HairContacts },
  spread = false,
): { changed: boolean; exhausted: boolean } {
  let changed = false,
    exhausted = false;
  for (let i = Math.max(1, fixed); i < curve.length; i++) {
    for (let ci = 0; ci < contacts.colliders.length; ci++) {
      const collider = contacts.colliders[ci]!;
      for (let k = 1; k < collider.points.length; k++) {
        const a = curve[i - 1]!,
          b = curve[i]!,
          c = collider.points[k - 1]!,
          d = collider.points[k]!;
        const physicalRadius = contacts.radius + collider.radius;
        const radius = physicalRadius + (contacts.margin ?? 0.25);
        const near = closestSegments(a, b, c, d);
        const old = previous?.contacts.colliders[ci];
        // Clearance belongs to projection. Sweeping it as physical thickness
        // produces false unresolved contacts while sliding along its boundary.
        const hit = old
          ? sweep(
              previous!.curve[i - 1]!,
              previous!.curve[i]!,
              old.points[k - 1]!,
              old.points[k]!,
              a,
              b,
              c,
              d,
              physicalRadius,
            )
          : null;
        if (hit?.exhausted) exhausted = true;
        if (near.distance >= radius && !hit) continue;
        let normal = sub((hit ?? near).p, (hit ?? near).q);
        if (length(normal) < 1e-8 && previous && old) {
          const was = closestSegments(previous.curve[i - 1]!, previous.curve[i]!, old.points[k - 1]!, old.points[k]!);
          normal = sub(was.p, was.q);
        }
        if (length(normal) < 1e-8) {
          normal = { x: -(d.y - c.y), y: d.x - c.x };
          const root = dot(sub(curve[0]!, c), normal);
          if (root < 0) normal = { x: -normal.x, y: -normal.y };
        }
        const n = length(normal);
        if (n < 1e-12) {
          exhausted = true;
          continue;
        }
        normal = { x: normal.x / n, y: normal.y / n };
        const location = hit?.s ?? near.s;
        // For a sweep, keep the previous side of the moving capsule's current surface.
        const point = mixPoint(a, b, location);
        const surface = mixPoint(c, d, hit?.t ?? near.t);
        const amount = radius - dot(sub(point, surface), normal);
        if (amount <= 0) continue;
        const wa = i - 1 >= fixed ? 1 - location : 0,
          wb = i >= fixed ? location : 0;
        const denominator = wa * wa + wb * wb;
        if (denominator < 1e-10) {
          exhausted = true;
          continue;
        }
        a.x += (normal.x * amount * wa) / denominator;
        a.y += (normal.y * amount * wa) / denominator;
        b.x += (normal.x * amount * wb) / denominator;
        b.y += (normal.y * amount * wb) / denominator;
        if (spread) {
          const span = Math.max(2, Math.min(12, Math.ceil(radius / Math.max(1e-3, length(sub(b, a)))) * 2));
          const delta = (amount * Math.max(wa, wb)) / denominator;
          for (let j = Math.max(fixed, i - span); j <= Math.min(curve.length - 1, i + span); j++) {
            if (j === i - 1 || j === i) continue;
            const weight = 0.7 * (1 - Math.abs(j - (i - 1 + location)) / (span + 1)) ** 2;
            curve[j]!.x += normal.x * delta * weight;
            curve[j]!.y += normal.y * delta * weight;
          }
        }
        changed = true;
      }
    }
  }
  return { changed, exhausted };
}

// Static contact also runs with inertia OFF. Roots stay pinned; lengths and contact alternate.
export function solveStaticContacts(
  rest: Vec2[],
  fixed: number,
  contacts: HairContacts,
  previous?: { curve: Vec2[]; contacts: HairContacts },
) {
  const curve = rest.map((p) => ({ ...p }));
  const lengths = rest.slice(1).map((p, i) => length(sub(p, rest[i]!)));
  if (!previous) {
    // A centred crossing has no unique normal. Seed a smooth route around the nearer
    // finite endpoint; the subsequent length/contact solve must still validate it.
    for (const collider of contacts.colliders)
      for (let k = 1; k < collider.points.length; k++) {
        const c = collider.points[k - 1]!,
          d = collider.points[k]!;
        for (let i = fixed; i < curve.length; i++) {
          const near = closestSegments(curve[i - 1]!, curve[i]!, c, d);
          if (near.distance > 1e-5 || near.t <= 1e-5 || near.t >= 1 - 1e-5) continue;
          const end = length(sub(curve[0]!, c)) < length(sub(curve[0]!, d)) ? c : d;
          const delta = sub(end, near.q),
            distance = length(delta);
          if (distance < 1e-8) continue;
          const amount = distance + contacts.radius + collider.radius + 0.25;
          for (let j = fixed; j < curve.length; j++) {
            const t = clamp((j - fixed + 1) / Math.max(1, i - fixed));
            const weight = t * t * (3 - 2 * t);
            curve[j]!.x += (delta.x / distance) * amount * weight;
            curve[j]!.y += (delta.y / distance) * amount * weight;
          }
          break;
        }
      }
  }
  let exhausted = false;
  for (let iteration = 0; iteration < 48; iteration++) {
    for (let i = fixed; i < curve.length; i++) {
      const a = curve[i - 1]!,
        b = curve[i]!,
        delta = sub(b, a),
        distance = length(delta);
      if (distance < 1e-10) continue;
      const amount = (distance - lengths[i - 1]!) / distance;
      b.x -= delta.x * amount;
      b.y -= delta.y * amount;
    }
    const projected = projectContacts(curve, fixed, contacts, previous, true);
    exhausted = exhausted || projected.exhausted;
    if (
      iteration >= 7 &&
      contactsFit(curve, fixed, contacts) &&
      lengths.every((l, i) => Math.abs(length(sub(curve[i + 1]!, curve[i]!)) - l) <= Math.max(1e-4, l * 0.02))
    )
      return { curve, resolved: !exhausted };
  }
  return { curve, resolved: false };
}
