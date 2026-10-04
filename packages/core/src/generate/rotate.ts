// 回転の生成方式（カード31）。頂点・制御点を、ピボットを中心とした円弧に沿って補間する
import type { Binding, Model, Vec2 } from '@app/schema';
import { generateBetweenKeys, linearInterpolator, type Interpolator } from './between';
import { clean } from './keys';

// これより pivot に近い点は向きが決まらないので、線形に補間する
const PIVOT_EPSILON = 1e-9;
const ZERO: Vec2 = { x: 0, y: 0 };

// 角度の差を -π..π にする（近いほうの向きに回す）
function shortestTurn(from: number, to: number): number {
  const d = to - from;
  return Math.atan2(Math.sin(d), Math.cos(d));
}

// 代表状態 a・b（基準の点 base からの差分）の各点を pivot からの角度と距離にし、ts（0..1）ごとに
// 角度と距離を線形に補間した点の、base からの差分を返す（ts と同じ順）。
// 角度は近いほうの向き（±180° 以内）に回す。どちらかの状態で pivot に重なる点は、線形に補間する
export function generateRotateKeys(base: Vec2[], pivot: Vec2, a: Vec2[], b: Vec2[], ts: number[]): Vec2[][] {
  const tracks = base.map((p, i) => {
    const da = a[i] ?? ZERO;
    const db = b[i] ?? ZERO;
    const ax = p.x + da.x - pivot.x;
    const ay = p.y + da.y - pivot.y;
    const bx = p.x + db.x - pivot.x;
    const by = p.y + db.y - pivot.y;
    const ra = Math.hypot(ax, ay);
    const rb = Math.hypot(bx, by);
    const angle = Math.atan2(ay, ax);
    return { p, da, db, ra, rb, angle, turn: shortestTurn(angle, Math.atan2(by, bx)) };
  });
  return ts.map((t) =>
    tracks.map(({ p, da, db, ra, rb, angle, turn }) => {
      if (ra <= PIVOT_EPSILON || rb <= PIVOT_EPSILON) {
        return { x: clean(da.x + (db.x - da.x) * t), y: clean(da.y + (db.y - da.y) * t) };
      }
      const r = ra + (rb - ra) * t;
      const theta = angle + turn * t;
      return {
        x: clean(pivot.x + r * Math.cos(theta) - p.x),
        y: clean(pivot.y + r * Math.sin(theta) - p.y),
      };
    }),
  );
}

export interface RotateFrame {
  base: Vec2[]; // 基準状態の点（キャンバス座標）
  pivot: Vec2; // 回転の中心（キャンバス座標）
}

// 回転の基準。vertices はメッシュの頂点と、そのメッシュを使う画像パーツの pivot。
// warpPoints はワープの制御点と、ワープを持つグループの pivot。分からなければ null
export function rotateFrame(binding: Binding, model: Model): RotateFrame | null {
  if (binding.channel === 'vertices' && binding.target.type === 'mesh') {
    const mesh = model.meshes.find((m) => m.id === binding.target.id);
    const part = model.parts.find((p) => p.kind === 'image' && p.meshId === binding.target.id);
    return mesh && part ? { base: mesh.vertices, pivot: part.pivot } : null;
  }
  if (binding.channel === 'warpPoints' && binding.target.type === 'warp') {
    const warp = model.warps.find((w) => w.id === binding.target.id);
    const part = warp ? model.parts.find((p) => p.id === warp.partId) : undefined;
    return warp && part ? { base: warp.points, pivot: part.pivot } : null;
  }
  return null;
}

// 回転の補間。点の差分の数が基準と合わないときや transform（回転角そのものを補間する）は線形にする
export function rotateInterpolator(binding: Binding, model: Model): Interpolator {
  const frame = rotateFrame(binding, model);
  if (!frame) return linearInterpolator;
  const n = frame.base.length;
  return (a, b, ts) => {
    if (!Array.isArray(a.delta) || !Array.isArray(b.delta) || a.delta.length !== n || b.delta.length !== n) {
      return linearInterpolator(a, b, ts);
    }
    return generateRotateKeys(frame.base, frame.pivot, a.delta, b.delta, ts);
  };
}

// KeyGenerator.rotate。代表状態の間の中間キーを回転で作り直し、方式を 'rotate' にする
export function rotateBinding(binding: Binding, model: Model, step: number): Binding {
  return generateBetweenKeys(binding, rotateInterpolator(binding, model), {
    divisions: binding.divisions,
    step,
    within: null,
    generation: 'rotate',
  });
}
