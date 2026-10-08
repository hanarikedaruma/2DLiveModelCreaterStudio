import type { FrameContext } from '@app/contracts';
import type { BounceSettings, Physics, Vec2 } from '@app/schema';
import { safeBounceScale, type BounceFrame } from './bounce';

const H = 1 / 120,
  SMOOTH = 1 - Math.exp(-H / 0.02);
const copy = (p: Vec2): Vec2 => ({ ...p });
const mix = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export function chestEquilibrium(b: BounceSettings, basis: [Vec2, Vec2]): Vec2 {
  const [x, y] = b.referenceBasis,
    sag = b.gravityStrength * b.amplitudes.y;
  const det = x.x * y.y - x.y * y.x;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-8) return { x: 0, y: 0 };
  const r = { x: (-y.x * sag) / det, y: (x.x * sag) / det };
  return { x: -(basis[0].x * r.x + basis[1].x * r.y) || 0, y: sag - (basis[0].y * r.x + basis[1].y * r.y) || 0 };
}
interface State {
  q: Vec2;
  v: Vec2;
  center: Vec2;
  simulated: Vec2;
  velocity1: Vec2 | null;
  velocity2: Vec2 | null;
  basis: [Vec2, Vec2];
  pending: number;
  now: number;
  frameId: string | number;
  fingerprint: string;
  pose: string;
}
export class ChestDynamicsSession {
  private states = new Map<string, State>();
  reset() {
    this.states.clear();
  }
  retain(ids: string[]) {
    const keep = new Set(ids);
    for (const id of this.states.keys()) if (!keep.has(id)) this.states.delete(id);
  }
  discard(id: string) {
    this.states.delete(id);
  }
  accept(id: string, q: Vec2) {
    const s = this.states.get(id);
    if (s) {
      s.q = copy(q);
      s.v = { x: 0, y: 0 };
    }
  }
  state(id: string) {
    const s = this.states.get(id);
    return s ? { q: copy(s.q), v: copy(s.v) } : null;
  }
  advance(item: Physics, frame: BounceFrame, ctx: Pick<FrameContext, 'now' | 'dt' | 'frameId'>): Vec2 {
    const b = item.bounce!;
    const fingerprint = JSON.stringify([
      item.direction,
      item.strength,
      item.spring,
      item.damping,
      item.inertia,
      item.range,
      item.inputs,
      b,
    ]);
    const pose = JSON.stringify([frame.center, frame.basis]);
    const frameId = ctx.frameId ?? ctx.now;
    let s = this.states.get(item.id);
    if (s && s.frameId === frameId && s.fingerprint === fingerprint && s.pose === pose) return copy(s.q);
    const fresh =
      !s ||
      s.fingerprint !== fingerprint ||
      !Number.isFinite(ctx.now + ctx.dt) ||
      ctx.dt < 0 ||
      ctx.now < s.now ||
      ctx.dt > 100;
    if (fresh) {
      s = {
        q: chestEquilibrium(b, frame.basis),
        v: { x: 0, y: 0 },
        center: copy(frame.center),
        simulated: copy(frame.center),
        velocity1: null,
        velocity2: null,
        basis: frame.basis.map(copy) as [Vec2, Vec2],
        pending: 0,
        now: ctx.now,
        frameId,
        fingerprint,
        pose,
      };
      this.states.set(item.id, s);
    }
    const state = s!;
    const dt = Math.max(0, ctx.dt) / 1000;
    const pending = state.pending;
    const steps = fresh ? 0 : Math.min(8, Math.floor((pending + dt) / H + 1e-9));
    state.pending = fresh ? 0 : Math.max(0, pending + dt - steps * H);
    if (state.pending > H) state.pending = 0;
    const factor = 1 - 0.4 * Math.max(0, Math.min(1, item.strength));
    const k = Math.max(1e-6, item.spring * factor),
      c = Math.max(0, item.damping * factor);
    for (let i = 1; i <= steps; i++) {
      const t = dt > 0 ? Math.max(0, Math.min(1, (i * H - pending) / dt)) : 1;
      const center = mix(state.center, frame.center, t);
      const basis: [Vec2, Vec2] = [mix(state.basis[0], frame.basis[0], t), mix(state.basis[1], frame.basis[1], t)];
      const raw = { x: (center.x - state.simulated.x) / H, y: (center.y - state.simulated.y) / H };
      const dv = { x: 0, y: 0 };
      if (!state.velocity1 || !state.velocity2) {
        state.velocity1 = copy(raw);
        state.velocity2 = copy(raw);
      } else
        for (const axis of ['x', 'y'] as const) {
          state.velocity1[axis] += SMOOTH * (raw[axis] - state.velocity1[axis]);
          const v = state.velocity2[axis] + SMOOTH * (state.velocity1[axis] - state.velocity2[axis]);
          dv[axis] = v - state.velocity2[axis];
          state.velocity2[axis] = v;
        }
      const equilibrium = chestEquilibrium(b, basis);
      for (const axis of ['x', 'y'] as const) {
        state.v[axis] =
          (state.v[axis] - item.inertia * dv[axis] + H * k * (equilibrium[axis] - state.q[axis])) / (1 + H * c);
        state.q[axis] += H * state.v[axis];
      }
      state.simulated = center;
      this.limit(state, item, frame);
    }
    this.limit(state, item, frame);
    state.center = copy(frame.center);
    state.basis = frame.basis.map(copy) as [Vec2, Vec2];
    state.now = ctx.now;
    state.frameId = frameId;
    state.pose = pose;
    return copy(state.q);
  }
  private limit(s: State, item: Physics, frame: BounceFrame) {
    const b = item.bounce!,
      range = Math.max(0, Math.min(1, item.range));
    for (const axis of ['x', 'y'] as const) {
      const disabled = axis === 'x' ? item.direction === 'vertical' : item.direction === 'horizontal';
      const bound = disabled ? 0 : b.amplitudes[axis] * range;
      if (!Number.isFinite(s.q[axis] + s.v[axis])) {
        s.q[axis] = s.v[axis] = 0;
        continue;
      }
      if (s.q[axis] > bound) {
        s.q[axis] = bound;
        if (s.v[axis] > 0) s.v[axis] = 0;
      }
      if (s.q[axis] < -bound) {
        s.q[axis] = -bound;
        if (s.v[axis] < 0) s.v[axis] = 0;
      }
      if (disabled) s.v[axis] = 0;
    }
    const scale = safeBounceScale(frame.mesh, frame.positions, b.weights, s.q);
    if (scale < 1) {
      s.q.x *= scale;
      s.q.y *= scale;
      s.v = { x: 0, y: 0 };
    }
  }
}
