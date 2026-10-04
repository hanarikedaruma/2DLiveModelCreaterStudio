// なめらかの生成方式（カード31）。代表状態の間を smoothstep で補間し、両端の近くの変化をゆるやかにする
import type { Binding } from '@app/schema';
import { generateBetweenKeys, type Interpolator } from './between';
import { lerpDelta } from './keys';

// 0..1 を、両端で傾きが 0 になるように曲げる（範囲の外は端に丸める）
export function smoothstep(t: number): number {
  const u = Math.min(1, Math.max(0, t));
  return u * u * (3 - 2 * u);
}

export const easeInterpolator: Interpolator = (a, b, ts) => ts.map((t) => lerpDelta(a.delta, b.delta, smoothstep(t)));

// KeyGenerator.ease。代表状態の間の中間キーを smoothstep で作り直し、方式を 'ease' にする
export function easeBinding(binding: Binding, step: number): Binding {
  return generateBetweenKeys(binding, easeInterpolator, {
    divisions: binding.divisions,
    step,
    within: null,
    generation: 'ease',
  });
}
