// 物理演算（カード49）。project.physics の項目ごとに振り子を持ち、入力（根元）の動きから揺れを計算して、
// 揺れパラメータに θ / range（−1..1）を override・weight 1 で出す。
// 運動: 加速度 = −spring·θ − damping·ω − inertia·(入力の加速度) + gravity·(重力の向きの成分)。
// 固定の PHYSICS_STEP 秒で積分し、フレームの時間に合わせて回数を変える（1フレームの最大は PHYSICS_MAX_STEPS 回）
import type { FrameContext, Layer, ParamValues, PhysicsEngine } from '@app/contracts';
import type { BlendOp, Parameter, Physics } from '@app/schema';
import { createBindingEvaluator } from '../eval/evaluator';
import { bounceFrame, bounceReason, chestDeformBindingIds, limitChestOutput } from './bounce';
import { ChestDynamicsSession } from './chestSession';

export const PHYSICS_STEP = 1 / 120; // 積分の刻み（秒）
export const PHYSICS_MAX_STEPS = 8; // 1フレームで積分する回数の上限。超えた分の時間は捨てる
// 入力の速度をならす時定数（秒。1次の遅れを2段）。トラッキングの値は 30Hz ほどの段差で届き、段差はフレームの
// 時間をかけて当たるので、そのままではフレームの時間で揺れが変わる。刻みの上でならしてから加速度を求める
export const PHYSICS_INPUT_SMOOTHING = 0.02;
const SMOOTH = 1 - Math.exp(-PHYSICS_STEP / PHYSICS_INPUT_SMOOTHING); // 1刻みでならす割合

export type PhysicsAxis = 'horizontal' | 'vertical';
export interface PhysicsInput {
  parameterId: string;
  weight: number;
  axis?: PhysicsAxis;
}

// 入力が無い項目の既定（振り子の向きごと）
export const PHYSICS_DEFAULT_INPUTS: Readonly<Record<PhysicsAxis, readonly PhysicsInput[]>> = Object.freeze({
  horizontal: Object.freeze([
    Object.freeze({ parameterId: 'FaceAngleX', weight: 0.7 }),
    Object.freeze({ parameterId: 'BodyAngleX', weight: 0.3 }),
  ]),
  vertical: Object.freeze([Object.freeze({ parameterId: 'FaceAngleY', weight: 0.7 })]),
});

// strength（0..1）で spring・damping に掛ける率。0 で 1、1 で 0.6（弱めて揺れを大きくする）。範囲の外は丸める
export function physicsStrengthFactor(strength: number): number {
  const s = Number.isFinite(strength) ? Math.min(1, Math.max(0, strength)) : 0;
  return 1 - 0.4 * s;
}

// 項目が持つ振り子の向き。both は左右と上下の2つで、出力は先頭（左右）を使う
export function physicsAxesOf(direction: Physics['direction']): PhysicsAxis[] {
  if (direction === 'vertical') return ['vertical'];
  if (direction === 'both') return ['horizontal', 'vertical'];
  return ['horizontal'];
}

export interface PhysicsPendulumState {
  theta: number; // 角度（ラジアン。まっすぐ垂れた向きが 0）
  omega: number; // 角速度（ラジアン/秒）
}

export interface PhysicsEngineWithState extends PhysicsEngine {
  produce(ctx: FrameContext): Layer | null;
  // 項目の振り子の今の状態（テストと確認用）。まだ計算していない項目は null
  pendulums(physicsId: string): Record<PhysicsAxis, PhysicsPendulumState | null> | null;
}

const AXES: readonly PhysicsAxis[] = ['horizontal', 'vertical'];

interface Pendulum {
  theta: number;
  omega: number;
  x: number; // 積分の時刻での入力
  v1: number; // 入力の速度（/秒）をならした値の1段目。分からないとき（計算を始めた直後）は NaN
  v2: number; // 2段目（根元の速度として使う）
  xFrame: number; // 前のフレームの入力
  key: string; // 入力の定義（パラメータ・重み・範囲）
}
type ItemState = Record<PhysicsAxis, Pendulum | null>;

interface Coefficients {
  spring: number;
  damping: number;
  gravity: number;
  inertia: number;
  range: number; // 0 なら揺らさない
}

const finite = (v: number) => (Number.isFinite(v) ? v : 0);

// spring・damping は strength で弱める。負の spring・damping は 0 にする（発散させない）
function coefficientsOf(item: Physics): Coefficients {
  const f = physicsStrengthFactor(item.strength);
  return {
    spring: Math.max(0, finite(item.spring)) * f,
    damping: Math.max(0, finite(item.damping)) * f,
    gravity: finite(item.gravity),
    inertia: finite(item.inertia),
    range: Number.isFinite(item.range) && item.range > 0 ? item.range : 0,
  };
}

// 入力 x = Σ(入力の値 × weight)。値はパラメータの min..max を −1..1 に直したもの（パラメータごとの単位の違いを無くす。
// 揺れには入力の変化だけが効く）。プロジェクトに無いパラメータは使わない。合成結果に無い値はデフォルト値
function readInput(
  inputs: readonly PhysicsInput[],
  mixed: ParamValues,
  params: ReadonlyMap<string, Parameter>,
): { x: number; key: string } {
  let x = 0;
  let key = '';
  for (const { parameterId, weight } of inputs) {
    const p = params.get(parameterId);
    if (!p || !(p.max > p.min)) continue;
    const raw = mixed[parameterId];
    const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : p.default;
    const w = finite(weight);
    x += (((value - p.min) / (p.max - p.min)) * 2 - 1) * w;
    key += `${parameterId}\u0000${w}\u0000${p.min}\u0000${p.max}\u0001`;
  }
  return { x, key };
}

// θ を ±range に丸める。外へ向かう角速度は 0 にする。数でなくなったら止める
function limit(p: Pendulum, range: number) {
  if (!Number.isFinite(p.theta) || !Number.isFinite(p.omega) || range <= 0) {
    p.theta = 0;
    p.omega = 0;
    return;
  }
  if (p.theta > range) {
    p.theta = range;
    if (p.omega > 0) p.omega = 0;
  } else if (p.theta < -range) {
    p.theta = -range;
    if (p.omega < 0) p.omega = 0;
  }
}

// 1フレーム分を進める。at(k) は k 回目の刻みの終わりの、このフレームの中での位置（前のフレーム 0 → このフレーム 1）。
// 入力はフレームの間を直線でつなぎ、刻みごとの入力の速度をならした値（根元の速度）の変化を、入力の加速度にする。
// fresh（計算を始めたフレーム・入力の定義が変わったフレーム・止めていたあとのフレーム）は、今の入力を根元の位置にし、
// 入力の速度が分かるまで入力の加速度を 0 とみなす（入力の飛びや動いている途中から始めたことを揺れにしない）
function advance(
  prev: Pendulum | null,
  input: { x: number; key: string },
  c: Coefficients,
  steps: number,
  at: (k: number) => number,
  resync: boolean,
): Pendulum {
  const fresh = prev === null || resync || prev.key !== input.key;
  const p: Pendulum = prev ?? { theta: 0, omega: 0, x: input.x, v1: NaN, v2: NaN, xFrame: input.x, key: input.key };
  if (fresh) {
    p.x = input.x;
    p.xFrame = input.x;
    p.v1 = NaN;
    p.v2 = NaN;
    p.key = input.key;
  }
  const h = PHYSICS_STEP;
  for (let k = 1; k <= steps; k++) {
    const x = p.xFrame + (input.x - p.xFrame) * at(k);
    let dv = 0; // 根元の加速度 × h
    if (!fresh) {
      const v = (x - p.x) / h;
      if (Number.isNaN(p.v2)) {
        // 速度が分かった最初の刻み。その速度で動き続けていたとみなす
        p.v1 = v;
        p.v2 = v;
      } else {
        p.v1 += SMOOTH * (v - p.v1);
        const v2 = p.v2 + SMOOTH * (p.v1 - p.v2);
        dv = v2 - p.v2;
        p.v2 = v2;
      }
    }
    // 重力の向きの成分: まっすぐ垂れた向き（θ = 0）へ戻す向きの、重力の接線方向の成分（−sin θ）。
    // damping は陰的に入れる（大きな値でも発散しない）
    p.omega =
      (p.omega - c.inertia * dv + h * (-c.spring * p.theta - c.gravity * Math.sin(p.theta))) / (1 + h * c.damping);
    p.theta += h * p.omega;
    limit(p, c.range);
    p.x = x;
  }
  p.xFrame = input.x;
  return p;
}

// 出力の値（−1..1）。積分の時刻はフレームの時刻より pending 秒だけ前なので、その分を角速度で先に進める
function outputOf(p: Pendulum, range: number, pending: number): number {
  if (range <= 0) return 0;
  const theta = p.theta + p.omega * pending;
  return (theta > range ? range : theta < -range ? -range : theta) / range;
}

// ctx.flags.physicsActive が false の間は null を返し、状態はそのまま保つ（時間も進めない）。
// 戻ったフレームは、止めていた間の入力の変化を揺れにしない。同じ出力パラメータの項目が複数あれば、あとの項目の値。
// 出力パラメータがプロジェクトに無い項目は計算しない
export function createPhysicsEngine(): PhysicsEngineWithState {
  const states = new Map<string, ItemState>();
  const chest = new ChestDynamicsSession();
  const evaluator = createBindingEvaluator();
  let pending = 0; // まだ積分していない時間（秒。PHYSICS_STEP 未満）
  let resync = false;
  let paramIndex: { list: Parameter[]; byId: Map<string, Parameter> } | null = null;

  function parametersById(list: Parameter[]): ReadonlyMap<string, Parameter> {
    if (paramIndex?.list !== list) {
      const byId = new Map<string, Parameter>();
      for (const p of list) if (!byId.has(p.id)) byId.set(p.id, p);
      paramIndex = { list, byId };
    }
    return paramIndex.byId;
  }

  return {
    id: 'physics',

    reset() {
      states.clear();
      chest.reset();
      pending = 0;
      resync = false;
    },

    pendulums(physicsId) {
      const s = states.get(physicsId);
      if (!s) return null;
      const view = (p: Pendulum | null) => (p ? { theta: p.theta, omega: p.omega } : null);
      return { horizontal: view(s.horizontal), vertical: view(s.vertical) };
    },

    produce(ctx): Layer | null {
      if (!ctx.flags.physicsActive) {
        resync = true;
        chest.reset();
        return null;
      }
      const params = parametersById(ctx.project.model.parameters);

      // このフレームで積分する回数
      const dt = Number.isFinite(ctx.dt) && ctx.dt > 0 ? ctx.dt / 1000 : 0;
      const before = pending;
      let steps = Math.floor((before + dt) / PHYSICS_STEP + 1e-9);
      let stretch = false;
      if (steps > PHYSICS_MAX_STEPS) {
        // 長いフレームは最大回数だけ進め、入力の変化はその間に割り振る
        steps = PHYSICS_MAX_STEPS;
        stretch = true;
        pending = 0;
      } else {
        pending = Math.max(0, before + dt - steps * PHYSICS_STEP);
      }
      const at = (k: number) => {
        if (stretch) return k / steps;
        if (dt <= 0) return 1;
        const f = (k * PHYSICS_STEP - before) / dt;
        return f < 0 ? 0 : f > 1 ? 1 : f;
      };

      const values: ParamValues = {};
      const blend: Record<string, BlendOp> = {};
      const seen = new Set<string>();
      for (const item of ctx.project.physics) {
        if (item.deform === 'bounce') continue;
        if (!params.has(item.outputParameterId)) continue;
        seen.add(item.id);
        let state = states.get(item.id);
        if (!state) {
          state = { horizontal: null, vertical: null };
          states.set(item.id, state);
        }
        const c = coefficientsOf(item);
        const axes = physicsAxesOf(item.direction);
        for (const axis of AXES) {
          if (!axes.includes(axis)) {
            state[axis] = null;
            continue;
          }
          const inputs =
            item.inputs.length > 0
              ? item.inputs.filter((x) => !x.axis || x.axis === axis)
              : PHYSICS_DEFAULT_INPUTS[axis];
          state[axis] = advance(state[axis], readInput(inputs, ctx.mixedSoFar, params), c, steps, at, resync);
        }
        const vertical =
          item.verticalOutputParameterId && params.has(item.verticalOutputParameterId)
            ? item.verticalOutputParameterId
            : null;
        const primary = vertical && item.direction === 'vertical' ? vertical : item.outputParameterId;
        const out = state[axes[0]!];
        values[primary] = out ? outputOf(out, c.range, pending) : 0;
        blend[primary] = 'override';
        if (vertical) {
          const unused = item.direction === 'vertical' ? item.outputParameterId : vertical;
          if (item.direction !== 'both') {
            values[unused] = 0;
            blend[unused] = 'override';
          }
        }
        if (vertical && item.direction === 'both') {
          values[vertical] = state.vertical ? outputOf(state.vertical, c.range, pending) : 0;
          blend[vertical] = 'override';
        }
      }
      for (const id of [...states.keys()]) if (!seen.has(id)) states.delete(id);
      const bouncing = ctx.project.physics.filter((p) => p.deform === 'bounce');
      chest.retain(bouncing.map((p) => p.id));
      if (bouncing.length) {
        const owned = chestDeformBindingIds(ctx.project, bouncing);
        const model = { ...ctx.project.model, bindings: ctx.project.model.bindings.filter((b) => !owned.has(b.id)) };
        const deltas = evaluator.evaluate(model, { ...ctx.mixedSoFar, ...values });
        for (const item of bouncing) {
          if (!params.has(item.outputParameterId)) continue;
          seen.add(item.id);
          const frame = bounceReason(ctx.project, item) ? null : bounceFrame(ctx.project, item, deltas);
          if (frame && item.inputs.length) {
            for (const [axis, coordinate] of [
              ['horizontal', 'x'],
              ['vertical', 'y'],
            ] as const) {
              frame.center[coordinate] +=
                item.bounce!.amplitudes[coordinate] *
                readInput(
                  item.inputs.filter((i) => !i.axis || i.axis === axis),
                  ctx.mixedSoFar,
                  params,
                ).x;
            }
          }
          if (!frame) chest.discard(item.id);
          const advanced = frame ? chest.advance(item, frame, ctx) : { x: 0, y: 0 };
          const q = frame
            ? limitChestOutput(ctx.project, item, frame, { ...ctx.mixedSoFar, ...values }, advanced)
            : advanced;
          if (q !== advanced) chest.accept(item.id, q);
          const a = item.bounce?.amplitudes;
          values[item.outputParameterId] = a ? q.x / a.x : 0;
          blend[item.outputParameterId] = 'override';
          if (item.verticalOutputParameterId && params.has(item.verticalOutputParameterId)) {
            values[item.verticalOutputParameterId] = a ? q.y / a.y : 0;
            blend[item.verticalOutputParameterId] = 'override';
          }
        }
      }
      resync = false;
      return seen.size > 0 ? { id: 'physics', weight: 1, values, blend } : null;
    },
  };
}
