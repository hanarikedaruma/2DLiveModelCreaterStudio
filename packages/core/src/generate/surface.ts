// 曲面の生成方式（カード31）。顔の向きに合わせて、ワープの制御点を球面に沿って動かす
import type { Binding, Model, ParameterKey, Vec2, Warp } from '@app/schema';
import { generateBetweenKeys, linearInterpolator, type Interpolator } from './between';
import { deepEqual } from './equal';
import { clean, keyCoord, sameCoord, sortKeys, sortedUnique } from './keys';

export type SurfaceParameter = 'FaceAngleX' | 'FaceAngleY';

// 球の半径（bounds の幅・高さの大きいほうに掛ける）
export const SURFACE_RADIUS_RATIO = 0.6;
// パラメータ 30 のときの球の回転（度）
export const SURFACE_MAX_ANGLE = 20;
// 代表状態のキーの位置と、中間キーの刻み
export const SURFACE_ANCHOR_VALUES = [-30, 0, 30];
export const SURFACE_STEP = 10;

const clamp1 = (v: number) => Math.min(1, Math.max(-1, v));

// 制御点を球面に沿って動かす差分（values と同じ順。各要素は warp.points と同じ数）。
// 中心 c = bounds の中心、半径 r = 0.6 × max(幅, 高さ)、角度 θ = value / 30 × 20°。
// X は x' = c.x + r·sin(asin(clamp((x − c.x) / r)) + θ)。Y は上が正なので、上向きの (c.y − y) で同じ式を使う。
// 球の外の点（|x − c.x| > r）は、球の端の点と同じだけ動かす（式のままだと球の上に寄せてしまい、0 でも動く）
export function generateSurfaceKeys(warp: Warp, parameterId: SurfaceParameter, values: number[]): Vec2[][] {
  const { x, y, width, height } = warp.bounds;
  const cx = x + width / 2;
  const cy = y + height / 2;
  const r = SURFACE_RADIUS_RATIO * Math.max(width, height);
  return values.map((value) => {
    const theta = (((value / 30) * SURFACE_MAX_ANGLE) / 180) * Math.PI;
    return warp.points.map((p) => {
      if (theta === 0 || !(r > 0)) return { x: 0, y: 0 };
      if (parameterId === 'FaceAngleX') {
        const u = clamp1((p.x - cx) / r);
        return { x: clean(r * (Math.sin(Math.asin(u) + theta) - u)), y: 0 };
      }
      const u = clamp1((cy - p.y) / r);
      return { x: 0, y: clean(-r * (Math.sin(Math.asin(u) + theta) - u)) };
    });
  });
}

export interface SurfaceTarget {
  warp: Warp;
  parameterId: SurfaceParameter;
}

// 曲面を作れるバインディングか（FaceAngleX か FaceAngleY の1パラメータで、ワープの制御点を動かす）
export function surfaceTarget(binding: Binding, model: Model): SurfaceTarget | null {
  if (binding.channel !== 'warpPoints' || binding.target.type !== 'warp' || binding.parameterIds.length !== 1) {
    return null;
  }
  const parameterId = binding.parameterIds[0];
  if (parameterId !== 'FaceAngleX' && parameterId !== 'FaceAngleY') return null;
  const warp = model.warps.find((w) => w.id === binding.target.id);
  return warp ? { warp, parameterId } : null;
}

// 曲面の中間キー。球面の形に、両端のキーと球面とのずれ（手で直した分）を線形に足す。
// 両端が球面のままなら球面そのものになる
export function surfaceInterpolator(warp: Warp, parameterId: SurfaceParameter): Interpolator {
  const n = warp.points.length;
  return (a, b, ts) => {
    if (!Array.isArray(a.delta) || !Array.isArray(b.delta) || a.delta.length !== n || b.delta.length !== n) {
      return linearInterpolator(a, b, ts);
    }
    const da = a.delta;
    const db = b.delta;
    const from = keyCoord(a);
    const to = keyCoord(b);
    const [sa = [], sb = []] = generateSurfaceKeys(warp, parameterId, [from, to]);
    const shapes = generateSurfaceKeys(
      warp,
      parameterId,
      ts.map((t) => from + (to - from) * t),
    );
    return shapes.map((shape, j) => {
      const t = ts[j]!;
      return shape.map((s, i) => {
        const ra = { x: da[i]!.x - (sa[i]?.x ?? 0), y: da[i]!.y - (sa[i]?.y ?? 0) };
        const rb = { x: db[i]!.x - (sb[i]?.x ?? 0), y: db[i]!.y - (sb[i]?.y ?? 0) };
        return { x: clean(s.x + ra.x + (rb.x - ra.x) * t), y: clean(s.y + ra.y + (rb.y - ra.y) * t) };
      });
    });
  };
}

// KeyGenerator.surface。−30・0・30 のキー（0 は差分 0）を球面で作り、間を 10 刻みで埋める。
// ロックされたキーは残し、ほかのキーは作り直す。対象でないバインディングはそのまま返す
export function surfaceBinding(binding: Binding, model: Model): Binding {
  const target = surfaceTarget(binding, model);
  if (!target) return binding;
  const locked = binding.keys.filter((k) => k.locked);
  const deltas = generateSurfaceKeys(target.warp, target.parameterId, SURFACE_ANCHOR_VALUES);
  const anchors: ParameterKey[] = [];
  SURFACE_ANCHOR_VALUES.forEach((value, i) => {
    if (locked.some((k) => sameCoord(keyCoord(k), value))) return;
    anchors.push({ coords: [value], delta: deltas[i]!, source: 'auto', locked: false });
  });
  const keys = sortKeys([...locked, ...anchors]);
  const seeded: Binding = { ...binding, keyValues: [sortedUnique(keys.map(keyCoord))], keys };
  const next = generateBetweenKeys(seeded, surfaceInterpolator(target.warp, target.parameterId), {
    divisions: null,
    step: SURFACE_STEP,
    within: null,
    generation: 'surface',
  });
  return deepEqual(next, binding) ? binding : next;
}
