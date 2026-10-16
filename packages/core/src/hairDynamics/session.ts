import type { Vec2, CurveGuideDynamics } from '@app/schema';
import type { HairFrameContext, HairContacts, HairDynamicsSession as SessionContract } from '@app/contracts';
import { closestSegments, contactKey, contactMotion, interpolateContacts, projectContacts } from './contact';
export type FlowDynamicsSettings = CurveGuideDynamics;
type Point = Vec2;
type State = {
  fingerprint: string;
  axisKey: string;
  origin: Point;
  scale: number;
  knots: number[];
  x: Point[];
  v: Point[];
  q: Point[];
  input: Point[];
  rest: Point[];
  now: number;
  simNow: number;
  frozen: boolean;
  frameId: string | number;
  curve: Point[];
  displayedCurve: Point[];
  status: 'running' | 'settled';
  contacts?: HairContacts;
  collisionUnresolved: boolean;
  previousContactFrame?: { curve: Point[]; contacts: HairContacts };
};
const H = 1 / 120;
const copy = (p: Point): Point => ({ ...p });
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const mix = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
function at(points: Point[], along: number[], s: number): Point {
  const i = Math.max(0, along.findIndex((v) => v >= s) - 1);
  if (s >= 1) return copy(points.at(-1)!);
  return mix(points[i]!, points[i + 1]!, (s - along[i]!) / Math.max(1e-12, along[i + 1]! - along[i]!));
}
function rotate(p: Point, angle: number): Point {
  return { x: Math.cos(angle) * p.x - Math.sin(angle) * p.y, y: Math.sin(angle) * p.x + Math.cos(angle) * p.y };
}

// Histories belong to one playback, never to ProjectStore or a palette component.
export class HairDynamicsSession implements SessionContract {
  epoch = 0;
  private states = new Map<string, State>();
  private projectId: string | null = null;
  reset(): void {
    this.epoch++;
    this.states.clear();
    this.projectId = null;
  }
  retain(projectId: string, ids: string[]): void {
    if (this.projectId !== projectId) this.reset();
    this.projectId = projectId;
    const keep = new Set(ids);
    for (const id of this.states.keys()) if (!keep.has(id)) this.states.delete(id);
  }
  discard(id: string): void {
    this.states.delete(id);
  }
  advance(
    id: string,
    rest: Point[],
    along: number[],
    rootFraction: number,
    settings: FlowDynamicsSettings,
    fingerprint: string,
    axisKey: string,
    frame: HairFrameContext,
    contacts?: HairContacts,
  ): { curve: Point[]; status: 'running' | 'settled' | 'frozen'; reason?: string; collisionUnresolved?: boolean } {
    if (!settings.enabled || settings.strength <= 0) {
      this.discard(id);
      return { curve: rest, status: 'settled' };
    }
    const length = rest.slice(1).reduce((sum, p, i) => sum + distance(p, rest[i]!), 0);
    if (
      !(length > 1e-8) ||
      rest.some((p) => !Number.isFinite(p.x + p.y)) ||
      rest.slice(1).some((p, i) => distance(p, rest[i]!) < length * 1e-8)
    ) {
      this.discard(id);
      return { curve: rest, status: 'frozen', reason: '流れ線の長さや座標を確認してください。' };
    }
    let state = this.states.get(id);
    const root = Math.max(rootFraction, along[1]!);
    const knots = [0, root, ...Array.from({ length: 12 }, (_, i) => root + ((1 - root) * (i + 1)) / 12)];
    const input = knots.map((s) => at(rest, along, s));
    const init = () => {
      const origin = copy(rest[0]!);
      const normalized = input.map((p) => ({ x: (p.x - origin.x) / length, y: (p.y - origin.y) / length }));
      state = {
        fingerprint,
        axisKey,
        origin,
        scale: length,
        knots,
        x: normalized.map(copy),
        v: normalized.map(() => ({ x: 0, y: 0 })),
        q: normalized.map(copy),
        input,
        rest: rest.map(copy),
        now: frame.now,
        simNow: frame.now,
        frozen: !frame.active,
        frameId: frame.frameId,
        curve: rest.map(copy),
        displayedCurve: rest.map(copy),
        status: 'settled',
        contacts,
        collisionUnresolved: false,
      };
      this.states.set(id, state);
    };
    if (
      !state ||
      state.fingerprint !== fingerprint ||
      contactKey(state.contacts) !== contactKey(contacts) ||
      settings.strength <= 0
    )
      init();
    const current = state!;
    if (current.frameId === frame.frameId) {
      return {
        curve: frame.active ? current.curve : frame.freeze ? current.displayedCurve : rest,
        status: frame.active ? current.status : 'frozen',
        collisionUnresolved: current.collisionUnresolved,
      };
    }
    const q = input.map((p) => ({
      x: (p.x - current.origin.x) / current.scale,
      y: (p.y - current.origin.y) / current.scale,
    }));
    if (!frame.active) {
      current.previousContactFrame = undefined;
      current.frozen = true;
      current.frameId = frame.frameId;
      if (frame.freeze) {
        const carry = (from: Point[], to: Point[], d: Point, i: number) => {
          const k = Math.min(i, from.length - 2),
            a = from[k]!,
            b = from[k + 1]!,
            c = to[k]!,
            e = to[k + 1]!;
          const angle = Math.atan2(e.y - c.y, e.x - c.x) - Math.atan2(b.y - a.y, b.x - a.x);
          const scale = distance(c, e) / Math.max(1e-9, distance(a, b)),
            out = rotate(d, angle);
          return { x: out.x * scale, y: out.y * scale };
        };
        current.curve = rest.map((p, i) => {
          if (along[i]! <= root) return copy(p);
          const d = carry(
            current.rest,
            rest,
            {
              x: current.displayedCurve[i]!.x - current.rest[i]!.x,
              y: current.displayedCurve[i]!.y - current.rest[i]!.y,
            },
            i,
          );
          return { x: p.x + d.x, y: p.y + d.y };
        });
        current.x = current.knots.map((s) => {
          const p = at(current.curve, along, s);
          return { x: (p.x - current.origin.x) / current.scale, y: (p.y - current.origin.y) / current.scale };
        });
        current.displayedCurve = current.curve.map(copy);
        current.q = q;
        current.input = input;
        current.rest = rest.map(copy);
        current.v = current.v.map(() => ({ x: 0, y: 0 }));
        current.now = current.simNow = frame.now;
        current.contacts = contacts;
        return { curve: current.curve, status: 'frozen' };
      }
      current.displayedCurve = rest.map(copy);
      current.rest = rest.map(copy);
      return { curve: rest, status: 'frozen' };
    }
    if (current.frozen) {
      current.frozen = false;
      if (
        input.some((p, i) => distance(p, current.input[i]!) > 1e-6) ||
        contactMotion(current.contacts, contacts) > 1e-6
      ) {
        init();
        return { curve: rest, status: 'settled' };
      }
      current.now = current.simNow = frame.now;
      current.contacts = contacts;
      current.frameId = frame.frameId;
      return { curve: current.curve, status: 'running' };
    }
    const axisChanged = current.axisKey !== axisKey;
    if (axisChanged) {
      for (let i = 0; i < q.length; i++) {
        const k = Math.min(i, q.length - 2);
        const oldAngle = Math.atan2(current.q[k + 1]!.y - current.q[k]!.y, current.q[k + 1]!.x - current.q[k]!.x);
        const newAngle = Math.atan2(q[k + 1]!.y - q[k]!.y, q[k + 1]!.x - q[k]!.x);
        const delta = rotate(
          { x: current.x[i]!.x - current.q[i]!.x, y: current.x[i]!.y - current.q[i]!.y },
          newAngle - oldAngle,
        );
        current.x[i] = { x: q[i]!.x + delta.x, y: q[i]!.y + delta.y };
        current.v[i] = rotate(current.v[i]!, newAngle - oldAngle);
      }
      current.axisKey = axisKey;
      current.q = q.map(copy);
      current.input = input;
      current.now = current.simNow = frame.now;
    }
    const elapsed = frame.now - current.now;
    if (
      !Number.isFinite(frame.now + frame.dt) ||
      frame.dt < 0 ||
      elapsed < 0 ||
      frame.dt > 100 ||
      frame.now - current.simNow > H * 8000 + 1e-6 ||
      distance(input[0]!, current.input[0]!) > (length * (1 - root)) / 2 ||
      contactMotion(current.contacts, contacts) > (length * (1 - root)) / 2
    ) {
      init();
      return { curve: rest, status: 'settled' };
    }
    const previousInput = current.input.map((p) => ({
      x: (p.x - current.origin.x) / current.scale,
      y: (p.y - current.origin.y) / current.scale,
    }));
    let steps = 0;
    current.previousContactFrame =
      !axisChanged && current.contacts ? { curve: current.curve.map(copy), contacts: current.contacts } : undefined;
    current.collisionUnresolved = false;
    while (current.simNow + H * 1000 <= frame.now + 1e-6 && steps++ < 8) {
      current.simNow += H * 1000;
      const t = elapsed > 0 ? Math.max(0, Math.min(1, (current.simNow - current.now) / elapsed)) : 1;
      const target = q.map((p, i) => mix(previousInput[i]!, p, t));
      const previousContacts = current.contacts;
      const nextContacts = contacts && previousContacts ? interpolateContacts(previousContacts, contacts, t) : contacts;
      const normalize = (value: HairContacts): HairContacts => ({
        radius: value.radius / current.scale,
        margin: (value.margin ?? 0.25) / current.scale,
        colliders: value.colliders.map((c) => ({
          ...c,
          radius: c.radius / current.scale,
          points: c.points.map((p) => ({
            x: (p.x - current.origin.x) / current.scale,
            y: (p.y - current.origin.y) / current.scale,
          })),
        })),
      });
      const lastT = elapsed > 0 ? Math.max(0, Math.min(1, (current.simNow - H * 1000 - current.now) / elapsed)) : 0;
      const beforeContacts =
        contacts && previousContacts ? interpolateContacts(previousContacts, contacts, lastT) : contacts;
      const unresolved = solve(
        current,
        target,
        settings,
        nextContacts ? normalize(nextContacts) : undefined,
        beforeContacts ? normalize(beforeContacts) : undefined,
      );
      current.collisionUnresolved = current.collisionUnresolved || unresolved;
    }
    current.input = input;
    current.rest = rest.map(copy);
    current.now = frame.now;
    current.frameId = frame.frameId;
    current.contacts = contacts;
    const displacement = current.x.map((p, i) => ({
      x: (p.x - current.q[i]!.x) * current.scale,
      y: (p.y - current.q[i]!.y) * current.scale,
    }));
    current.curve = rest.map((p, i) => {
      if (along[i]! <= root) return copy(p);
      const d = at(displacement, current.knots, along[i]!);
      return { x: p.x + d.x, y: p.y + d.y };
    });
    const moving =
      displacement.some((p) => Math.hypot(p.x, p.y) > 0.01) ||
      current.v.some((p) => Math.hypot(p.x, p.y) * current.scale > 0.01);
    current.status = moving ? 'running' : 'settled';
    current.displayedCurve = current.curve.map(copy);
    return {
      curve: current.curve,
      status: current.status,
      ...(current.collisionUnresolved ? { collisionUnresolved: true } : {}),
    };
  }
  // A rejected mesh candidate must not leave velocity from the rejected line.
  reject(id: string): void {
    this.discard(id);
  }
  previousContacts(id: string) {
    return this.states.get(id)?.previousContactFrame;
  }
  accept(id: string, curve: Point[], along: number[]): void {
    const state = this.states.get(id);
    if (!state) return;
    state.knots.forEach((s, i) => {
      const p = at(curve, along, s);
      const next = { x: (p.x - state.origin.x) / state.scale, y: (p.y - state.origin.y) / state.scale };
      if (distance(next, state.x[i]!) > 1e-6) state.v[i] = { x: 0, y: 0 };
      state.x[i] = next;
    });
    state.curve = curve.map(copy);
    state.displayedCurve = curve.map(copy);
  }
}

function solve(
  state: State,
  q: Point[],
  settings: FlowDynamicsSettings,
  contacts?: HairContacts,
  previousContacts?: HairContacts,
): boolean {
  let unresolved = false;
  const n = q.length;
  const lengths = q.slice(1).map((p, i) => distance(p, q[i]!));
  const masses = q.map((_, i) => (i < 2 ? 0 : (lengths[i - 1]! + (lengths[i] ?? lengths[i - 1]!)) / 2));
  const total = masses.reduce((sum, m) => sum + m, 0);
  const weights = masses.map((m) => (m > 1e-10 ? total / m : 0));
  const frequency = { soft: 1, normal: 1.8, firm: 3 }[settings.preset] * (1.5 - settings.strength);
  const omega = q.map((_, i) => 2 * Math.PI * frequency * (1.5 - 0.5 * state.knots[i]!));
  const before = state.x.map(copy);
  for (let i = 2; i < n; i++) {
    const velocity = { x: (q[i]!.x - state.q[i]!.x) / H, y: (q[i]!.y - state.q[i]!.y) / H };
    const damping = Math.exp(-2 * (0.15 + 1.35 * settings.damping) * omega[i]! * H);
    state.v[i] = {
      x: velocity.x + damping * (state.v[i]!.x - velocity.x),
      y: velocity.y + damping * (state.v[i]!.y - velocity.y),
    };
    state.x[i] = { x: state.x[i]!.x + H * state.v[i]!.x, y: state.x[i]!.y + H * state.v[i]!.y };
  }
  const positionLambda = q.map(() => ({ x: 0, y: 0 }));
  const bendLambda = q.map(() => 0);
  const maxDisplacement = (0.05 + 0.25 * settings.strength) * lengths.slice(1).reduce((a, b) => a + b, 0);
  for (let iteration = 0; iteration < 8; iteration++) {
    for (let i = 2; i < n; i++) {
      const a = weights[i]! / (omega[i]! ** 2 * H * H);
      for (const key of ['x', 'y'] as const) {
        const delta = (-(state.x[i]![key] - q[i]![key]) - a * positionLambda[i]![key]) / (weights[i]! + a);
        positionLambda[i]![key] += delta;
        state.x[i]![key] += weights[i]! * delta;
      }
      const d = distance(state.x[i]!, q[i]!);
      if (d > maxDisplacement) state.x[i] = mix(q[i]!, state.x[i]!, maxDisplacement / d);
    }
    for (let i = 1; i + 1 < n; i++) {
      const a = state.x[i - 1]!,
        b = state.x[i]!,
        c = state.x[i + 1]!;
      const u = { x: b.x - a.x, y: b.y - a.y },
        v = { x: c.x - b.x, y: c.y - b.y };
      const uu = u.x ** 2 + u.y ** 2,
        vv = v.x ** 2 + v.y ** 2;
      if (uu < 1e-12 || vv < 1e-12) continue;
      const restAngle =
        Math.atan2(q[i + 1]!.y - q[i]!.y, q[i + 1]!.x - q[i]!.x) -
        Math.atan2(q[i]!.y - q[i - 1]!.y, q[i]!.x - q[i - 1]!.x);
      const constraint = wrap(Math.atan2(v.y, v.x) - Math.atan2(u.y, u.x) - restAngle);
      const ga = { x: -u.y / uu, y: u.x / uu },
        gc = { x: -v.y / vv, y: v.x / vv };
      const gradients = [ga, { x: -ga.x - gc.x, y: -ga.y - gc.y }, gc];
      const compliance =
        1 /
        (0.1 *
          omega[i + 1]! ** 2 *
          ((lengths[i - 1]! + lengths[i]!) / 2) *
          { soft: 0.5, normal: 1, firm: 2 }[settings.preset]);
      const alpha = compliance / (H * H);
      const denominator = alpha + gradients.reduce((sum, g, k) => sum + weights[i - 1 + k]! * (g.x ** 2 + g.y ** 2), 0);
      const delta = (-constraint - alpha * bendLambda[i]!) / denominator;
      bendLambda[i]! += delta;
      gradients.forEach((g, k) => {
        const index = i - 1 + k;
        state.x[index]!.x += weights[index]! * g.x * delta;
        state.x[index]!.y += weights[index]! * g.y * delta;
      });
    }
    state.x[0] = copy(q[0]!);
    state.x[1] = copy(q[1]!);
    for (let i = 1; i < n; i++) {
      const a = state.x[i - 1]!,
        b = state.x[i]!;
      const d = distance(a, b),
        weight = weights[i - 1]! + weights[i]!;
      if (d < 1e-12 || weight === 0) continue;
      const correction = (d - lengths[i - 1]!) / (d * weight);
      const dx = (b.x - a.x) * correction,
        dy = (b.y - a.y) * correction;
      a.x += weights[i - 1]! * dx;
      a.y += weights[i - 1]! * dy;
      b.x -= weights[i]! * dx;
      b.y -= weights[i]! * dy;
    }
    if (contacts) {
      const projected = projectContacts(
        state.x,
        2,
        contacts,
        previousContacts ? { curve: before, contacts: previousContacts } : undefined,
      );
      unresolved = unresolved || projected.exhausted;
    }
  }
  state.x[0] = copy(q[0]!);
  state.x[1] = copy(q[1]!);
  state.v = state.x.map((p, i) =>
    i < 2 ? { x: 0, y: 0 } : { x: (p.x - before[i]!.x) / H, y: (p.y - before[i]!.y) / H },
  );
  if (contacts)
    for (let i = 2; i < n; i++) {
      for (let ci = 0; ci < contacts.colliders.length; ci++) {
        const collider = contacts.colliders[ci]!;
        for (let k = 1; k < collider.points.length; k++) {
          const near = closestSegments(state.x[i]!, state.x[i]!, collider.points[k - 1]!, collider.points[k]!);
          if (
            near.distance > contacts.radius + collider.radius + (contacts.margin ?? 0.001) * 2 ||
            near.distance < 1e-10
          )
            continue;
          const normal = { x: (near.p.x - near.q.x) / near.distance, y: (near.p.y - near.q.y) / near.distance };
          const previous = previousContacts?.colliders[ci];
          const old = previous ? mix(previous.points[k - 1]!, previous.points[k]!, near.t) : near.q;
          const shoulderVelocity = { x: (near.q.x - old.x) / H, y: (near.q.y - old.y) / H };
          const relative = { x: state.v[i]!.x - shoulderVelocity.x, y: state.v[i]!.y - shoulderVelocity.y };
          const normalSpeed = relative.x * normal.x + relative.y * normal.y;
          const outgoing = Math.max(0, normalSpeed);
          const tangentialDamping = Math.exp(-0.15 * H);
          state.v[i] = {
            x: shoulderVelocity.x + normal.x * outgoing + (relative.x - normal.x * normalSpeed) * tangentialDamping,
            y: shoulderVelocity.y + normal.y * outgoing + (relative.y - normal.y * normalSpeed) * tangentialDamping,
          };
        }
      }
    }
  state.q = q.map(copy);
  return unresolved;
}
